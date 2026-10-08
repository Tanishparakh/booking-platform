import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function secret(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd) throw new Error(`${name} must be set in production`);
  return devDefault;
}

export const config = {
  isProd,
  isTest,
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/booking',
  jwtSecret: secret('JWT_SECRET', 'dev-only-jwt-secret-change-me'),
  // 32-byte key (64 hex chars) used for AES-256-GCM encryption of stored files
  storageKeyHex: secret('STORAGE_ENCRYPTION_KEY', '0'.repeat(64)),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  storage: {
    driver: (process.env.STORAGE_DRIVER || 'local') as 'local' | 's3',
    dir: path.resolve(process.env.STORAGE_DIR || './storage'),
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY || 'minioadmin',
    bucket: process.env.S3_BUCKET || 'booking-files',
    region: process.env.S3_REGION || 'us-east-1',
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 1025),
    from: process.env.MAIL_FROM || 'Booking Platform <no-reply@booking.local>',
  },
  tls: {
    keyFile: process.env.TLS_KEY_FILE || '',
    certFile: process.env.TLS_CERT_FILE || '',
  },
};
