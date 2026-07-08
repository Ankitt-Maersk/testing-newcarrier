# Deploy CORS Proxy For Live Demo (Cloudflare Worker)

Use this when the GitHub Pages site cannot call carrier APIs directly because of CORS.

## 1) Install Wrangler

```bash
npm i -g wrangler
```

## 2) Login

```bash
wrangler login
```

## 3) Deploy Worker

From project root:

```bash
wrangler deploy cloudflare-worker.js --name carrier-label-proxy
```

Wrangler prints a URL like:

`https://carrier-label-proxy.<subdomain>.workers.dev`

## 4) Configure App

In the app, set **Hosted Proxy URL (for live demo)** to:

`https://carrier-label-proxy.<subdomain>.workers.dev`

Then click **Generate Selected Labels** again.

## Notes

- Keep API endpoint as your real carrier URL.
- Worker endpoint path is fixed as `/proxy`.
- The app stores Hosted Proxy URL in browser localStorage.
