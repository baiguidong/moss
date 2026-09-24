const [, entryPath, marker] = process.argv
if (!entryPath || !marker?.startsWith('--moss-app-process=') || !process.connected) process.exit(1)

// Do not execute App code until the Host has durably recorded this process.
// If the Host dies first, the unique marker still lets its successor find us.
let launched = false
process.once('disconnect', () => {
  if (!launched) process.exit(0)
  // Allow the App SDK's disconnect cleanup to finish, with a bounded fallback
  // for Backends that leave handles open after losing their Host.
  setTimeout(() => process.exit(0), 5_000).unref()
})
await new Promise(resolve => {
  const launch = message => {
    if (message?.type !== 'moss.app.launch' || message.marker !== marker) return
    process.off('message', launch)
    resolve()
  }
  process.on('message', launch)
  process.send({ type: 'moss.app.bootstrap', marker })
})
if (!process.connected) process.exit(0)
launched = true
process.argv = [process.argv[0], entryPath]
// Node runs the actual main module after this preload resolves. Keep its main
// module semantics, and do not pass our preload to child_process.fork() calls.
process.execArgv = []
