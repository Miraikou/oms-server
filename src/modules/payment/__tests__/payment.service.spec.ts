import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaymentService } from '../payment.service';
import { Payment } from '../entities/payment.entity';
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity';
import { SequenceService } from '@/common/services/sequence.service';
import { SalesOrderService } from '@/modules/sales-order/sales-order.service';

jest.mock('@/common/utils/snowflake', () => ({
  snowflake: { nextId: jest.fn(() => '9999999999999999') },
}));

describe('PaymentService', () => {
  let service: PaymentService;

  /* ---- 注入的 Mock Repo ---- */
  const mockPaymentRepo = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockOrderRepo = {};

  /* ---- Service 依赖 ---- */
  const mockSequenceService = {
    generate: jest.fn(),
  };

  const mockSalesOrderService = {
    updateReceivedAmount: jest.fn().mockResolvedValue(undefined),
  };

  /* ---- 事务内 manager.getRepository 返回的 Mock ---- */
  const mockPaymentRepoForManager = {
    create: jest.fn((data: any) => data),
    save: jest.fn((entity: any) => Promise.resolve({ id: 'p1', ...entity })),
  };

  const mockOrderRepoForManager = {
    findOne: jest.fn(),
  };

  const mockManager = {
    getRepository: jest.fn((entity: any) => {
      if (entity === Payment) return mockPaymentRepoForManager;
      if (entity === SalesOrder) return mockOrderRepoForManager;
      return {};
    }),
  };

  const mockDataSource = {
    transaction: jest.fn((cb: any) => cb(mockManager)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentService,
        { provide: getRepositoryToken(Payment), useValue: mockPaymentRepo },
        { provide: getRepositoryToken(SalesOrder), useValue: mockOrderRepo },
        { provide: SequenceService, useValue: mockSequenceService },
        { provide: SalesOrderService, useValue: mockSalesOrderService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<PaymentService>(PaymentService);
  });

  /* ==================== create ==================== */
  describe('create', () => {
    const validDto = {
      orderId: 'oid1',
      usdAmount: '1500.00',
      exchangeRate: '7.12',
      cnyAmount: '10680.00',
      paymentDate: '2026-07-01',
      paymentMethod: '银行转账',
      payer: '客户A',
      remark: '测试',
    };

    const mockOrder = {
      id: 'oid1',
      orderNo: 'SO202607010001',
      totalAmount: '2000.00',
      receivedAmount: '0.00',
      status: 1,
    };

    it('应成功创建收款并更新订单', async () => {
      mockOrderRepoForManager.findOne.mockResolvedValue(mockOrder);
      mockSequenceService.generate.mockResolvedValue('SK202607010001');

      const result = await service.create(validDto);

      expect(result.paymentNo).toBe('SK202607010001');
      expect(result.orderId).toBe('oid1');
      expect(mockPaymentRepoForManager.create).toHaveBeenCalledWith(
        expect.objectContaining({ paymentNo: 'SK202607010001' }),
      );
      expect(mockPaymentRepoForManager.save).toHaveBeenCalled();
      expect(mockSequenceService.generate).toHaveBeenCalledWith('SK');
      expect(mockSalesOrderService.updateReceivedAmount).toHaveBeenCalledWith(
        'oid1',
        '1500.00',
        '10680.00',
      );
    });

    it('usdAmount <= 0 时应抛出 BadRequestException', async () => {
      await expect(
        service.create({ ...validDto, usdAmount: '0' }),
      ).rejects.toThrow(BadRequestException);

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('exchangeRate <= 0 时应抛出 BadRequestException', async () => {
      await expect(
        service.create({ ...validDto, exchangeRate: '0' }),
      ).rejects.toThrow(BadRequestException);

      expect(mockDataSource.transaction).not.toHaveBeenCalled();
    });

    it('订单不存在时应抛出 BadRequestException', async () => {
      mockOrderRepoForManager.findOne.mockResolvedValue(null);

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException);
    });

    it('订单已结束应抛出 BadRequestException', async () => {
      mockOrderRepoForManager.findOne.mockResolvedValue({
        ...mockOrder,
        status: 2,
      });

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException);
    });

    it('收款超过订单总额时应抛出 BadRequestException', async () => {
      mockOrderRepoForManager.findOne.mockResolvedValue({
        ...mockOrder,
        totalAmount: '1000.00',
        receivedAmount: '500.00',
      });
      // usdAmount = 1500.00 -> 1,500,000 micro, 500k + 1,500k > 1,000k

      await expect(service.create(validDto)).rejects.toThrow(BadRequestException);
    });
  });

  /* ==================== findOne ==================== */
  describe('findOne', () => {
    it('应返回收款记录', async () => {
      const payment = {
        id: 'p1',
        paymentNo: 'SK202607010001',
        orderId: 'oid1',
      };
      mockPaymentRepo.findOne.mockResolvedValue(payment);

      const result = await service.findOne('p1');

      expect(result.paymentNo).toBe('SK202607010001');
      expect(mockPaymentRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'p1' },
      });
    });

    it('记录不存在时应抛出 BadRequestException', async () => {
      mockPaymentRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('999')).rejects.toThrow(BadRequestException);
    });
  });

  /* ==================== findAll ==================== */
  describe('findAll', () => {
    const mockQb = (resolvedList: any[], total: number) => ({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([resolvedList, total]),
    });

    it('应返回分页列表并应用筛选条件', async () => {
      const list = [{ id: 'p1', paymentNo: 'SK001' }];
      mockPaymentRepo.createQueryBuilder.mockReturnValue(mockQb(list, 1));

      const result = await service.findAll({
        paymentNo: 'SK001',
        orderId: 'oid1',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        page: 1,
        pageSize: 10,
        sortField: 'createdTime',
        sortOrder: 'DESC',
      });

      expect(result.list).toEqual(list);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('无参数时使用默认分页和排序', async () => {
      mockPaymentRepo.createQueryBuilder.mockReturnValue(mockQb([], 0));

      const result = await service.findAll({} as any);

      expect(mockPaymentRepo.createQueryBuilder).toHaveBeenCalledWith('p');
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });
  });
});
