import { z } from 'zod'

const secret = z.string().min(32)

const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().default(8787),
  DATA_DIR: z.string().default('/var/lib/agent-playground'),
  WEB_ORIGIN: z.url(),

  TURNSTILE_SECRET: z.string().min(1),
  IP_HASH_SECRET: secret,
  PROXY_SIGNING_SECRET: secret,

  SANDBOX_IMAGE: z.string().default('pg-sandbox:latest'),
  SANDBOX_NETWORK: z.string().default('pg-sandbox'),
  SANDBOX_RUNTIME: z.string().default('runc'),
  SANDBOX_MEMORY: z.string().default('1g'),
  SANDBOX_CPUS: z.string().default('1.5'),
  SANDBOX_PIDS: z.coerce.number().int().default(256),
  PROXY_URL: z.url().default('http://pg-proxy:8080'),
  AGENT_MODEL: z.string().default('claude-sonnet-5-5'),
  LIBS_DIR: z.string().default('/opt/agent-playground/sandbox/libs'),

  JOB_TIMEOUT_S: z.coerce.number().int().default(600),
  PROMPT_MAX_CHARS: z.coerce.number().int().default(1000),
  QUEUE_MAX: z.coerce.number().int().default(10),
  JOBS_PER_IP_PER_HOUR: z.coerce.number().int().default(3),
  JOBS_PER_HOUR: z.coerce.number().int().default(10),
  JOBS_PER_DAY: z.coerce.number().int().default(30),

  APPS_REPO: z.string().default('git@github.com:LukasB3/agent-playground-apps.git'),
  APPS_BASE_URL: z.url().default('https://lukasb3.github.io/agent-playground-apps'),
  DEPLOY_KEY_PATH: z.string().default('/etc/agent-playground/deploy_key'),
  KNOWN_HOSTS_PATH: z.string().default('/etc/agent-playground/known_hosts'),
  PUBLISH_WAIT_S: z.coerce.number().int().default(300),
})

export type Config = z.infer<typeof schema>

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env)
