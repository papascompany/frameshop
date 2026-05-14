-- reviews: 주문 완료 후 사용자가 작성하는 상품 리뷰

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid REFERENCES orders(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  product_id  uuid REFERENCES products(id) ON DELETE SET NULL,
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body        text,
  photo_url   text,                    -- 선택적 리뷰 사진
  is_public   boolean DEFAULT true,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

-- 누구나 공개 리뷰 SELECT
CREATE POLICY "public_read" ON reviews
  FOR SELECT USING (is_public = true);

-- 본인만 INSERT
CREATE POLICY "own_insert" ON reviews
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- 본인만 UPDATE
CREATE POLICY "own_update" ON reviews
  FOR UPDATE USING (user_id = auth.uid());

-- 관리자(서비스롤) DELETE는 RLS 우회
