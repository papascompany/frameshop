/**
 * Curation types (landing page banners / collections / features).
 *
 * Sources: docs/specs/landing.md, docs/specs/admin.md, ADR-007.
 * HANDOFF note: `curations.payload` is `jsonb` with per-type Zod schemas
 * (BannerPayload / CollectionPayload / FeaturePayload).
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import { z } from 'zod';
import { httpsUrl } from '../lib/validation/url';
import type { CurationId, IsoTimestamp, ProductId } from './common';

// ---------- Enums ----------

export const CURATION_TYPES = ['banner', 'collection', 'feature'] as const;
export type CurationType = (typeof CURATION_TYPES)[number];

export const CURATION_DEVICES = ['all', 'pc', 'mobile'] as const;
export type CurationDevice = (typeof CURATION_DEVICES)[number];

// ---------- Per-type payload shapes ----------

export type BannerPayload = {
  imageUrl: string;
  link?: string;
  title?: string;
  subtitle?: string;
};

export type CollectionPayload = {
  productIds: ProductId[];
  subtitle?: string;
};

export type FeaturePayload = {
  productId: ProductId;
  pitch: string;
};

/** Discriminated union so consumers can switch on `type`. */
export type CurationPayload =
  | ({ type: 'banner' } & BannerPayload)
  | ({ type: 'collection' } & CollectionPayload)
  | ({ type: 'feature' } & FeaturePayload);

// ---------- Table row ----------

export type Curation = {
  id: CurationId;
  type: CurationType;
  title: string | null;
  payload: unknown; // validate at IO boundary with the schemas below
  device: CurationDevice;
  startAt: IsoTimestamp | null;
  endAt: IsoTimestamp | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: IsoTimestamp;
};

/** Result of `validateCurationPayload`. */
export type PayloadValidation<T> =
  | { ok: true; payload: T }
  | { ok: false; error: string };

// ---------- Zod schemas ----------

export const curationTypeSchema = z.enum(CURATION_TYPES);
export const curationDeviceSchema = z.enum(CURATION_DEVICES);

export const bannerPayloadSchema = z.object({
  // https-only: blocks `javascript:`/`data:` URI XSS even if an admin
  // account is compromised (see ADR-016, P1-07).
  imageUrl: httpsUrl(),
  link: httpsUrl().optional(),
  title: z.string().max(80).optional(),
  subtitle: z.string().max(160).optional(),
});

export const collectionPayloadSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1).max(20),
  subtitle: z.string().max(160).optional(),
});

export const featurePayloadSchema = z.object({
  productId: z.string().min(1),
  pitch: z.string().min(1).max(160),
});

/** Picks the right payload schema given the curation's `type`. */
export function payloadSchemaFor(type: CurationType) {
  switch (type) {
    case 'banner':
      return bannerPayloadSchema;
    case 'collection':
      return collectionPayloadSchema;
    case 'feature':
      return featurePayloadSchema;
  }
}
