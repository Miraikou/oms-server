import { Injectable } from '@nestjs/common'
import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  UpdateEvent,
} from 'typeorm'
import { requestContext } from '../context/request-context'

/**
 * 审计字段自动填充订阅者
 * 对所有实体在 insert 时自动设置 createdBy，update 时自动设置 updatedBy
 * 不限制具体实体类型，通过动态属性检查兼容所有继承/不继承 BaseEntity 的实体
 */
@Injectable()
@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface {
  beforeInsert(event: InsertEvent<unknown>) {
    const userId = requestContext.userId
    if (!userId) return
    const entity = event.entity as Record<string, unknown>
    if ('createdBy' in entity) {
      entity.createdBy = userId
    }
  }

  beforeUpdate(event: UpdateEvent<unknown>) {
    const userId = requestContext.userId
    if (!userId) return
    if (!event.entity) return
    const entity = event.entity as Record<string, unknown>
    if ('updatedBy' in entity) {
      entity.updatedBy = userId
    }
  }
}
