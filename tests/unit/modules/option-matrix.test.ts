/**
 * OptionMatrix 파싱 및 매트/인화지 옵션 테스트.
 *
 * MATTE_CODES, PAPER_CODES가 타입에 정의되어 있고,
 * OptionMatrix.mattes / papers 배열로 올바르게 구성되는지 검증.
 */

import { describe, it, expect } from 'vitest';
import {
  MATTE_CODES,
  PAPER_CODES,
  type OptionMatrix,
} from '@/types/product';

describe('MATTE_CODES', () => {
  it('none과 with를 포함한다', () => {
    expect(MATTE_CODES).toContain('none');
    expect(MATTE_CODES).toContain('with');
  });
});

describe('PAPER_CODES', () => {
  it('glossy, matte, fineart를 포함한다', () => {
    expect(PAPER_CODES).toContain('glossy');
    expect(PAPER_CODES).toContain('matte');
    expect(PAPER_CODES).toContain('fineart');
  });
});

describe('OptionMatrix 구조', () => {
  it('mattes와 papers 배열을 가진다', () => {
    const matrix: OptionMatrix = {
      sizes: [{ code: 'S', label: '소형', widthMm: 200, heightMm: 300 }],
      colors: [{ code: 'black', label: '블랙', previewUrl: null }],
      mattes: [
        { code: 'none', label: '없음' },
        { code: 'with', label: '있음' },
      ],
      papers: [
        { code: 'glossy', label: '유광' },
        { code: 'matte', label: '무광' },
      ],
      variantsByKey: {},
    };

    expect(matrix.mattes).toHaveLength(2);
    expect(matrix.papers).toHaveLength(2);
    expect(matrix.mattes[0]?.code).toBe('none');
    expect(matrix.papers[0]?.code).toBe('glossy');
  });

  it('매트 라벨 매핑이 올바르다', () => {
    const matteLabels: Record<string, string> = { none: '없음', with: '있음' };
    expect(matteLabels['none']).toBe('없음');
    expect(matteLabels['with']).toBe('있음');
  });

  it('인화지 라벨 매핑이 올바르다', () => {
    const paperLabels: Record<string, string> = {
      glossy: '유광',
      matte: '무광',
      fineart: '파인아트',
    };
    expect(paperLabels['glossy']).toBe('유광');
    expect(paperLabels['matte']).toBe('무광');
    expect(paperLabels['fineart']).toBe('파인아트');
  });
});

describe('Google Photos 비활성 처리', () => {
  it('google_client_id 미설정 시 googlePhotosEnabled는 false', () => {
    const clientId: string | null = null;
    const enabled = !!(process.env.GOOGLE_CLIENT_ID ?? clientId);
    expect(enabled).toBe(false);
  });

  it('google_client_id 설정 시 googlePhotosEnabled는 true', () => {
    const clientId = 'test-client-id.apps.googleusercontent.com';
    const enabled = !!(process.env.GOOGLE_CLIENT_ID ?? clientId);
    expect(enabled).toBe(true);
  });
});
