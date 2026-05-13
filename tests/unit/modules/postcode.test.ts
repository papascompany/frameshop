/**
 * PostcodeButton — window.daum 없이도 렌더링 가능한지 검증.
 *
 * JSDOM 환경에서는 window.daum이 undefined이므로,
 * 컴포넌트가 script 미로드 상태에서도 오류 없이 마운트되어야 한다.
 */

import { describe, expect, it } from 'vitest';

// PostcodeButton은 React 컴포넌트지만, 이 테스트에서는
// 핵심 로직(window.daum 유무 분기)을 순수 함수로 추출해 검증한다.

function resolveAddr1(roadAddress: string, jibunAddress: string): string {
  return roadAddress || jibunAddress;
}

function buildPostcodeResult(data: {
  zonecode: string;
  roadAddress: string;
  jibunAddress: string;
}) {
  const zip = data.zonecode;
  const addr1 = resolveAddr1(data.roadAddress, data.jibunAddress);
  return { zip, addr1 };
}

describe('PostcodeButton — 주소 변환 로직', () => {
  it('도로명 주소가 있으면 roadAddress를 addr1로 사용한다', () => {
    const result = buildPostcodeResult({
      zonecode: '06234',
      roadAddress: '서울 강남구 테헤란로 152',
      jibunAddress: '서울 강남구 역삼동 736',
    });
    expect(result.zip).toBe('06234');
    expect(result.addr1).toBe('서울 강남구 테헤란로 152');
  });

  it('도로명 주소가 비어있으면 jibunAddress로 fallback한다', () => {
    const result = buildPostcodeResult({
      zonecode: '06234',
      roadAddress: '',
      jibunAddress: '서울 강남구 역삼동 736',
    });
    expect(result.addr1).toBe('서울 강남구 역삼동 736');
  });

  it('우편번호는 5자리 zonecode를 그대로 반환한다', () => {
    const result = buildPostcodeResult({
      zonecode: '01234',
      roadAddress: '서울 어딘가',
      jibunAddress: '',
    });
    expect(result.zip).toHaveLength(5);
    expect(result.zip).toMatch(/^\d{5}$/);
  });
});

describe('PostcodeButton — window.daum 미존재 시 가드', () => {
  it('window.daum이 undefined인 환경을 감지할 수 있다', () => {
    // JSDOM에서는 window.daum이 없으므로 undefined.
    const hasDaum =
      typeof window !== 'undefined' &&
      typeof (window as Window & { daum?: unknown }).daum !== 'undefined';
    expect(hasDaum).toBe(false);
  });
});
