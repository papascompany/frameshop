/**
 * Wall → Studio deep-link builder + preselect parser (FS-EC-04).
 */

import { describe, expect, it } from 'vitest';
import { buildStudioEditUrl, parseStudioPreselect } from '@/lib/wall/deeplink';

describe('buildStudioEditUrl', () => {
  it('전체 파라미터를 포함한 URL을 만든다', () => {
    const url = buildStudioEditUrl({
      sessionId: 'abc-123',
      productId: 'prod-1',
      sizeCode: '4x6',
      colorCode: 'black',
      orientation: 'landscape',
    });
    expect(url).toBe(
      '/studio/abc-123?productId=prod-1&size=4x6&color=black&orientation=landscape',
    );
  });

  it('옵션 파라미터가 없으면 생략한다(기존 스튜디오 URL과 동일 형태)', () => {
    const url = buildStudioEditUrl({ sessionId: 'abc-123', productId: 'prod-1' });
    expect(url).toBe('/studio/abc-123?productId=prod-1');
    expect(url).not.toContain('size=');
    expect(url).not.toContain('orientation=');
  });

  it('쿼리 값과 세션 세그먼트를 인코딩한다', () => {
    const url = buildStudioEditUrl({
      sessionId: 'a/b',
      productId: 'prod 1',
      sizeCode: 'A4+',
    });
    expect(url.startsWith('/studio/a%2Fb?')).toBe(true);
    expect(url).toContain('productId=prod+1');
    expect(url).toContain('size=A4%2B');
  });
});

describe('parseStudioPreselect', () => {
  it('유효한 파라미터를 파싱한다', () => {
    expect(
      parseStudioPreselect({ size: '4x6', color: 'black', orientation: 'portrait' }),
    ).toEqual({ sizeCode: '4x6', colorCode: 'black', orientation: 'portrait' });
  });

  it('부분 파라미터도 허용한다', () => {
    expect(parseStudioPreselect({ size: 'A4' })).toEqual({ sizeCode: 'A4' });
    expect(parseStudioPreselect({ orientation: 'landscape' })).toEqual({
      orientation: 'landscape',
    });
  });

  it('잘못된 orientation 값은 버린다', () => {
    expect(parseStudioPreselect({ orientation: 'diagonal' })).toBeNull();
    expect(
      parseStudioPreselect({ size: '4x6', orientation: 'DIAGONAL' }),
    ).toEqual({ sizeCode: '4x6' });
  });

  it('공백/빈 값은 무시한다', () => {
    expect(parseStudioPreselect({ size: '  ', color: '' })).toBeNull();
    expect(parseStudioPreselect({ size: ' A4 ' })).toEqual({ sizeCode: 'A4' });
  });

  it('아무것도 없으면 null → 스튜디오 기존 동작 유지', () => {
    expect(parseStudioPreselect({})).toBeNull();
  });
});
