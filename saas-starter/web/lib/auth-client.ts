'use client'

import { ssoClient } from '@better-auth/sso/client'
import { organizationClient, twoFactorClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

import { API, withBase } from '@/lib/paths'

// Better Auth runs inside the API, reached same-origin at /account/api/auth through the gateway.
export const authClient = createAuthClient({
  basePath: `${API}/auth`,
  plugins: [
    organizationClient(),
    twoFactorClient({
      onTwoFactorRedirect() {
        // Keep ?next= so a sign-in started from your own frontend returns there.
        window.location.href = withBase('/two-factor') + window.location.search
      },
    }),
    ssoClient(),
  ],
})
