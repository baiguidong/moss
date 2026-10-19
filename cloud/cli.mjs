#!/usr/bin/env node
import http from 'node:http';
const [command = 'list', id, image] = process.argv.slice(2);
if (!['list', 'stop', 'upgrade', 'adopt'].includes(command) || command !== 'list' && !id || command === 'upgrade' && !image) {
  console.error('Usage: node cloud/cli.mjs list | adopt <full-container-id> | stop <environment-id> | upgrade <environment-id> <local-image>'); process.exit(1);
}
const data = command === 'list' ? null : JSON.stringify({ id, image });
const req = http.request({ socketPath: `${process.env.MOSS_CLOUD_STATE || '/state'}/admin.sock`, path: command === 'list' ? '/environments' : `/${command}`,
  method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json' } : {} }, res => {
  let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => {
    console.log(JSON.stringify(JSON.parse(body), null, 2)); if (res.statusCode >= 300) process.exitCode = 1;
  });
});
req.setTimeout(600000, () => req.destroy(new Error('Control operation timed out')));
req.on('error', error => { console.error(error.message); process.exitCode = 1; }); req.end(data);
