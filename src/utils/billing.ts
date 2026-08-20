import {
  getAnthropicApiKey,
  getAuthTokenSource,
} from './auth.js'
import { isEnvTruthy } from './envUtils.js'

export function hasConsoleBillingAccess(): boolean {
  // Check if cost reporting is disabled via environment variable
  if (isEnvTruthy(process.env.DISABLE_COST_WARNINGS)) {
    return false
  }

  // Check if user has any form of authentication
  const authSource = getAuthTokenSource()
  const hasApiKey = getAnthropicApiKey() !== null

  // If user has no authentication at all (logged out), don't show costs
  if (!authSource.hasToken && !hasApiKey) {
    return false
  }

  return true
}
