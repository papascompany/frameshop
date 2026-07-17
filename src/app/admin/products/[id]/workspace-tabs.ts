/**
 * /admin/products/[id] 워크스페이스 탭 구성 규칙 (FS-X-03, 순수 함수).
 *
 * - 탭 0~3(유형/속성/프레임/옵션)은 모든 상품에 항상 노출.
 * - 탭 4(구성규칙)/5(세트템플릿)는 확장형(extended) 전용.
 * - probe(마이그레이션 036/037 미적용) false 면 확장형이라도 해당 탭을
 *   비활성(disabled)로 노출한다 — 42703/42P01 이 UI 로 새지 않게 서버 호출
 *   자체를 게이트하고, 어드민에게는 사유를 안내한다(ADR-024 graceful 패턴).
 */

import type { ProductType } from '@/types/product';

export type WorkspaceTabId =
  | 'type'
  | 'attrs'
  | 'frames'
  | 'options'
  | 'bundleRule'
  | 'setTemplates';

export type WorkspaceTab = {
  id: WorkspaceTabId;
  label: string;
  disabled?: boolean;
  disabledReason?: string;
};

const MIGRATION_PENDING =
  '마이그레이션 적용 대기 중입니다 — 적용 후 자동 활성화됩니다.';

export function visibleWorkspaceTabs(args: {
  productType: ProductType;
  setTemplatesAvailable: boolean;
  bundleRulesAvailable: boolean;
}): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = [
    { id: 'type', label: '유형' },
    { id: 'attrs', label: '속성' },
    { id: 'frames', label: '프레임' },
    { id: 'options', label: '옵션' },
  ];

  if (args.productType === 'extended') {
    tabs.push(
      args.bundleRulesAvailable
        ? { id: 'bundleRule', label: '구성규칙' }
        : {
            id: 'bundleRule',
            label: '구성규칙',
            disabled: true,
            disabledReason: MIGRATION_PENDING,
          },
      args.setTemplatesAvailable
        ? { id: 'setTemplates', label: '세트템플릿' }
        : {
            id: 'setTemplates',
            label: '세트템플릿',
            disabled: true,
            disabledReason: MIGRATION_PENDING,
          },
    );
  }

  return tabs;
}
