'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { Review } from '@/lib/db/reviews';
import { toggleReviewPublicAction } from './actions';

function StarDisplay({ rating }: { rating: number }) {
  return (
    <span aria-label={`별점 ${rating}점`}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

type Props = { reviews: Review[] };

export function ReviewsClient({ reviews }: Props) {
  const [toggling, setToggling] = useState<string | null>(null);
  const [localStates, setLocalStates] = useState<Record<string, boolean>>(
    () => Object.fromEntries(reviews.map((r) => [r.id, r.isPublic])),
  );

  async function handleToggle(id: string) {
    const current = localStates[id] ?? true;
    setToggling(id);
    const result = await toggleReviewPublicAction(id, !current);
    if (result.ok) {
      setLocalStates((prev) => ({ ...prev, [id]: !current }));
    } else {
      alert(result.error ?? '처리 실패');
    }
    setToggling(null);
  }

  if (reviews.length === 0) {
    return (
      <p className="text-sm text-muted-fg text-center py-8">작성된 리뷰가 없습니다.</p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {reviews.map((review) => {
        const isPublic = localStates[review.id] ?? review.isPublic;
        return (
          <li key={review.id}>
            <Card padding="md" className="flex gap-4 items-start">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <StarDisplay rating={review.rating} />
                  <Badge variant={isPublic ? 'success' : 'warning'}>
                    {isPublic ? '공개' : '비공개'}
                  </Badge>
                </div>
                {review.body ? (
                  <p className="text-sm text-foreground line-clamp-3">{review.body}</p>
                ) : (
                  <p className="text-xs text-muted-fg">(내용 없음)</p>
                )}
                <p className="text-xs text-muted-fg">
                  {new Date(review.createdAt).toLocaleString('ko-KR')}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                loading={toggling === review.id}
                disabled={toggling === review.id}
                onClick={() => void handleToggle(review.id)}
                className="shrink-0"
              >
                {isPublic ? '비공개 처리' : '공개 처리'}
              </Button>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
