import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PurchaseReturn } from './entities/purchase-return.entity';
import { PurchaseReturnItem } from './entities/purchase-return-item.entity';
import { PurchaseOrder } from '@/modules/purchase/entities/purchase-order.entity';
import { PurchaseOrderItem } from '@/modules/purchase/entities/purchase-order-item.entity';
import { PurchaseOrderService } from '@/modules/purchase/purchase-order.service';
import { SequenceService } from '@/common/services/sequence.service';
import { FifoService } from '@/modules/inventory/services/fifo.service';
import { snowflake } from '@/common/utils/snowflake';
import type {
  CreatePurchaseReturnDto,
  QueryPurchaseReturnDto,
} from './dto/purchase-return.dto';

/**
 * 采购退货服务
 * 事务：校验采购单 → 校验可退数量 → 创建退货单 → FIFO 扣减库存 → 更新退货数量 → 更新退货状态
 */
@Injectable()
export class PurchaseReturnService {
  private readonly logger = new Logger(PurchaseReturnService.name);

  constructor(
    @InjectRepository(PurchaseReturn)
    private readonly returnRepo: Repository<PurchaseReturn>,
    @InjectRepository(PurchaseReturnItem)
    private readonly returnItemRepo: Repository<PurchaseReturnItem>,
    @InjectRepository(PurchaseOrder)
    private readonly orderRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderItem)
    private readonly orderItemRepo: Repository<PurchaseOrderItem>,
    private readonly sequenceService: SequenceService,
    private readonly fifoService: FifoService,
    private readonly purchaseOrderService: PurchaseOrderService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * 创建采购退货单
   */
  async create(dto: CreatePurchaseReturnDto): Promise<PurchaseReturn> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('退货明细不能为空');
    }

    return this.dataSource.transaction(async (manager) => {
      // 1. 校验采购单已入库
      const order = await manager.findOne(PurchaseOrder, {
        where: { id: dto.purchaseOrderId },
      });
      if (!order) throw new BadRequestException('采购单不存在');
      if (order.status < 2) {
        throw new BadRequestException('采购单尚未入库，无法退货');
      }

      // 2. 校验可退数量
      for (const item of dto.items) {
        const orderItem = await manager.findOne(PurchaseOrderItem, {
          where: { id: item.purchaseOrderItemId },
        });
        if (!orderItem) {
          throw new BadRequestException(
            `采购明细 ${item.purchaseOrderItemId} 不存在`,
          );
        }
        const returnQty = parseFloat(item.quantity);
        if (returnQty <= 0) throw new BadRequestException('退货数量必须大于零');

        const received = parseFloat(orderItem.receivedQuantity);
        const returned = parseFloat(orderItem.returnedQuantity);
        const returnable = received - returned;
        if (returnQty > returnable) {
          throw new BadRequestException(
            `退货数量 ${returnQty} 超过可退数量 ${returnable}`,
          );
        }
      }

      // 3. 创建退货单 + 明细
      const returnNo = await this.sequenceService.generate('PT');
      const purchaseReturn = manager.create(PurchaseReturn, {
        id: snowflake.nextId(),
        returnNo,
        purchaseOrderId: dto.purchaseOrderId,
        returnDate: new Date(dto.returnDate),
        reason: dto.reason || null,
        remark: dto.remark || null,
      });
      const savedReturn = await manager.save(purchaseReturn);

      for (const dtoItem of dto.items) {
        const orderItem = await manager.findOne(PurchaseOrderItem, {
          where: { id: dtoItem.purchaseOrderItemId },
        });
        const returnItem = manager.create(PurchaseReturnItem, {
          id: snowflake.nextId(),
          purchaseReturnId: savedReturn.id,
          purchaseOrderItemId: dtoItem.purchaseOrderItemId,
          productId: orderItem!.productId,
          productModelId: orderItem!.productModelId,
          quantity: dtoItem.quantity,
        });
        await manager.save(returnItem);

        // 4. 扣减库存（传入 manager 保证事务原子性）
        await this.fifoService.consume(
          orderItem!.productId,
          orderItem!.productModelId,
          parseFloat(dtoItem.quantity),
          savedReturn.id,
          4, // 采购退货
          manager,
        );

        // 5. 更新采购明细退货数量
        orderItem!.returnedQuantity = (
          parseFloat(orderItem!.returnedQuantity) + parseFloat(dtoItem.quantity)
        ).toFixed(4);
        await manager.save(orderItem!);
      }

      // 6. 更新采购单退货状态
      await this.purchaseOrderService.recalculateReturnStatus(
        dto.purchaseOrderId,
      );

      this.logger.log(`采购退货完成: ${returnNo}, 采购单: ${order.purchaseNo}`);
      return savedReturn;
    });
  }

  /**
   * 查询退货详情（含明细）
   */
  async findOne(id: string) {
    const ret = await this.returnRepo.findOne({ where: { id } });
    if (!ret) throw new BadRequestException('退货单不存在');
    const items = await this.returnItemRepo.find({
      where: { purchaseReturnId: id },
    });
    return { ...ret, items };
  }

  /**
   * 分页查询退货列表
   */
  async findAll(query: QueryPurchaseReturnDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const qb = this.returnRepo.createQueryBuilder('r');

    if (query.returnNo) {
      qb.andWhere('r.returnNo LIKE :no', { no: `%${query.returnNo}%` });
    }
    if (query.purchaseOrderId) {
      qb.andWhere('r.purchaseOrderId = :purchaseOrderId', {
        purchaseOrderId: query.purchaseOrderId,
      });
    }
    if (query.startDate) {
      qb.andWhere('r.returnDate >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('r.returnDate <= :endDate', { endDate: query.endDate });
    }

    const sortField = query.sortField || 'createdTime';
    const sortOrder = query.sortOrder || 'DESC';
    qb.orderBy(`r.${sortField}`, sortOrder)
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return { list, total, page, pageSize };
  }
}
