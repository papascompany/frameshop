/**
 * 법적 고지 실값 해석 — 정적 SSOT(`company.ts`) + 어드민 설정(app_settings) 오버라이드.
 *
 * `company.ts` 는 클라이언트에서도 import 되므로(server-only 금지) 순수 상수로
 * 두고, **DB 오버라이드가 필요한 값만** 이 server-only 모듈에서 병합한다.
 *
 * 목적: 법률 자문·통신판매업 신고·도메인 확정처럼 "나중에 확정되는" 값들을
 * 재배포 없이 어드민에서 채울 수 있게 한다. 미설정이면 기존 정적 값 그대로라
 * 현행 동작이 바뀌지 않는다(graceful).
 */

import 'server-only';
import { unstable_cache } from 'next/cache';
import { getSettings } from '@/lib/db/settings';
import {
  COMPANY,
  LEGAL_DRAFT_NOTICE,
  LEGAL_EFFECTIVE_DATE,
  PRIVACY_PROCESSORS,
} from './company';

/** 어드민 설정 화면(회사·법적 정보 탭)에서 다루는 키 목록. */
export const LEGAL_SETTING_KEYS = [
  'company_email',
  'company_mail_order_no',
  'company_hosting',
  'company_courier',
  'legal_effective_date',
  'legal_draft_notice_hidden',
] as const;

/** 캐시 무효화 태그 — 어드민 저장 시 revalidateTag 로 즉시 반영. */
export const LEGAL_SETTINGS_TAG = 'legal-settings';

export type ResolvedCompany = Omit<
  typeof COMPANY,
  'email' | 'mailOrderSalesNo' | 'hosting'
> & {
  email: string;
  mailOrderSalesNo: string;
  hosting: string;
};

export type LegalInfo = {
  company: ResolvedCompany;
  processors: { name: string; task: string }[];
  effectiveDate: string;
  /** 법률 자문 완료 후 어드민에서 숨김 처리 가능한 초안 배너. */
  draftNotice: string | null;
};

function pick(
  settings: Record<string, string>,
  key: string,
  fallback: string,
): string {
  const value = settings[key];
  return value && value.trim() !== '' ? value.trim() : fallback;
}

/**
 * Footer 는 모든 페이지에서 렌더되므로 요청마다 DB 를 치지 않도록 캐시한다
 * (shipping 과 동일한 패턴). 어드민 저장 시 태그 무효화로 즉시 반영.
 */
const loadLegalSettings = unstable_cache(
  async (): Promise<Record<string, string>> => {
    return getSettings([...LEGAL_SETTING_KEYS]).catch(
      (): Record<string, string> => ({}),
    );
  },
  ['legal-settings'],
  { revalidate: 300, tags: [LEGAL_SETTINGS_TAG] },
);

export async function getLegalInfo(): Promise<LegalInfo> {
  const settings: Record<string, string> = await loadLegalSettings().catch(
    (): Record<string, string> => ({}),
  );

  const courier = settings['company_courier']?.trim();
  const processors = PRIVACY_PROCESSORS.map((p) =>
    // 배송사(택배사) 항목만 확정값으로 치환 — 나머지는 정적 정의 유지.
    courier && p.name.startsWith('배송사')
      ? { name: courier, task: p.task }
      : { name: p.name, task: p.task },
  );

  return {
    company: {
      ...COMPANY,
      email: pick(settings, 'company_email', COMPANY.email),
      mailOrderSalesNo: pick(
        settings,
        'company_mail_order_no',
        COMPANY.mailOrderSalesNo,
      ),
      hosting: pick(settings, 'company_hosting', COMPANY.hosting),
    },
    processors,
    effectiveDate: pick(
      settings,
      'legal_effective_date',
      LEGAL_EFFECTIVE_DATE,
    ),
    draftNotice:
      settings['legal_draft_notice_hidden']?.trim().toLowerCase() === 'true'
        ? null
        : LEGAL_DRAFT_NOTICE,
  };
}
