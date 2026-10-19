import { connectorIdFromApp } from '../../../packages/app-sdk/src/discovery.mjs'

export const selectedConnectorIds = (appIds, apps) => {
  const byId = new Map((apps || []).map(app => [app.id || app.name, app]))
  return [...new Set((appIds || []).map(id => connectorIdFromApp(byId.get(id))).filter(Boolean))]
}
export function connectorAppCanSelect(app) {
  return Boolean(app.enabled && app.grants?.includes('connector:use') && app.connectorApp?.connection?.enabled
    && app.connectorApp.connection.connected)
}
