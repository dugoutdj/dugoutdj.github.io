// Server-side proxy for Apple's iTunes Search API.
//
// Why: iOS Safari/Chrome fail direct browser fetches to itunes.apple.com
// (Apple bot-checks mobile IPs + iOS WebKit quirks), so we proxy through
// Cloudflare Pages Functions instead. Apple also blocks requests from
// Cloudflare's default Worker User-Agent, so we send a browser-like one.

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function onRequestGet(context) {
  const { request } = context;
  const url = new URL(request.url);
  const term = (url.searchParams.get('term') || '').trim();
  const limit = url.searchParams.get('limit') || '8';

  if (!term) {
    return json({ error: 'Missing search term' }, 400);
  }

  const target = new URL(ITUNES_SEARCH);
  target.searchParams.set('term', term);
  target.searchParams.set('media', 'music');
  target.searchParams.set('entity', 'song');
  target.searchParams.set('limit', limit);

  try {
    const upstream = await fetch(target.toString(), {
      headers: { 'User-Agent': BROWSER_UA }
    });
    if (!upstream.ok) {
      let detail = '';
      try { detail = (await upstream.text()).slice(0, 300); } catch { /* non-text response */ }
      return json(
        { error: `Apple API ${upstream.status}`, detail },
        upstream.status
      );
    }
    const body = await upstream.json();
    return json(body, 200, { 'Cache-Control': 'public, max-age=3600' });
  } catch (err) {
    return json(
      { error: 'Apple search unavailable', detail: String(err?.message || err) },
      502
    );
  }
}

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
