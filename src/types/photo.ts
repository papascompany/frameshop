/**
 * Photo asset types (uploaded user photo + EXIF metadata).
 *
 * Sources: docs/specs/photo.md, PLAN.md §6 `photos` table.
 * HANDOFF note: `sessionId` column added to support anonymous photo
 * isolation (`photos/anon/<sessionId>/<uuid>.jpg` storage path).
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import type { IsoTimestamp, PhotoId, SessionId, UserId } from './common';

// ---------- Domain types ----------

/** EXIF orientation: 1..8 per spec. */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type ExifMeta = {
  orientation: ExifOrientation;
  width?: number;
  height?: number;
  takenAt?: IsoTimestamp;
};

export type Photo = {
  id: PhotoId;
  userId: UserId | null;
  /** Anonymous session ID when userId is null (Storage path prefix). */
  sessionId: SessionId | null;
  originalUrl: string;
  thumbUrl: string;
  widthPx: number | null;
  heightPx: number | null;
  exif: ExifMeta | null;
  createdAt: IsoTimestamp;
};

// ---------- UI state ----------

export type PhotoSource = 'device' | 'cloud' | 'stock';

export type UploadOptions = {
  sessionId?: SessionId;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
};

export type UploadResult = {
  photo: Photo;
  /** In-memory base64 for immediate canvas use; not persisted. */
  resizedDataUrl: string;
};

export type UploadErrorCode =
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_MIME'
  | 'UPLOAD_FAILED'
  | 'EXIF_PARSE_FAILED'
  | 'EMPTY_FILE'
  | 'MAGIC_BYTES_MISMATCH';

export class PhotoUploadError extends Error {
  public readonly code: UploadErrorCode;

  constructor(code: UploadErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'PhotoUploadError';
  }
}

// ---------- Constants ----------

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const LONG_EDGE_RESIZE_PX = 1600;
export const THUMB_LONG_EDGE_PX = 400;
export const ALLOWED_PHOTO_MIME = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const;
export type AllowedPhotoMime = (typeof ALLOWED_PHOTO_MIME)[number];

// ---------- Zod schemas ----------

export const exifOrientationSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

export const exifMetaSchema = z.object({
  orientation: exifOrientationSchema,
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  takenAt: z.string().optional(),
});

export const photoSourceSchema = z.enum(['device', 'cloud', 'stock']);

export const allowedPhotoMimeSchema = z.enum(ALLOWED_PHOTO_MIME);
