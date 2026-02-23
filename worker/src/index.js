const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /api/create-checkout
    // Body: { teamId, playerId, playerName, videoId, startTime, duration, songTitle, songThumbnail, successUrl, cancelUrl }
    if (request.method === 'POST' && pathname === '/api/create-checkout') {
      try {
        const body = await request.json();
        const { teamId, playerId, playerName, videoId, startTime, duration, songTitle, songThumbnail, successUrl, cancelUrl } = body;

        if (!teamId || !playerId || !videoId || !songTitle) {
          return error('Missing required fields');
        }

        const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            mode: 'payment',
            'line_items[0][price]': env.STRIPE_PRICE_ID,
            'line_items[0][quantity]': '1',
            success_url: successUrl || 'https://dugoutdj.github.io/#/parent?success=1',
            cancel_url: cancelUrl || 'https://dugoutdj.github.io/#/parent?cancelled=1',
            'metadata[teamId]': String(teamId),
            'metadata[playerId]': String(playerId),
            'metadata[playerName]': playerName || '',
            'metadata[videoId]': videoId,
            'metadata[startTime]': String(startTime || 0),
            'metadata[duration]': String(duration || 20),
            'metadata[songTitle]': songTitle,
            'metadata[songThumbnail]': songThumbnail || '',
          }),
        });

        const session = await stripeRes.json();
        if (!stripeRes.ok) {
          return error(session.error?.message || 'Stripe error', 500);
        }

        return json({ checkoutUrl: session.url });
      } catch (e) {
        return error('Server error: ' + e.message, 500);
      }
    }

    // POST /api/webhook
    // Stripe sends payment confirmation here
    if (request.method === 'POST' && pathname === '/api/webhook') {
      try {
        const body = await request.text();
        const signature = request.headers.get('stripe-signature');

        // Verify webhook signature
        const isValid = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
        if (!isValid) {
          return error('Invalid signature', 401);
        }

        const event = JSON.parse(body);

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object;
          const { teamId, playerId, playerName, videoId, startTime, duration, songTitle, songThumbnail } = session.metadata;

          const kvKey = `override:${teamId}:${playerId}`;
          const existing = await env.OVERRIDES_KV.get(kvKey, 'json');
          const queue = existing?.queue || [];

          queue.push({
            videoId,
            startTime: parseInt(startTime) || 0,
            duration: parseInt(duration) || 20,
            songTitle,
            songThumbnail,
            playerName,
            paidAt: Date.now(),
          });

          await env.OVERRIDES_KV.put(kvKey, JSON.stringify({ teamId, playerId, queue }), {
            expirationTtl: 86400, // 24 hours
          });
        }

        return json({ received: true });
      } catch (e) {
        return error('Webhook error: ' + e.message, 500);
      }
    }

    // GET /api/pending/:teamId
    // Returns all pending overrides for a team
    if (request.method === 'GET' && pathname.startsWith('/api/pending/')) {
      const teamId = pathname.split('/')[3];
      if (!teamId) return error('Missing teamId');

      try {
        const list = await env.OVERRIDES_KV.list({ prefix: `override:${teamId}:` });
        const results = [];

        for (const key of list.keys) {
          const data = await env.OVERRIDES_KV.get(key.name, 'json');
          if (data) results.push(data);
        }

        return json(results);
      } catch (e) {
        return error('Server error: ' + e.message, 500);
      }
    }

    // DELETE /api/pending/:teamId/:playerId
    // Clears a pending override after operator applies it
    if (request.method === 'DELETE' && pathname.startsWith('/api/pending/')) {
      const parts = pathname.split('/');
      const teamId = parts[3];
      const playerId = parts[4];
      if (!teamId || !playerId) return error('Missing teamId or playerId');

      try {
        await env.OVERRIDES_KV.delete(`override:${teamId}:${playerId}`);
        return json({ deleted: true });
      } catch (e) {
        return error('Server error: ' + e.message, 500);
      }
    }

    return error('Not found', 404);
  },
};

// Verify Stripe webhook signature using Web Crypto API (available in Workers)
async function verifyStripeSignature(payload, header, secret) {
  if (!header || !secret) return false;

  try {
    const parts = header.split(',').reduce((acc, part) => {
      const [key, val] = part.split('=');
      acc[key.trim()] = val?.trim();
      return acc;
    }, {});

    const timestamp = parts['t'];
    const signature = parts['v1'];
    if (!timestamp || !signature) return false;

    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

    return computed === signature;
  } catch {
    return false;
  }
}
