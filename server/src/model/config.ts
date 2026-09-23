import { z } from 'zod/v4'

export const databaseConfigSchema = z.discriminatedUnion('driver', [
  z
    .object({
      driver: z.literal('sqlite'),
      filename: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      driver: z.literal('mysql'),
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535).default(3306),
      database: z.string().regex(/^[a-zA-Z0-9_]+$/),
      userEnv: z.string().min(1).default('MOSS_DB_USER'),
      passwordEnv: z.string().min(1).default('MOSS_DB_PASSWORD'),
      connectionLimit: z.number().int().min(1).max(100).default(10),
      connectTimeoutMs: z.number().int().min(100).max(60000).default(10000),
    })
    .strict(),
])

export type DatabaseConfig = z.infer<typeof databaseConfigSchema>
