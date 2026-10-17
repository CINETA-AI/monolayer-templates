import type { NextConfig } from 'next'

// The dashboard (sign-in, members, SSO, security) lives under /account. Deployed with your
// own frontend, the gateway serves that frontend at / and this app at /account/*; without
// one, this app is the gateway's catch-all too, and / sends visitors here.
const basePath = process.env.BASE_PATH ?? '/account'

// Local development and docker compose: the browser calls the API at /account/api/*, which
// is inside this app's base path, so forward it to the API. Behind the gateway
// /account/api/* goes straight to the API service and never reaches this app, so the
// published image (built without API_URL) has no rewrite.
const apiUpstream = (process.env.API_URL || (process.env.NODE_ENV === 'development' ? 'http://localhost:8080' : '')).replace(
  /\/$/,
  '',
)

const config: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // A self-contained server (node .next/standalone/server.js) for the container image.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return basePath ? [{ source: '/', destination: basePath, basePath: false, permanent: false }] : []
  },
  async rewrites() {
    // source is relative to basePath (so it matches /account/api/*); the destination is absolute.
    return apiUpstream ? [{ source: '/api/:path*', destination: `${apiUpstream}/account/api/:path*` }] : []
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
        ],
      },
    ]
  },
}

export default config
