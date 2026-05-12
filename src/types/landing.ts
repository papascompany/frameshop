/**
 * Landing-page composition types.
 *
 * Sources: docs/specs/landing.md.
 *
 * FROZEN: 2026-05-12 by Architect.
 */

import type { CategoryTreeNode, ProductListItem } from './product';
import type { Curation, CurationDevice } from './curation';

export type LandingData = {
  categories: CategoryTreeNode[];
  curations: Curation[];
  /** Sample of products keyed by category id, used by CategoryGrid. */
  representativeProducts: Record<string, ProductListItem | null>;
};

export type LandingDeviceQuery = {
  device: CurationDevice;
  now: Date;
};

export type ResolvedHeroBanner = {
  curation: Curation;
  imageUrl: string;
  title: string | null;
  subtitle: string | null;
  link: string | null;
};

export type ResolvedFeaturedCollection = {
  curation: Curation;
  products: ProductListItem[];
  subtitle: string | null;
};
