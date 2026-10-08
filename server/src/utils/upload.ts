import multer from 'multer';
import { badRequest } from './errors';

const MB = 1024 * 1024;

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const DELIVERABLE_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES, 'application/zip', 'application/x-zip-compressed', 'application/pdf'];

/** In-memory upload handler that only accepts the listed content types. */
export function uploader(allowed: string[], maxMb: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * MB, files: 20 },
    fileFilter: (_req, file, cb) => {
      if (!allowed.includes(file.mimetype)) return cb(badRequest(`File type ${file.mimetype} is not allowed`));
      cb(null, true);
    },
  });
}
