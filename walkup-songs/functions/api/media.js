// Media proxy for artwork and audio previews.
//
// Why: iOS Safari/Chrome fail to load Apple-hosted assets from phones —
// same mobile-IP blocking that broke the search API. mzstatic.com artwork
// and audio-ssl.itunes.apple.com previews render fine on desktop but come
// back blank/failed on mobile. Proxying them through this function makes
// the phone only ever talk to dugoutdj.com.
//
// Usage: /api/media?url=<encoded absolute URL>
//
// Security: only allows known Apple/Deezer media hosts (no open SSRF).
// Responses are CORS-open and edge-cached aggressively, so repeat loads
// (album art especially) are served from Cloudflare's cache.

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Hosts this proxy may fetch. Apple's image CDN (is1-ssl.mzstatic.com ...),
// Apple audio previews (audio-ssl.itunes.apple.com), and Deezer's CDN
// (cdn-images.dzcdn.net images, cdnt/cdns-preview.dzcdn.net audio).
const ALLOWED_HOSTS = [
  /(^|\.)mzstatic\.com$/,
  /(^|\.)itunes\.apple\.com$/,
  /(^|\.)dzcdn\.net$/
];

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    }
  });
}

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const target = url.searchParams.get('url') || '';

  if (!target) {
    return json({ error: 'Missing url parameter' }, 400);
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return json({ error: 'Invalid url' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return json({ error: 'Only http(s) urls are allowed' }, 400);
  }
  if (!ALLOWED_HOSTS.some((re) => re.test(parsed.hostname))) {
    return json({ error: 'Host not allowed' }, 400);
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: '*/*'
      }
    });

    const contentType = upstream.headers.get('Content-Type') || 'application/octet-stream';
    const isImage = contentType.startsWith('image/');
    // Images are immutable — cache a day at both browser and edge. Audio
    // previews can rotate, so keep them to an hour.
    const maxAge = isImage ? 86400 : 3600;
    const headers = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*'
    };
    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) headers['Content-Length'] = contentLength;

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return json(
      { error: 'Media fetch failed', detail: String(err?.message || err) },
      502
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Max-Age': '86400'
    }
  });
}
