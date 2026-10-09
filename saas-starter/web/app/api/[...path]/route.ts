// Behind the gateway, /api/* never reaches this app: CloudFront sends it straight to the
// API service. This proxy only serves local development (and a gateway-less setup),
// forwarding to the API over the private URL the platform injects.

const upstream = () =>
  (process.env.API_PRIVATE_URL || process.env.API_URL || 'http://localhost:8080').replace(/\/$/, '')

async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const headers = new Headers(req.headers)
  for (const h of ['host', 'connection', 'content-length']) headers.delete(h)
  const res = await fetch(upstream() + url.pathname + url.search, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    redirect: 'manual',
  })
  const out = new Headers(res.headers)
  for (const h of ['content-encoding', 'content-length', 'transfer-encoding']) out.delete(h)
  return new Response(res.body, { status: res.status, headers: out })
}

export const dynamic = 'force-dynamic'
export { proxy as DELETE, proxy as GET, proxy as PATCH, proxy as POST, proxy as PUT }
