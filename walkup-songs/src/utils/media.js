// mediaProxy(url) — rewrites Apple/Deezer-hosted media URLs to the
// same-origin /api/media proxy.
//
// Why: mobile clients (iOS Safari/Chrome) are blocked from Apple's CDNs
// (mzstatic.com artwork, audio-ssl.itunes.apple.com previews), so the
// phone can't load album art or preview audio directly. Routing those
// through dugoutdj.com keeps everything on a host the phone can reach.
//
// Local dev/preview (localhost/127.0.0.1) has no /api/media function, and
// the desktop can reach Apple directly, so proxying is skipped there.

const APPLE_OR_DEEZER_HOST = /(^|\.)(mzstatic\.com|itunes\.apple\.com|dzcdn\.net)$/;

function isLocalhost() {
  if (typeof window === 'undefined') return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location.origin);
}

export function mediaProxy(url) {
  if (!url) return url;
  // Already same-origin (e.g. /api/media?url=... or a relative path).
  if (/^\//.test(url)) return url;
  if (isLocalhost()) return url;

  try {
    const parsed = new URL(url, typeof window !== 'undefined' ? window.location.origin : undefined);
    if (!APPLE_OR_DEEZER_HOST.test(parsed.hostname)) return url;
    return `/api/media?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}
