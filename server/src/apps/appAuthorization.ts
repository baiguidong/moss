import type { AuthContext } from '../auth/token.js'
import type { AuthService } from '../auth/service.js'

export type AppAuthorizationScope = 'apps:read' | 'apps:manage' | 'apps:deploy' | 'apps:logs'

export function requireAppScope(authService: AuthService, auth: AuthContext, scope: AppAuthorizationScope): void {
  authService.requireScope(auth, scope)
}
