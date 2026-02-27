import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.string().optional(),
  JWT_SECRET: z.string().optional(),
  SETTINGS_ENCRYPTION_KEY: z.string().optional(),
  INTAKE_SHARED_SECRET: z.string().optional(),
  UPLOADS_DIR: z.string().optional(),
  FRONTEND_URL: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  INVOICE_NINJA_WEBHOOK_SECRET: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional()
});

const env = envSchema.parse(process.env);
const isProd = env.NODE_ENV === 'production';

function requireProd(name: string, value?: string) {
  if (isProd && (!value || value.trim().length === 0)) {
    throw new Error(`Missing required env var ${name} in production`);
  }
}

requireProd('DATABASE_URL', env.DATABASE_URL);
requireProd('JWT_SECRET', env.JWT_SECRET);
requireProd('SETTINGS_ENCRYPTION_KEY', env.SETTINGS_ENCRYPTION_KEY);
requireProd('INTAKE_SHARED_SECRET', env.INTAKE_SHARED_SECRET);
requireProd('FRONTEND_URL', env.FRONTEND_URL);

// Validate JWT_SECRET minimum length in production
if (isProd && env.JWT_SECRET && env.JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET must be at least 32 characters in production. ' +
    'Generate a strong secret with: openssl rand -base64 32'
  );
}

// Validate SETTINGS_ENCRYPTION_KEY is exactly 64 hex characters (32 bytes) in production
if (isProd && env.SETTINGS_ENCRYPTION_KEY) {
  if (env.SETTINGS_ENCRYPTION_KEY.length !== 64) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) in production. ' +
      'Generate a valid key with: openssl rand -hex 32'
    );
  }
  // Verify it's valid hex
  if (!/^[0-9a-fA-F]{64}$/.test(env.SETTINGS_ENCRYPTION_KEY)) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY must contain only hexadecimal characters (0-9, a-f). ' +
      'Generate a valid key with: openssl rand -hex 32'
    );
  }
}

const frontendOrigins = (env.FRONTEND_URL ?? 'http://localhost:5173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

export const config = {
  env: env.NODE_ENV,
  port: Number(env.PORT ?? 4000),
  jwtSecret: env.JWT_SECRET ?? 'dev-secret',
  encryptionKey: env.SETTINGS_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef',
  intakeSecret: env.INTAKE_SHARED_SECRET ?? 'dev-intake-secret',
  uploadsDir: env.UPLOADS_DIR ?? 'uploads',
  frontendOrigins,
  invoiceNinjaWebhookSecret: env.INVOICE_NINJA_WEBHOOK_SECRET,
  anthropicApiKey: env.ANTHROPIC_API_KEY
};
