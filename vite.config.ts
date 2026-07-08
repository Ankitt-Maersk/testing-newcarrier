import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';

interface ProxyRequestBody {
  method?: unknown;
  targetUrl?: unknown;
  payload?: unknown;
  headers?: unknown;
  proxyUrl?: unknown;
  insecureTls?: unknown;
}

interface LabelaryRequestBody {
  zpl?: unknown;
}

const readBody = (req: NodeJS.ReadableStream): Promise<string> =>
  new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'label-proxy-middleware',
      configureServer(server) {
        server.middlewares.use('/api/label-proxy', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Only POST is allowed' }));
            return;
          }

          let requestBody: ProxyRequestBody;
          try {
            requestBody = JSON.parse(await readBody(req)) as ProxyRequestBody;
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid proxy request body JSON' }));
            return;
          }

          const targetUrl =
            typeof requestBody.targetUrl === 'string' ? requestBody.targetUrl.trim() : '';
          if (!/^https?:\/\//i.test(targetUrl)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing or invalid targetUrl' }));
            return;
          }

          try {
            const upstreamMethodRaw =
              typeof requestBody.method === 'string' ? requestBody.method.toUpperCase() : 'POST';
            const upstreamMethod = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(upstreamMethodRaw)
              ? upstreamMethodRaw
              : 'POST';
            const supportsBody = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(upstreamMethod);

            let dispatchOptions: { dispatcher?: Agent | ProxyAgent } = {};

            const proxyUrl = typeof requestBody.proxyUrl === 'string' ? requestBody.proxyUrl.trim() : '';
            if (proxyUrl) {
              dispatchOptions = { dispatcher: new ProxyAgent(proxyUrl) };
            } else if (requestBody.insecureTls === true && /^https:\/\//i.test(targetUrl)) {
              dispatchOptions = { dispatcher: new Agent({ connect: { rejectUnauthorized: false } }) };
            }

            const customHeaders =
              requestBody.headers && typeof requestBody.headers === 'object' && !Array.isArray(requestBody.headers)
                ? Object.entries(requestBody.headers as Record<string, unknown>).reduce<Record<string, string>>(
                    (acc, [key, value]) => {
                      acc[key] = typeof value === 'string' ? value : String(value);
                      return acc;
                    },
                    {}
                  )
                : {};

            const upstream = await undiciFetch(targetUrl, {
              method: upstreamMethod,
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, */*',
                ...customHeaders,
              },
              ...(supportsBody ? { body: JSON.stringify(requestBody.payload ?? {}) } : {}),
              ...dispatchOptions,
            });

            const text = await upstream.text();
            res.statusCode = upstream.status;
            res.setHeader(
              'Content-Type',
              upstream.headers.get('content-type') || 'application/json; charset=utf-8'
            );
            res.end(text);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Proxy request failed';
            const cause =
              error && typeof error === 'object' && 'cause' in error
                ? String((error as { cause?: unknown }).cause)
                : null;
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: message,
                cause,
                targetUrl,
              })
            );
          }
        });

        server.middlewares.use('/api/labelary-preview', async (req, res) => {
          if (req.method !== 'POST') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Only POST is allowed' }));
            return;
          }

          let requestBody: LabelaryRequestBody;
          try {
            requestBody = JSON.parse(await readBody(req)) as LabelaryRequestBody;
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Invalid Labelary request body JSON' }));
            return;
          }

          const zpl = typeof requestBody.zpl === 'string' ? requestBody.zpl : '';
          if (!zpl.trim()) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing zpl content' }));
            return;
          }

          try {
            const labelaryUrl = `https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/${encodeURIComponent(zpl)}`;
            const labelaryResponse = await undiciFetch(labelaryUrl, {
              method: 'GET',
              headers: {
                Accept: 'image/png',
              },
            });

            if (!labelaryResponse.ok) {
              const errorText = await labelaryResponse.text();
              res.statusCode = labelaryResponse.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  error: 'Labelary rendering failed',
                  details: errorText,
                })
              );
              return;
            }

            const pngArrayBuffer = await labelaryResponse.arrayBuffer();
            const pngBase64 = Buffer.from(pngArrayBuffer).toString('base64');

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                imageDataUrl: `data:image/png;base64,${pngBase64}`,
              })
            );
          } catch (error) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error: error instanceof Error ? error.message : 'Labelary request failed',
              })
            );
          }
        });
      },
    },
  ],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
