import { Injectable, BadRequestException, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository, DataSource } from 'typeorm'
import { Payment } from './entities/payment.entity'
import { SalesOrder } from '@/modules/sales-order/entities/sales-order.entity'
import { SequenceService } from '@/common/services/sequence.service'
import { SalesOrderService } from '@/modules/sales-order/sales-order.service'
import { snowflake } from '@/common/utils/snowflake'
import type { CreatePaymentDto, QueryPaymentDto } from './dto/payment.dto'

/**
 * 收款服务
 * 负责收款登记、超额校验、订单已收金额更新
 * 收款提交后禁止修改删除
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name)

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(SalesOrder)
    private readonly orderRepo: Repository<SalesOrder>,
    private readonly sequenceService: SequenceService,
    private readonly salesOrderService: SalesOrderService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 创建收款记录
   * 事务：校验订单 → 校验不超额 → 生成收款单号 → 创建 Payment → 更新订单已收金额
   */
  async create(dto: CreatePaymentDto): Promise<Payment> {
    const usdAmount = parseFloat(dto.usdAmount)
    if (usdAmount <= 0) throw new BadRequestException('收款金额必须大于零')

    const exchangeRate = parseFloat(dto.exchangeRate)
    if (exchangeRate <= 0) throw new BadRequestException('汇率必须大于零')

    return this.dataSource.transaction(async () => {
      // 1. 校验订单
      const order = await this.orderRepo.findOne({
        where: { id: dto.orderId },
      })
      if (!order) throw new BadRequestException('订单不存在')
      if (order.status !== 1) {
        throw new BadRequestException('订单已结束，无法收款')
      }

      // 2. 校验不超额
      const totalAmount = parseFloat(order.totalAmountUsd)
      const receivedAmount = parseFloat(order.receivedAmountUsd)
      const afterReceive = receivedAmount + usdAmount
      if (afterReceive > totalAmount) {
        throw new BadRequestException(
          `收款金额超出订单金额：订单 $${totalAmount}，已收 $${receivedAmount}，本次 $${usdAmount}`,
        )
      }

      // 3. 生成收款单号
      const paymentNo = await this.sequenceService.generate('SK')

      // 4. 创建 Payment 记录
      const payment = this.paymentRepo.create({
        id: snowflake.nextId(),
        paymentNo,
        orderId: dto.orderId,
        paymentDate: new Date(dto.paymentDate),
        usdAmount: dto.usdAmount,
        exchangeRate: dto.exchangeRate,
        cnyAmount: dto.cnyAmount,
        paymentMethod: dto.paymentMethod || null,
        payer: dto.payer || null,
        remark: dto.remark || null,
      })
      const savedPayment = await this.paymentRepo.save(payment)

      // 5. 更新订单已收金额 + 重算三维状态
      await this.salesOrderService.updateReceivedAmount(
        dto.orderId,
        dto.usdAmount,
        dto.cnyAmount,
      )

      this.logger.log(
        `收款成功: ${paymentNo}, 订单: ${order.orderNo}, $${dto.usdAmount}`,
      )
      return savedPayment
    })
  }

  /**
   * 查询收款详情
   */
  async findOne(id: string): Promise<Payment> {
    const payment = await this.paymentRepo.findOne({ where: { id } })
    if (!payment) throw new BadRequestException('收款记录不存在')
    return payment
  }

  /**
   * 分页查询收款列表
   */
  async findAll(query: QueryPaymentDto) {
    const page = query.page || 1
    const pageSize = query.pageSize || 20

    const qb = this.paymentRepo.createQueryBuilder('p')

    if (query.paymentNo) {
      qb.andWhere('p.paymentNo LIKE :no', { no: `%${query.paymentNo}%` })
    }
    if (query.orderId) {
      qb.andWhere('p.orderId = :orderId', { orderId: query.orderId })
    }
    if (query.startDate) {
      qb.andWhere('p.paymentDate >= :startDate', { startDate: query.startDate })
    }
    if (query.endDate) {
      qb.andWhere('p.paymentDate <= :endDate', { endDate: query.endDate })
    }

    qb.orderBy('p.createdTime', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)

    const [list, total] = await qb.getManyAndCount()
    return { list, total, page, pageSize }
  }
}
