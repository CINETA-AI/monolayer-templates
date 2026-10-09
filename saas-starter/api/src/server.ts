import { serve } from '@hono/node-server'

import { authOptions, createAuth } from './auth.js'
import { loadConfig } from './config.js'
import { createPool } from './db.js'
import { migrate } from './migrate.js'
import { buildApp } from './routes.js'

async function main() {
  const cfg = loadConfig()
  const pool = createPool(cfg)
  await migrate(pool, cfg, authOptions(cfg, pool))
  const auth = createAuth(cfg, pool)
  const { app } = buildApp({ cfg, auth, pool })

  const server = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
    console.log(`api listening on :${info.port} (env=${cfg.appEnv}, tenancy=${cfg.tenancy})`)
  })
  const stop = () => {
    server.close(() => void pool.end().finally(() => process.exit(0)))
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

main().catch((err) => {
  console.error('api failed to start:', err)
  process.exit(1)
})
