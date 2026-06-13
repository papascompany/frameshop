/**
 * Trusted client-IP extraction for rate limiting.
 *
 * On Vercel the platform sets `x-real-ip` to the true connecting client and
 * APPENDS the real IP to any client-supplied `x-forwarded-for` (so the
 * RIGHT-most XFF hop is the trustworthy one, not the left-most which a caller
 * can spoof). Using the left-most XFF entry — as some older code did — lets an
 * attacker forge the rate-limit key by rotating a fake header. Prefer
 * `x-real-ip`, then the right-most XFF hop.
 *
 * IP-based limits are still coarse (NAT, IPv6 rotation); pair them with a
 * resource-scoped key (e.g. per orderNo / per session) for sensitive endpoints.
 */

import 'server-only';

export function getClientIp(req: { headers: Headers }): string {
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return 'unknown';
}
