import { requireAdmin } from '@/lib/db/admin';
import { getAllReviews } from '@/lib/db/reviews';
import { ReviewsClient } from './ReviewsClient';

export const metadata = { title: '리뷰 관리 · FrameShop Admin' };

export default async function AdminReviewsPage() {
  await requireAdmin();
  const reviews = await getAllReviews(100);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">리뷰 관리</h1>
        <p className="text-sm text-muted-fg mt-1">
          고객 리뷰를 공개/비공개 처리합니다. (총 {reviews.length}건)
        </p>
      </div>
      <ReviewsClient reviews={reviews} />
    </div>
  );
}
