/**
 * Server actions for `/admin/options` (product_variants 매트릭스 + CSV import).
 */

'use server';

import { revalidatePath } from 'next/cache';
import { asBrand } from '@/types/common';
import type { ProductId } from '@/types/common';
import {
  variantInputSchema,
  type ImportReport,
  type VariantImportError,
  type VariantInput,
} from '@/types/admin';
import { importVariants, requireAdmin } from '@/lib/db/admin';

export type ImportActionResult =
  | { ok: true; report: ImportReport }
  | { ok: false; error: string };

export type ParsedRow = {
  row: number;
  data?: VariantInput;
  error?: VariantImportError;
};

const REQUIRED_HEADERS = [
  'size_code',
  'size_label',
  'width_mm',
  'height_mm',
  'color_code',
  'matte_code',
  'paper_code',
  'price',
  'stock',
] as const;

const OPTIONAL_HEADERS = ['is_active'] as const;

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function detectDelimiter(headerLine: string): ',' | '\t' {
  return headerLine.includes('\t') ? '\t' : ',';
}

/**
 * Parse CSV/TSV text → typed rows. Header order is flexible; required headers
 * must all be present. UTF-8 BOM is stripped. Errors are collected per row.
 */
export async function parseVariantCsvAction(
  productId: string,
  text: string,
): Promise<{ rows: VariantInput[]; errors: VariantImportError[] }> {
  try {
    await requireAdmin();
  } catch {
    return {
      rows: [],
      errors: [{ row: 0, field: 'auth', message: '관리자 권한이 필요합니다.' }],
    };
  }

  const clean = stripBom(text).replace(/\r\n/g, '\n').trim();
  if (clean.length === 0) {
    return {
      rows: [],
      errors: [{ row: 0, field: 'body', message: '빈 입력입니다.' }],
    };
  }

  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  const headerLine = lines[0]!;
  const delim = detectDelimiter(headerLine);
  const headers = headerLine.split(delim).map((h) => h.trim());

  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [
        {
          row: 0,
          field: 'header',
          message: `필수 헤더 누락: ${missing.join(', ')}`,
        },
      ],
    };
  }

  const idx = (name: string) => headers.indexOf(name);
  const idxs = {
    sizeCode: idx('size_code'),
    sizeLabel: idx('size_label'),
    widthMm: idx('width_mm'),
    heightMm: idx('height_mm'),
    colorCode: idx('color_code'),
    matteCode: idx('matte_code'),
    paperCode: idx('paper_code'),
    price: idx('price'),
    stock: idx('stock'),
    isActive: OPTIONAL_HEADERS.includes('is_active') ? idx('is_active') : -1,
  };

  const rows: VariantInput[] = [];
  const errors: VariantImportError[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNo = i + 1; // 1-based; row 1 is header.
    const cols = lines[i]!.split(delim).map((c) => c.trim());
    const raw = {
      productId,
      sizeCode: cols[idxs.sizeCode] ?? '',
      sizeLabel: cols[idxs.sizeLabel] ?? '',
      widthMm: Number(cols[idxs.widthMm] ?? ''),
      heightMm: Number(cols[idxs.heightMm] ?? ''),
      colorCode: cols[idxs.colorCode] ?? '',
      matteCode: (cols[idxs.matteCode] ?? '') as 'none' | 'with',
      paperCode: (cols[idxs.paperCode] ?? '') as 'glossy' | 'matte' | 'fineart',
      price: Number(cols[idxs.price] ?? ''),
      stock: Number(cols[idxs.stock] ?? ''),
      isActive:
        idxs.isActive >= 0
          ? (cols[idxs.isActive] ?? 'true').toLowerCase() !== 'false'
          : true,
    };

    const parsed = variantInputSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({
        row: lineNo,
        field: parsed.error.issues[0]?.path.join('.') ?? 'unknown',
        message: parsed.error.issues[0]?.message ?? 'validation failed',
      });
      continue;
    }
    rows.push({
      ...parsed.data,
      productId: asBrand<ProductId>(productId),
    } as VariantInput);
  }

  return { rows, errors };
}

export async function importVariantsAction(
  productId: string,
  text: string,
): Promise<ImportActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  const parsed = await parseVariantCsvAction(productId, text);
  if (parsed.rows.length === 0) {
    return {
      ok: true,
      report: {
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: parsed.errors,
      },
    };
  }
  try {
    const report = await importVariants(
      asBrand<ProductId>(productId),
      parsed.rows,
    );
    // Merge CSV-level parse errors into the DB-level report.
    report.errors = [...parsed.errors, ...report.errors];
    revalidatePath('/admin/options');
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}

export async function upsertSingleVariantAction(
  productId: string,
  input: Omit<VariantInput, 'productId'>,
): Promise<ImportActionResult> {
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  const parsed = variantInputSchema.safeParse({ ...input, productId });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? '검증 실패',
    };
  }
  try {
    const report = await importVariants(asBrand<ProductId>(productId), [
      { ...parsed.data, productId: asBrand<ProductId>(productId) } as VariantInput,
    ]);
    revalidatePath('/admin/options');
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
