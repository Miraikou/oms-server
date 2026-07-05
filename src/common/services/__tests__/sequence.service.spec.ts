import { Test, TestingModule } from '@nestjs/testing'
import { getRepositoryToken } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { SequenceService } from '../sequence.service'
import { SysSequence } from '@/common/entities/sys-sequence.entity'

// Mock snowflake
jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}))

describe('SequenceService', () => {
  let service: SequenceService

  const mockQB: any = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(null),
  }

  const mockManager = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQB),
    create: jest.fn((_: any, data: any) => ({ id: '9999999999999999', ...data })),
    save: jest.fn((entity: any) => Promise.resolve(entity)),
  }

  const mockDataSource = {
    transaction: jest.fn((cb: Function) => cb(mockManager)),
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockQB.getOne.mockResolvedValue(null)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SequenceService,
        { provide: getRepositoryToken(SysSequence), useValue: {} },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile()

    service = module.get<SequenceService>(SequenceService)
  })

  describe('generate - 日期型编号', () => {
    it('应生成正确格式的日期型编号（SO）', async () => {
      const result = await service.generate('SO')

      // 格式：SO + yyyyMMdd + 0001
      expect(result).toMatch(/^SO\d{8}0001$/)
      expect(result.length).toBe(14) // SO(2) + date(8) + seq(4)
    })

    it('新日期应初始化流水号为 1', async () => {
      mockQB.getOne.mockResolvedValue(null)

      const result = await service.generate('FH')

      expect(result).toMatch(/^FH\d{8}0001$/)
      expect(mockManager.create).toHaveBeenCalledWith(
        SysSequence,
        expect.objectContaining({ currentValue: 1 }),
      )
    })

    it('同日期应递增流水号', async () => {
      mockQB.getOne.mockResolvedValue({
        bizType: 'SO',
        bizDate: expect.any(String),
        currentValue: 5,
      })

      const result = await service.generate('SO')

      expect(result).toMatch(/^SO\d{8}0006$/)
    })

    it('流水号超过 9999 时应保持位数', async () => {
      mockQB.getOne.mockResolvedValue({
        bizType: 'SO',
        bizDate: expect.any(String),
        currentValue: 9999,
      })

      const result = await service.generate('SO')

      expect(result).toMatch(/^SO\d{8}10000$/)
    })

    it('应为所有日期型类型生成正确前缀', async () => {
      const dateTypes = ['SO', 'CG', 'FH', 'SK', 'TH', 'PT', 'KC', 'BT'] as const

      for (const type of dateTypes) {
        mockQB.getOne.mockResolvedValue(null)
        const result = await service.generate(type)
        expect(result.startsWith(type)).toBe(true)
        expect(result).toMatch(new RegExp(`^${type}\\d{8}0001$`))
      }
    })
  })

  describe('generate - 永久型编号', () => {
    it('应生成正确格式的永久型编号（CP）', async () => {
      const result = await service.generate('CP')

      // 格式：CP + 0001（无日期部分）
      expect(result).toMatch(/^CP0001$/)
      expect(result.length).toBe(6) // CP(2) + seq(4)
    })

    it('永久型编号应使用固定日期占位符', async () => {
      await service.generate('CP')

      expect(mockManager.create).toHaveBeenCalledWith(
        SysSequence,
        expect.objectContaining({
          bizType: 'CP',
          bizDate: '00000000',
        }),
      )
    })

    it('应为所有永久型类型生成正确格式', async () => {
      const permTypes = ['CP', 'SP', 'GYS'] as const

      for (const type of permTypes) {
        mockQB.getOne.mockResolvedValue(null)
        const result = await service.generate(type)
        expect(result).toMatch(new RegExp(`^${type}0001$`))
      }
    })

    it('永久型编号递增应正确', async () => {
      mockQB.getOne.mockResolvedValue({
        bizType: 'GYS',
        bizDate: '00000000',
        currentValue: 42,
      })

      const result = await service.generate('GYS')

      expect(result).toBe('GYS0043')
    })
  })

  describe('generate - 并发安全', () => {
    it('应在事务中使用悲观锁', async () => {
      await service.generate('SO')

      expect(mockDataSource.transaction).toHaveBeenCalled()
      expect(mockManager.createQueryBuilder).toHaveBeenCalledWith(SysSequence, 'seq')
      expect(mockQB.setLock).toHaveBeenCalledWith('pessimistic_write')
    })
  })
})
