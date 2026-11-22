import { sha256, getClientIP, checkRateLimit } from '../../_lib/security.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', ...CORS, ...extraHeaders }
});

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost({ request, env }) {
  try {
    const ipLimit = await checkRateLimit(env, 'auth-link-ip', getClientIP(request), 10, 900);
    if (!ipLimit.allowed) {
      return json(
        { error: 'Too many sign-in requests. Please wait a few minutes and try again.' },
        429,
        { 'Retry-After': String(ipLimit.retryAfter) }
      );
    }

    const body = await request.json();
    const email = String(body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Enter a valid email address.' }, 400);
    }
    if (!env.DB) return json({ error: 'D1 database binding is not configured.' }, 503);
    if (!env.RESEND_API_KEY) return json({ error: 'RESEND_API_KEY secret is not configured for this deployment.' }, 503);

    const now = Date.now();
    const rawToken = randomToken();
    const tokenHash = await sha256(rawToken);
    const expiresAt = now + 15 * 60 * 1000;

    await env.DB.prepare('CREATE TABLE IF NOT EXISTS login_tokens (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)').run();
    await env.DB.prepare('DELETE FROM login_tokens WHERE expires_at < ? OR used_at IS NOT NULL').bind(now).run();

    const pending = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND expires_at > ?'
    ).bind(email, now).first();
    if (Number(pending?.n || 0) >= 3) {
      return json({ error: 'Too many sign-in links requested. Please check your email or wait a few minutes.' }, 429);
    }

    await env.DB.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)').bind(tokenHash, email, expiresAt).run();

    const loginUrl = new URL(request.url);
    loginUrl.pathname = '/';
    loginUrl.search = `?login=${encodeURIComponent(rawToken)}`;
    const isIOS = body?.platform === 'ios';
    const iosUrl = `dugoutdj://login?token=${encodeURIComponent(rawToken)}`;
    const html = isIOS
      ? `<p>Sign in to Dugout DJ on your iPhone:</p><p><a href="${iosUrl}">Open in Dugout DJ iOS App</a></p><p>Or sign in on the web: <a href="${loginUrl.href}">${loginUrl.href}</a></p><p>If the button doesn’t open automatically, copy and paste this into the app:<br><code>${iosUrl}</code></p><p>This link expires in 15 minutes and can only be used once.</p>`
      : `<p>Sign in to Dugout DJ:</p><p><a href="${loginUrl.href}">Sign in securely</a></p><p>This link expires in 15 minutes and can only be used once.</p>`;
    const resend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Dugout DJ <coach@dugoutdj.com>',
        to: [email],
        subject: 'Your Dugout DJ sign-in link',
        html
      })
    });
    if (!resend.ok) {
      console.error('Resend error:', await resend.text());
      return json({ error: 'Resend rejected the message. Check the verified sender and API key.' }, 502);
    }
    return json({ ok: true });
  } catch (error) {
    console.error('POST /api/auth/request-link error:', error);
    return json({ error: 'Unable to request a sign-in link.' }, 500);
  }
}
