import { Readable } from 'node:stream'
import {
  S3Client, HeadBucketCommand, HeadObjectCommand, GetObjectCommand, PutObjectCommand,
  DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand,
  ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import type { ServerConfig } from '../types.js'
import { ServerCredentialStore } from '../security/credentialStore.js'

export type Part = { number: number; size: number; etag: string }
export interface ObjectStore {
  identity: string
  ready(): Promise<void>
  head(key: string): Promise<{ size: number; revision?: string } | null>
  get(key: string, range?: string, signal?: AbortSignal): Promise<Readable>
  putEmpty(key: string, revision: string): Promise<void>
  delete(key: string): Promise<void>
  initiate(key: string, revision: string): Promise<string>
  part(key: string, uploadId: string, number: number, body: Readable, size: number, signal: AbortSignal): Promise<string>
  parts(key: string, uploadId: string): Promise<Part[]>
  complete(key: string, uploadId: string, parts: Part[]): Promise<void>
  abort(key: string, uploadId: string): Promise<void>
  multipart(key: string): Promise<string[]>
  close(): void
}

export class S3ObjectStore implements ObjectStore {
  readonly client: S3Client
  readonly identity: string
  constructor(readonly config: NonNullable<ServerConfig['cloudStorage']>, credentials: { accessKeyId: string; secretAccessKey: string }) {
    this.identity = JSON.stringify([config.endpoint || 'aws', config.region, config.bucket])
    this.client = new S3Client({
      endpoint: config.endpoint, region: config.region, forcePathStyle: config.forcePathStyle, credentials,
      // Never transparently replay a consumed request stream. The Host retries the part.
      maxAttempts: 1, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: new NodeHttpHandler({ connectionTimeout: 10000, socketTimeout: 120000, requestTimeout: 15 * 60000, throwOnRequestTimeout: true, httpsAgent: { maxSockets: 32 }, httpAgent: { maxSockets: 32 } }),
    })
  }
  private base(key: string) { return { Bucket: this.config.bucket, Key: key } }
  async ready() { await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }), { abortSignal: AbortSignal.timeout(10000) }) }
  async head(key: string) {
    try {
      const v = await this.client.send(new HeadObjectCommand(this.base(key)))
      return { size: v.ContentLength!, revision: v.Metadata?.revision }
    } catch (e: any) { if (e.$metadata?.httpStatusCode === 404) return null; throw e }
  }
  async get(key: string, range?: string, signal?: AbortSignal) {
    const v = await this.client.send(new GetObjectCommand({ ...this.base(key), Range: range }), { abortSignal: signal })
    return v.Body as Readable
  }
  async putEmpty(key: string, revision: string) { await this.client.send(new PutObjectCommand({ ...this.base(key), Body: Buffer.alloc(0), Metadata: { revision } })) }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand(this.base(key))) }
  async initiate(key: string, revision: string) {
    const v = await this.client.send(new CreateMultipartUploadCommand({ ...this.base(key), Metadata: { revision }, ContentType: 'application/octet-stream' }))
    if (!v.UploadId) throw new Error('S3 did not return an upload ID')
    return v.UploadId
  }
  async part(key: string, uploadId: string, number: number, body: Readable, size: number, signal: AbortSignal) {
    const v = await this.client.send(new UploadPartCommand({ ...this.base(key), UploadId: uploadId, PartNumber: number, Body: body, ContentLength: size }), { abortSignal: signal })
    if (!v.ETag) throw new Error('S3 did not return a part ETag')
    return v.ETag
  }
  async parts(key: string, uploadId: string) {
    const result: Part[] = []
    let marker: string | undefined
    do {
      const v = await this.client.send(new ListPartsCommand({ ...this.base(key), UploadId: uploadId, PartNumberMarker: marker }))
      for (const p of v.Parts || []) result.push({ number: p.PartNumber!, size: p.Size!, etag: p.ETag! })
      marker = v.IsTruncated ? v.NextPartNumberMarker : undefined
    } while (marker)
    return result
  }
  async complete(key: string, uploadId: string, parts: Part[]) {
    await this.client.send(new CompleteMultipartUploadCommand({ ...this.base(key), UploadId: uploadId, MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.number, ETag: p.etag })) } }))
  }
  async abort(key: string, uploadId: string) {
    try { await this.client.send(new AbortMultipartUploadCommand({ ...this.base(key), UploadId: uploadId })) }
    catch (e: any) { if (e.name !== 'NoSuchUpload') throw e }
  }
  async multipart(key: string) {
    const ids: string[] = []
    let keyMarker: string | undefined, uploadMarker: string | undefined
    do {
      const v = await this.client.send(new ListMultipartUploadsCommand({ Bucket: this.config.bucket, Prefix: key, KeyMarker: keyMarker, UploadIdMarker: uploadMarker }))
      for (const u of v.Uploads || []) if (u.Key === key && u.UploadId) ids.push(u.UploadId)
      keyMarker = v.IsTruncated ? v.NextKeyMarker : undefined
      uploadMarker = v.IsTruncated ? v.NextUploadIdMarker : undefined
    } while (keyMarker)
    return ids
  }
  close() { this.client.destroy() }
}

export async function createObjectStore(config: ServerConfig, requireVerified = true): Promise<ObjectStore | null> {
  if (!config.cloudStorage?.enabled) return null
  const values = await new ServerCredentialStore(config.rootDir).get('cloud-storage', 's3')
  if (!values.accessKeyId || !values.secretAccessKey) return null
  if (requireVerified && values.verifiedTarget !== JSON.stringify([config.cloudStorage.endpoint || 'aws', config.cloudStorage.region, config.cloudStorage.bucket])) return null
  return new S3ObjectStore(config.cloudStorage, { accessKeyId: values.accessKeyId, secretAccessKey: values.secretAccessKey })
}
