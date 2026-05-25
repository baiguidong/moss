export const SYSTEM_SECRET_SUBJECT = 'system:moss'

/**
 * 命名空间 → Nexus 调用主体。
 * system:* 共享一个固定主体，使企业秘钥与具体管理员解耦；
 * 其它命名空间（user:{userId}:*）以传入的 userId 为主体。
 */
export function secretSubject(namespace: string, userId: string): string {
  return namespace.startsWith('system:') ? SYSTEM_SECRET_SUBJECT : userId
}
