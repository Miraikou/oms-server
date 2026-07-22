import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { SystemConfigService } from '@/modules/system-config/system-config.service'
import { DataSource } from 'typeorm'
import { CommissionService } from '../commission.service'
import { CommissionLedger } from '../entities/commission-ledger.entity'
import { CommissionSettlement } from '../entities/commission-settlement.entity'
import { Salesperson } from '@/modules/salesperson/entities/salesperson.entity'
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity'
import { SalesOrderItem } from '@/modules/sales-order/entities/sales-order-item.entity'
import { SalesOrderCost } from '@/modules/sales-order/entities/sales-order-cost.entity'
import { ShipmentItem } from '@/modules/shipment/entities/shipment-item.entity'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

/**
 * 提成账本回归测试 ⭐
 * 覆盖两处历史 bug 的修复：
 * - B1: accrueOrderCommission 未结算分支重算时漏算"补提分录"，导致重新完成后 NET 高估、多付提成
 * - B4: recalculateOrderCommission 的 P2 守卫误伤"全额冲回后利润回升"的合法补提，导致少付提成
 *
 * 测试策略：spy 私有辅助方法（calcOrderProfit / getTotal*ForOrder），
 * 隔离出被修复的决策逻辑本身，不依赖底层 SQL 查询细节。
 */

const mockLedgerRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
}

const mockOrderRepo = {
  findOne: jest.fn(),
}

describe('CommissionService', () => {
  let service: CommissionService

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommissionService,
        { provide: getRepositoryToken(CommissionLedger), useValue: mockLedgerRepo },
        { provide: getRepositoryToken(CommissionSettlement), useValue: {} },
        { provide: getRepositoryToken(Salesperson), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(SalesOrder), useValue: mockOrderRepo },
        { provide: getRepositoryToken(SalesOrderItem), useValue: {} },
        { provide: getRepositoryToken(SalesOrderCost), useValue: { createQueryBuilder: jest.fn() } },
        { provide: getRepositoryToken(ShipmentItem), useValue: { createQueryBuilder: jest.fn() } },
        { provide: DataSource, useValue: {} },
        { provide: SystemConfigService, useValue: { getByKey: jest.fn().mockResolvedValue('40') } },
      ],
    }).compile()

    service = module.get<CommissionService>(CommissionService)
  })

  beforeEach(() => {
    jest.clearAllMocks()
    mockLedgerRepo.create.mockImplementation((data: any) => ({ id: '9999999999999999', ...data }))
    mockLedgerRepo.save.mockImplementation((e: any) => Promise.resolve(e))
  })

  /** mock 订单利润（calcOrderProfit 为私有方法，spy 隔离） */
  function mockProfit(profitCny: number) {
    jest.spyOn(service as any, 'calcOrderProfit').mockResolvedValue({
      totalAmountCny: profitCny,
      totalAmountUsd: profitCny,
      productCostCny: 0,
      productCostUsd: 0,
      extraCostCny: 0,
      extraCostUsd: 0,
      bloggerCommissionCny: 0,
      bloggerCommissionUsd: 0,
      salesProfitCny: profitCny,
      salesProfitUsd: profitCny,
      exchangeRate: 7,
    })
  }

  /** mock 账本汇总（Σtype1 / Σ|type2|，均为私有方法，spy 隔离） */
  function mockTotals(totalAccrual: number, totalClawback: number) {
    jest.spyOn(service as any, 'getTotalAccrualForOrder').mockResolvedValue(totalAccrual)
    jest.spyOn(service as any, 'getTotalAccrualForOrderUsd').mockResolvedValue(totalAccrual)
    jest.spyOn(service as any, 'getTotalClawbackForOrder').mockResolvedValue(totalClawback)
    jest.spyOn(service as any, 'getTotalClawbackForOrderUsd').mockResolvedValue(totalClawback)
  }

  const mockOrder = {
    id: 'order1',
    status: 2, // 已完成
    salespersonId: 'sp1',
    totalAmountUsd: '200.00',
    totalAmountCny: '1400.00',
    receivedAmountUsd: '200.00',
    receivedAmountCny: '1400.00',
    currency: 'USD',
    exchangeRate: '7.0000',
  }

  // ═══════════════════════════════════════════════════════════
  // B1: accrueOrderCommission 未结算分支漏算补提分录
  // ═══════════════════════════════════════════════════════════
  describe('accrueOrderCommission（B1：重新完成时 NET 应收敛到应有提成）', () => {
    it('存在补提分录时，重新完成后首条分录应扣除其他 type=1，NET 不高估（不多付）', async () => {
      // 账本状态：首条计提 A=50（未结算）+ 补提 S=50 + 全额冲回 R=-100
      // Σtype1=100，Σ|type2|=100，当前 NET=0
      const existing = {
        id: 'L1',
        salesOrderId: 'order1',
        type: 1,
        status: 1, // 未结算
        commissionRate: '50',
        commissionAmountCny: '50.00',
        commissionAmountUsd: '50.00',
        profitBaseCny: '100.00',
        profitBaseUsd: '100.00',
      }
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockLedgerRepo.findOne.mockResolvedValue(existing)
      mockProfit(200) // 当前利润 200 → 应有提成 = 200×50% = 100
      mockTotals(100, 100) // Σtype1=100（A+S），Σ|type2|=100

      await service.accrueOrderCommission('order1')

      // 首条分录应更新为：应有提成 + 已冲回 - 其他type=1 = 100 + 100 - 50 = 150
      expect(existing.commissionAmountCny).toBe('150.00')
      expect(mockLedgerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'L1', commissionAmountCny: '150.00' }),
      )
      // NET = 150(A) + 50(S) - 100(R) = 100 = 应有提成，不多付
      // （修复前会更新成 100+100=200，NET=200+50-100=150，多付 50）
    })

    it('单分录场景行为不变（首条 = 应有提成 + 已冲回）', async () => {
      // 账本状态：仅首条计提 A=50 + 全额冲回 R=-50，Σtype1=50，Σ|type2|=50，NET=0
      const existing = {
        id: 'L1',
        salesOrderId: 'order1',
        type: 1,
        status: 1,
        commissionRate: '50',
        commissionAmountCny: '50.00',
        commissionAmountUsd: '50.00',
        profitBaseCny: '100.00',
        profitBaseUsd: '100.00',
      }
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockLedgerRepo.findOne.mockResolvedValue(existing)
      mockProfit(100) // 应有提成 = 100×50% = 50
      mockTotals(50, 50)

      await service.accrueOrderCommission('order1')

      // 首条 = 50 + 50 - 0 = 100，NET = 100 - 50 = 50 = 应有提成
      expect(existing.commissionAmountCny).toBe('100.00')
    })
  })

  // ═══════════════════════════════════════════════════════════
  // B4: recalculateOrderCommission P2 守卫误伤补提
  // ═══════════════════════════════════════════════════════════
  describe('recalculateOrderCommission（B4：全额冲回后利润回升应补提）', () => {
    const accrualEntry = {
      id: 'L1',
      salesOrderId: 'order1',
      type: 1,
      status: 1,
      salespersonId: 'sp1',
      commissionRate: '50',
      commissionAmountCny: '50.00',
      commissionAmountUsd: '50.00',
      profitBaseCny: '100.00',
      profitBaseUsd: '100.00',
      revenueAdjustmentUsd: '0',
      revenueAdjustmentCny: '0',
    }

    it('已全额冲回但利润回升时，应生成补提分录（守卫不得拦截）', async () => {
      mockLedgerRepo.findOne.mockResolvedValue({ ...accrualEntry })
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockProfit(30) // 利润回升到 30 → 应有提成 = 30×50% = 15
      mockTotals(50, 50) // 原计提 50，已全额冲回 50（NET=0）

      const result = await service.recalculateOrderCommission(
        'order1', '10.00', '70.00', 'pay1', 'ret1',
      )

      // 应补提 = 应有提成 - 当前NET = 15 - 0 = 15（type=1）
      // 修复前守卫（已冲回≥已计提）会直接 return null，导致 NET 停在 0，少付 15
      expect(result).not.toBeNull()
      expect(mockLedgerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 1, commissionAmountCny: '15.00' }),
      )
    })

    it('已全额冲回且无新提成时，应跳过（守卫保持生效）', async () => {
      mockLedgerRepo.findOne.mockResolvedValue({ ...accrualEntry })
      mockOrderRepo.findOne.mockResolvedValue(mockOrder)
      mockProfit(0) // 利润为 0 → 无应有提成
      mockTotals(50, 50)

      const result = await service.recalculateOrderCommission(
        'order1', '10.00', '70.00', 'pay1', 'ret1',
      )

      expect(result).toBeNull()
      expect(mockLedgerRepo.create).not.toHaveBeenCalled()
    })
  })
})
