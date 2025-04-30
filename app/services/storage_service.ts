import env from '#start/env'
import * as Minio from 'minio'
import { Readable } from 'stream'

const minioClient = new Minio.Client({
  endPoint: env.get('MINIO_ENDPOINT_KEY'),
  port: 9000,
  useSSL: true,
  accessKey: env.get('MINIO_ACCESS_KEY'),
  secretKey: env.get('MINIO_SECRET_KEY'),
  region: 'default',
})

export async function ensurePublicBucket(bucketName: string) {
  const exists = await minioClient.bucketExists(bucketName)
  if (!exists) {
    await minioClient.makeBucket(bucketName)
  }

  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucketName}/*`],
      },
    ],
  }

  await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy))
}

export async function uploadFromUrl(url: string, bucket: string, name: string) {
  await ensurePublicBucket(bucket)

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }

  const contentLength = res.headers.get('content-length')
  const contentType = res.headers.get('content-type') ?? undefined

  if (!res.body) {
    throw new Error('Response body is null')
  }
  const nodeStream = Readable.fromWeb(res.body)

  await minioClient.putObject(
    bucket,
    name,
    nodeStream,
    contentLength ? Number(contentLength) : undefined,
    { 'Content-Type': contentType }
  )

  const endpoint = env.get('MINIO_ENDPOINT_KEY')
  return `https://${endpoint}/${bucket}/${name}`
}
