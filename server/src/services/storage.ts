import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { config } from '../config';

/**
 * File storage with two drivers (local disk, or MinIO/S3) behind one interface.
 * Every file is encrypted with AES-256-GCM before it is stored (AES-256 at rest).
 * Stored layout: 12-byte IV | 16-byte auth tag | ciphertext.
 */
const key = Buffer.from(config.storageKeyHex, 'hex');
if (key.length !== 32) throw new Error('STORAGE_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');

function encrypt(data: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function decrypt(blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

interface RawDriver {
  put(k: string, data: Buffer): Promise<void>;
  get(k: string): Promise<Buffer>;
  remove(k: string): Promise<void>;
}

class LocalDriver implements RawDriver {
  private file(k: string) {
    return path.join(config.storage.dir, k);
  }
  async put(k: string, data: Buffer) {
    await fs.mkdir(path.dirname(this.file(k)), { recursive: true });
    await fs.writeFile(this.file(k), data);
  }
  async get(k: string) {
    return fs.readFile(this.file(k));
  }
  async remove(k: string) {
    await fs.rm(this.file(k), { force: true });
  }
}

class S3Driver implements RawDriver {
  private client = new S3Client({
    endpoint: config.storage.endpoint,
    region: config.storage.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.storage.accessKey, secretAccessKey: config.storage.secretKey },
  });
  private ready: Promise<void> | null = null;

  private ensureBucket() {
    if (!this.ready) {
      this.ready = this.client
        .send(new HeadBucketCommand({ Bucket: config.storage.bucket }))
        .then(() => undefined)
        .catch(() => this.client.send(new CreateBucketCommand({ Bucket: config.storage.bucket })).then(() => undefined));
    }
    return this.ready;
  }
  async put(k: string, data: Buffer) {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: config.storage.bucket, Key: k, Body: data }));
  }
  async get(k: string) {
    await this.ensureBucket();
    const res = await this.client.send(new GetObjectCommand({ Bucket: config.storage.bucket, Key: k }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async remove(k: string) {
    await this.ensureBucket();
    await this.client.send(new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: k }));
  }
}

const driver: RawDriver = config.storage.driver === 's3' ? new S3Driver() : new LocalDriver();

export const storage = {
  /** Encrypts and stores a file; returns the storage key. */
  async save(folder: string, originalName: string, data: Buffer): Promise<string> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    const k = `${folder}/${crypto.randomUUID()}-${safeName}`;
    await driver.put(k, encrypt(data));
    return k;
  },
  async read(k: string): Promise<Buffer> {
    return decrypt(await driver.get(k));
  },
  async remove(k: string): Promise<void> {
    await driver.remove(k);
  },
};
