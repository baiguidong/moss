const identity = {
  generation: Number(process.env.MOSS_APP_GENERATION),
  launchToken: process.env.MOSS_APP_LAUNCH_TOKEN,
}
const send = (type, payload = {}, id = crypto.randomUUID()) => process.send?.({
  version: 1,
  id,
  type,
  timestamp: Date.now(),
  payload: { ...payload, ...identity },
})
process.on('message', (message) => {
  if (message.type === 'service.init') {
    send('service.ready', {}, message.id)
    setTimeout(() => process.exit(17), 10)
  }
})
send('service.hello', {
  appId: process.env.MOSS_APP_ID,
  version: process.env.MOSS_APP_VERSION,
  apiVersion: 1,
  instanceId: process.env.MOSS_APP_INSTANCE_ID,
})
