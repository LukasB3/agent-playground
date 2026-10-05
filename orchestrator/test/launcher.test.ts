import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { signJobToken } from '../src/token.js'

// Exercises the real launcher script with a stand-in for the docker binary.
const LAUNCHER = join(import.meta.dirname, '../../infra/pg-sandbox')
const SECRET = 's'.repeat(32)
const ID = 'abcdefghij234567abcd'
const OTHER = 'zzzzzzzzzzzzzzzzzzzz'
const token = (id = ID) => signJobToken(SECRET, id, 2_000_000_000)

let dir: string
const out = (name: string) => readFileSync(join(dir, name), 'utf8')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pg-launcher-'))
  mkdirSync(join(dir, 'jobs', ID), { recursive: true })
  writeFileSync(join(dir, 'docker'), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\nprintf '%s' "$ANTHROPIC_API_KEY" > "${dir}/key"\ncat > "${dir}/stdin"\n`)
  chmodSync(join(dir, 'docker'), 0o755)
  writeFileSync(
    join(dir, 'sandbox.conf'),
    `IMAGE=pg-sandbox:latest\nNETWORK=pg-sandbox\nRUNTIME=runc\nMEMORY=1g\nCPUS=1.5\nPIDS=256\nPROXY_URL=http://pg-proxy:8080\nMODEL=claude-sonnet-5-5\nJOBS_DIR=${dir}/jobs\nRUN_AS=${userInfo().username}\n`,
  )
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const launch = (args: string[], input = '') =>
  spawnSync(LAUNCHER, args, { input, encoding: 'utf8', env: { PATH: process.env.PATH, PG_DOCKER: join(dir, 'docker'), PG_SANDBOX_CONF: join(dir, 'sandbox.conf') } })

describe('pg-sandbox run', () => {
  it('starts a locked-down container and keeps the token off the command line', () => {
    const result = launch(['run', ID], `${token()}\nBuild a clock\nsecond line`)
    expect(result.status).toBe(0)
    const args = out('args').split('\n').join(' ')
    for (const flag of [
      `--name pg-job-${ID}`,
      '--network pg-sandbox',
      '--read-only',
      '--cap-drop ALL',
      '--security-opt no-new-privileges',
      '--pids-limit 256',
      '--memory 1g',
      '--cpus 1.5',
      `--user ${userInfo().uid}:${userInfo().gid}`,
      `source=${dir}/jobs/${ID},target=/workspace`,
      '--env ANTHROPIC_API_KEY --env',
      '--rm',
    ])
      expect(args).toContain(flag)
    expect(args).not.toMatch(/privileged|docker\.sock|--network host|pgj1\./)
    expect(args.trim().endsWith('pg-sandbox:latest')).toBe(true)
    expect(out('key')).toBe(token())
    expect(out('stdin')).toBe('Build a clock\nsecond line')
  })

  it.each([
    ['a path as job id', ['run', '../../etc'], token()],
    ['shell characters in the job id', ['run', 'abc;id>x&&abcdefghijk'], token()],
    ['an option as job id', ['run', '--privileged'], token()],
    ['extra arguments', ['run', ID, '--privileged'], token()],
    ['an unknown action', ['exec', ID], token()],
    ['a token for another job', ['run', ID], token(OTHER)],
    ['a malformed token', ['run', ID], 'sk-ant-something'],
    ['no token', ['run', ID], ''],
    ['a job without workspace', ['run', OTHER], token(OTHER)],
  ])('refuses %s', (_name, args, input) => {
    const result = launch(args, `${input}\nprompt`)
    expect(result.status).toBe(64)
    expect(existsSync(join(dir, 'args'))).toBe(false)
  })

  it('refuses a workspace that is a symlink', () => {
    symlinkSync('/etc', join(dir, 'jobs', OTHER))
    expect(launch(['run', OTHER], `${token(OTHER)}\nprompt`).status).toBe(64)
    expect(existsSync(join(dir, 'args'))).toBe(false)
  })
})

describe('pg-sandbox kill', () => {
  it('kills only the container of that job', () => {
    expect(launch(['kill', ID]).status).toBe(0)
    expect(out('args').trim().split('\n')).toEqual(['kill', `pg-job-${ID}`])
  })
})
