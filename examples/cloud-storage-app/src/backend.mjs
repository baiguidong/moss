import { AppBackendClient, createCloudStorageClient, CLOUD_STORAGE_EVENTS } from '../../../packages/app-sdk/src/index.mjs'
const backend = new AppBackendClient()
const cloud = createCloudStorageClient(backend.host)
for (const name of CLOUD_STORAGE_EVENTS) cloud.on(name, data => backend.emit('cloud.event', { name, data }))
backend.start({ request: ({ method, input }) => cloud.request(method, input || {}) })
