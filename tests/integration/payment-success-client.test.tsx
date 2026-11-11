/**
 * <PaymentSuccessClient> — 서버측 확정 실패 화면이 실패 종류에 맞는 안내를 보이는지 고정.
 *
 * - 승인 전에 거부된 실패(취소된 주문 등): 청구되지 않았음을 알리고, "결제는 정상 처리되었을
 *   수 있습니다"·재시도 버튼은 숨긴다(재시도해도 결과가 같고, 모순된 안내가 된다).
 * - 그 외(내부 오류·Toss 거절·네트워크): 결제가 이미 처리됐을 수 있다는 안내 + 재시도 제공.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PaymentSuccessClient } from '@/app/(shop)/payment/success/PaymentSuccessClient';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const BASE = { paymentKey: 'pk-1', orderId: '20261111-0001', amount: 16800 } as const;

describe('<PaymentSuccessClient> 실패 안내', () => {
  it.each(['ORDER_NOT_PAYABLE', 'ORDER_NOT_FOUND', 'AMOUNT_MISMATCH', 'BAD_INPUT'])(
    '%s: 청구 없음 안내, "정상 처리되었을 수 있습니다"·재시도 버튼 없음',
    (code) => {
      render(<PaymentSuccessClient {...BASE} initialMessage="안내 문구" initialCode={code} />);

      expect(screen.getByText('결제가 진행되지 않았어요')).toBeInTheDocument();
      expect(screen.getByText(/청구되지 않습니다/)).toBeInTheDocument();
      expect(screen.queryByText(/정상 처리되었을 수 있습니다/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '결제 확인 다시 시도' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '주문 조회하기' })).toBeInTheDocument();
    },
  );

  it.each(['INTERNAL', 'TOSS_REJECTED', 'RATE_LIMITED', undefined])(
    '%s: 이미 처리됐을 수 있다는 안내 + 재시도 버튼',
    (code) => {
      render(<PaymentSuccessClient {...BASE} initialMessage="안내 문구" initialCode={code} />);

      expect(screen.getByText('결제 확인이 지연되었어요')).toBeInTheDocument();
      expect(screen.getByText(/정상 처리되었을 수 있습니다/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '결제 확인 다시 시도' })).toBeInTheDocument();
    },
  );
});
