// A desktop app can outlive the terminal or pipe it inherited at launch.
// Handle stream errors here: console writes can emit them asynchronously.
export function registerProcessOutputErrorHandlers({ stdout = process.stdout, stderr = process.stderr } = {}) {
  const streams = new Set([stdout, stderr]);
  const onError = error => {
    if (error?.code === 'EIO' || error?.code === 'EPIPE') return;
    throw error;
  };
  for (const stream of streams) stream.on('error', onError);
  return () => {
    for (const stream of streams) stream.off('error', onError);
  };
}
