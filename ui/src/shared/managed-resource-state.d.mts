export type ManagedCatalogEntry = {
  id: string
  kind: 'skill' | 'expert'
  name: string
  displayName: string
  description: string
  source: string
  enabled: boolean
}
export function readManagedCatalog(home: string): { resources: ManagedCatalogEntry[] } | null
export function readManagedControlState(home: string): { enabled: boolean; resources?: ManagedCatalogEntry[]; disabledForAccount?: string } | null
