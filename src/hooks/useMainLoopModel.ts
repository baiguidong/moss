import { useEffect, useReducer } from 'react'
import { onFeatureFlagsRefresh } from '../services/analytics/featureFlags.js'
import { useAppState } from '../state/AppState.js'
import {
  getDefaultMainLoopModelSetting,
  type ModelName,
  parseUserSpecifiedModel,
} from '../utils/model/model.js'

// The value of the selector is a full model name that can be used directly in
// API calls. Use this over getMainLoopModel() when the component needs to
// update upon a model config change.
export function useMainLoopModel(): ModelName {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)

  // Local feature overrides can affect model resolution, but do not update
  // AppState directly. Subscribe to refresh signals so UI model labels re-resolve.
  const [, forceRerender] = useReducer(x => x + 1, 0)
  useEffect(() => onFeatureFlagsRefresh(forceRerender), [])

  const model = parseUserSpecifiedModel(
    mainLoopModelForSession ??
      mainLoopModel ??
      getDefaultMainLoopModelSetting(),
  )
  return model
}
