import { getRecentPublicReviews } from '@/lib/db/reviews';
import type { Review } from '@/lib/db/reviews';

// ─── 이름 마스킹 헬퍼 ────────────────────────────────────────────────────────

/**
 * "홍길동" → "홍**"
 * "길동" → "길*"
 * "홍" → "홍"
 * 영문: "John Doe" → "J**"
 */
export function maskName(name: string): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (trimmed.length === 0) return '';
  const first = trimmed[0]!;
  const rest = trimmed.length > 1 ? '*'.repeat(Math.min(trimmed.length - 1, 2)) : '';
  return first + rest;
}

// ─── 별점 렌더러 ─────────────────────────────────────────────────────────────

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`별점 ${rating}점`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg
          key={i}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <path
            d="M7 1L8.854 5.02H13.5L9.823 7.98L11.177 12.5L7 9.9L2.823 12.5L4.177 7.98L0.5 5.02H5.146L7 1Z"
            fill={i < rating ? '#1a1a1a' : 'none'}
            stroke="#1a1a1a"
            strokeWidth="0.8"
          />
        </svg>
      ))}
    </div>
  );
}

// ─── 리뷰 카드 ───────────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: Review }) {
  const displayName = '사용자';
  const dateStr = new Date(review.createdAt).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <li className="flex flex-col gap-2 bg-white border border-hairline p-5">
      <StarRating rating={review.rating} />
      {review.body ? (
        <p className="text-sm text-foreground leading-relaxed line-clamp-4">
          {review.body}
        </p>
      ) : null}
      <p className="text-xs text-muted-fg mt-auto">
        {displayName} &middot; {dateStr}
      </p>
    </li>
  );
}

// ─── 공개 컴포넌트 ───────────────────────────────────────────────────────────

export async function RecentReviews() {
  const reviews = await getRecentPublicReviews(5);

  if (reviews.length === 0) return null;

  return (
    <section className="py-12 md:py-16">
      <div className="max-w-5xl mx-auto px-4">
        <h2 className="text-2xl font-bold mb-8">고객 후기</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </ul>
      </div>
    </section>
  );
}
