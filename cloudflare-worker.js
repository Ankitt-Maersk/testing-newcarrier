export default {
  async fetch(request) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Request-Id',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/proxy') {
      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();
      const methodRaw = typeof body.method === 'string' ? body.method.toUpperCase() : 'POST';
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(methodRaw)
        ? methodRaw
        : 'POST';
      const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
      const payload = body.payload ?? null;
      const incomingHeaders = body.headers && typeof body.headers === 'object' ? body.headers : {};

      if (!/^https?:\/\//i.test(targetUrl)) {
        return new Response(JSON.stringify({ error: 'Missing or invalid targetUrl' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const supportsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
      const upstreamHeaders = {
        Accept: 'application/json, */*',
        ...(supportsBody ? { 'Content-Type': 'application/json' } : {}),
      };

      for (const [k, v] of Object.entries(incomingHeaders)) {
        if (typeof v === 'string') upstreamHeaders[k] = v;
      }

      const upstream = await fetch(targetUrl, {
        method,
        headers: upstreamHeaders,
        ...(supportsBody ? { body: JSON.stringify(payload ?? {}) } : {}),
      });

      const responseText = await upstream.text();
      return new Response(responseText, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Proxy request failed' }),
        {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
  },
};
