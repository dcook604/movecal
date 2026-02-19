import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  encryptionKey: process.env.SETTINGS_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef',
  intakeSecret: process.env.INTAKE_SHARED_SECRET ?? 'dev-intake-secret',
  uploadsDir: process.env.UPLOADS_DIR ?? 'uploads',
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173'
};
