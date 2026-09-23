import { afterEach, describe, expect, it } from 'bun:test'
import http from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { downloadFileBuffer } from '../src/download-utils.mjs'

const servers: http.Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.close(() => resolve())
    server.closeAllConnections()
  })))
})

async function serve(handler: http.RequestListener) {
  const server = http.createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('Download progress', () => {
  it('reports bytes before a redirected download finishes and flushes the final count', async () => {
    let finishResponse: () => void = () => {}
    let sendNextChunk: () => void = () => {}
    let partialReceived: () => void = () => {}
    const partial = new Promise<void>((resolve) => { partialReceived = resolve })
    const url = await serve((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/file' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-length': '12' })
      response.write('abc')
      sendNextChunk = () => {
        const timer = setTimeout(() => response.write('def'), 150)
        response.on('close', () => clearTimeout(timer))
      }
      finishResponse = () => response.end('ghijkl')
    })
    const progress: Array<{ receivedBytes: number; totalBytes: number | null }> = []
    let completed = false
    const download = downloadFileBuffer(`${url}/redirect`, {
      onProgress: (value: (typeof progress)[number]) => {
        progress.push(value)
        if (value.receivedBytes === 0) sendNextChunk()
        if (value.receivedBytes === 6) partialReceived()
      },
    }).then((buffer: Buffer) => { completed = true; return buffer })
    await partial
    expect(completed).toBe(false)
    expect(progress.at(-1)).toEqual({ receivedBytes: 6, totalBytes: 12 })
    finishResponse()
    expect((await download).toString()).toBe('abcdefghijkl')
    expect(progress[0]).toEqual({ receivedBytes: 0, totalBytes: 12 })
    expect(progress.at(-1)).toEqual({ receivedBytes: 12, totalBytes: 12 })
  })

  it('keeps the total unknown for chunked responses', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'transfer-encoding': 'chunked' })
      response.write('abc')
      response.end('def')
    })
    const progress: unknown[] = []
    expect((await downloadFileBuffer(url, { onProgress: (value: unknown) => progress.push(value) })).toString()).toBe('abcdef')
    expect(progress.at(-1)).toEqual({ receivedBytes: 6, totalBytes: null })
  })

  it('still rejects oversized responses when progress is enabled', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': '6' })
      response.end('abcdef')
    })
    const progress: unknown[] = []
    await expect(downloadFileBuffer(url, { maxBytes: 3, onProgress: (value: unknown) => progress.push(value) })).rejects.toThrow('exceeds size limit')
    expect(progress).toHaveLength(0)
  })

  it('rejects interrupted downloads without reporting a completed byte count', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-length': '100' })
      response.write('abc')
      const timer = setTimeout(() => response.destroy(), 20)
      response.on('close', () => clearTimeout(timer))
    })
    const progress: Array<{ receivedBytes: number }> = []
    await expect(downloadFileBuffer(url, { onProgress: (value: (typeof progress)[number]) => progress.push(value) })).rejects.toThrow()
    expect(progress.every((value) => value.receivedBytes < 100)).toBe(true)
  })
})
