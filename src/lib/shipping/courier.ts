/**
 * Courier tracking deep-links.
 *
 * The admin ship form uses a fixed set of Korean carrier names; map each to its
 * public tracking URL so a customer can tap the tracking number to follow the
 * parcel. Unknown carriers return null (render as plain text).
 */

const TRACKING_URL: Record<string, (n: string) => string> = {
  'CJ대한통운': (n) => `https://trace.cjlogistics.com/next/tracking.html?wblNo=${n}`,
  '롯데택배': (n) => `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${n}`,
  '우체국': (n) => `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${n}`,
  '한진': (n) => `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=${n}`,
  '로젠': (n) => `https://www.ilogen.com/web/personal/trace/${n}`,
};

/** Return a tracking URL for the carrier + number, or null if unmappable. */
export function courierTrackingUrl(courier: string | null, trackingNumber: string | null): string | null {
  if (!courier || !trackingNumber) return null;
  const build = TRACKING_URL[courier.trim()];
  return build ? build(encodeURIComponent(trackingNumber.trim())) : null;
}
