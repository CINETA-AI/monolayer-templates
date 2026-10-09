'use client'

import { ssoClient } from '@better-auth/sso/client'
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// Better Auth runs inside the API, reached same-origin at /api/auth through the gateway.
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [
    organizationClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = '/two-factor'
      },
    }),
    ssoClient(),
  ],
})
