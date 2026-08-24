// Server-side proxy for Apple's iTunes Search API.
//
// Why: some mobile networks/clients (iOS WebKit in particular — Private
// Relay, carrier or DNS-level blocking, Apple's own bot checks on mobile
// IPs) fail direct browser fetches to itunes.apple.com, while the same call
// from a desktop works fine. Proxying through the Pages Function means the
// phone only ever talks to its own origin (dugoutdj.com) and Cloudflare's
// network does the iTunes request. Responses are cached at the edge for an
// hour to stay friendly to the API.

const ITUNES_SEARCH = 'https://itunes.apple.com/search';

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
    const upstream = await fetch(target.toString());
    const body = await upstream.json();
    return json(body, upstream.status, {
      'Cache-Control': 'public, max-age=3600'
    });
  } catch {
    return json({ error: 'Apple search unavailable' }, 502);
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
