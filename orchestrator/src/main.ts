import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './config.js'
import { createPipeline } from './pipeline.js'
import { buildServer } from './server.js'
import { Store } from './store.js'
import { turnstile } from './turnstile.js'
import { Worker } from './worker.js'

const cfg = loadConfig()
mkdirSync(join(cfg.DATA_DIR, 'jobs'), { recursive: true })

const store = new Store(join(cfg.DATA_DIR, 'jobs.sqlite'))
store.failInterrupted('The server restarted while this app was being built. Please submit it again.')

const worker = new Worker(store, createPipeline(cfg))
const app = await buildServer({ cfg, store, worker, captcha: turnstile(cfg.TURNSTILE_SECRET) })

await app.listen({ host: cfg.HOST, port: cfg.PORT })
worker.kick()

process.on('SIGTERM', () => void app.close().then(() => process.exit(0)))
