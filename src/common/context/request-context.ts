import { AsyncLocalStorage } from 'async_hooks'

interface RequestContext {
  userId?: string
  username?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

/**
 * 请求上下文工具
 * 基于 AsyncLocalStorage 在整个请求生命周期中传递当前用户 ID
 */
export const requestContext = {
  /** 在当前异步上下文中运行回调 */
  run(context: RequestContext, callback: () => void) {
    storage.run(context, callback)
  },

  /** 获取当前用户 ID */
  get userId(): string | undefined {
    return storage.getStore()?.userId
  },

  /** 获取当前用户名 */
  get username(): string | undefined {
    return storage.getStore()?.username
  },

  /** 设置当前用户信息 */
  setUser(user: { userId: string; username: string }) {
    const store = storage.getStore()
    if (store) {
      store.userId = user.userId
      store.username = user.username
    }
  },
}
