/**
 * TypeORM Mock 工厂
 * 提供 Repository、QueryBuilder、DataSource 等对象的 mock 实现
 * 用于单元测试中替代真实数据库连接
 */

/** 创建 mock QueryBuilder（支持链式调用） */
export function createMockQueryBuilder() {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orWhere: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    having: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    forUpdate: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getOne: jest.fn().mockResolvedValue(null),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getCount: jest.fn().mockResolvedValue(0),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue(null),
    execute: jest.fn().mockResolvedValue([]),
    getQuery: jest.fn().mockReturnValue(''),
  }
  return qb
}

/** 创建 mock Repository */
export function createMockRepository<T = any>() {
  return {
    create: jest.fn((data?: any) => ({ id: '1', ...data })),
    save: jest.fn((entity: any) => Promise.resolve({ id: '1', ...entity })),
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findBy: jest.fn().mockResolvedValue([]),
    findOneBy: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    remove: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
    manager: {
      getRepository: jest.fn().mockReturnThis(),
      transaction: jest.fn((cb: Function) => cb(mockEntityManager)),
    },
    metadata: {
      columns: [],
    },
  } as any
}

/** 创建 mock EntityManager */
export const mockEntityManager = {
  create: jest.fn((_: any, data?: any) => ({ id: '1', ...data })),
  save: jest.fn((entity: any) => Promise.resolve({ id: '1', ...entity })),
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn().mockResolvedValue(null),
  delete: jest.fn().mockResolvedValue({ affected: 1 }),
  update: jest.fn().mockResolvedValue({ affected: 1 }),
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn(() => createMockQueryBuilder()),
  query: jest.fn().mockResolvedValue([]),
}

/** 创建 mock DataSource */
export function createMockDataSource() {
  return {
    transaction: jest.fn((cb: Function) => cb(mockEntityManager)),
    getRepository: jest.fn().mockReturnValue(createMockRepository()),
    manager: mockEntityManager,
    initialize: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
  } as any
}

/** 创建 mock Redis 客户端 */
export function createMockRedis() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(-1),
    hget: jest.fn().mockResolvedValue(null),
    hset: jest.fn().mockResolvedValue(1),
    hdel: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
    quit: jest.fn().mockResolvedValue('OK'),
  } as any
}
