// Node's built-in SQLite: no native dependency to compile on the server.
import { DatabaseSync } from 'node:sqlite'

export const STEPS = ['queued', 'preparing', 'coding', 'checking', 'publishing', 'done'] as const
export type JobStatus = (typeof STEPS)[number] | 'failed'
export type EventType = 'status' | 'file' | 'note'

export interface Job {
  id: string
  prompt: string
  status: JobStatus
  ipHash: string
  createdAt: number
  url: string | null
  error: string | null
}

export interface JobEvent {
  seq: number
  ts: number
  type: EventType
  data: string
}

const ACTIVE = `('preparing','coding','checking','publishing')`

export class Store {
  private db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        ipHash TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        url TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS jobs_created ON jobs (createdAt, ipHash);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId TEXT NOT NULL,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_job ON events (jobId, seq);
    `)
  }

  createJob(id: string, prompt: string, ipHash: string, now = Date.now()) {
    this.db.prepare('INSERT INTO jobs (id, prompt, ipHash, createdAt) VALUES (?, ?, ?, ?)').run(id, prompt, ipHash, now)
    this.addEvent(id, 'status', 'queued', now)
  }

  getJob(id: string) {
    return this.db.prepare('SELECT id, prompt, status, ipHash, createdAt, url, error FROM jobs WHERE id = ?').get(id) as unknown as Job | undefined
  }

  nextQueued() {
    return this.db.prepare(`SELECT id, prompt, status, ipHash, createdAt, url, error FROM jobs WHERE status = 'queued' ORDER BY n LIMIT 1`).get() as unknown as Job | undefined
  }

  // 0 once the job is being worked on; otherwise its 1-based place among queued jobs.
  position(id: string) {
    const row = this.db
      .prepare(`SELECT count(*) AS c FROM jobs WHERE status = 'queued' AND n <= (SELECT n FROM jobs WHERE id = ? AND status = 'queued')`)
      .get(id) as { c: number }
    return row.c
  }

  queuedCount() {
    return (this.db.prepare(`SELECT count(*) AS c FROM jobs WHERE status = 'queued'`).get() as { c: number }).c
  }

  countSince(since: number, ipHash?: string) {
    const row = ipHash
      ? this.db.prepare('SELECT count(*) AS c FROM jobs WHERE createdAt >= ? AND ipHash = ?').get(since, ipHash)
      : this.db.prepare('SELECT count(*) AS c FROM jobs WHERE createdAt >= ?').get(since)
    return (row as { c: number }).c
  }

  setStatus(id: string, status: JobStatus, result: { url?: string; error?: string } = {}) {
    this.db.prepare('UPDATE jobs SET status = ?, url = coalesce(?, url), error = coalesce(?, error) WHERE id = ?').run(status, result.url ?? null, result.error ?? null, id)
    return this.addEvent(id, 'status', status)
  }

  addEvent(jobId: string, type: EventType, data: string, ts = Date.now()): JobEvent {
    const { lastInsertRowid } = this.db.prepare('INSERT INTO events (jobId, ts, type, data) VALUES (?, ?, ?, ?)').run(jobId, ts, type, data)
    return { seq: Number(lastInsertRowid), ts, type, data }
  }

  events(jobId: string, afterSeq = 0) {
    return this.db.prepare('SELECT seq, ts, type, data FROM events WHERE jobId = ? AND seq > ? ORDER BY seq').all(jobId, afterSeq) as unknown as JobEvent[]
  }

  // A restart kills the running container, so whatever was in flight cannot finish.
  failInterrupted(message: string) {
    const rows = this.db.prepare(`SELECT id FROM jobs WHERE status IN ${ACTIVE}`).all() as { id: string }[]
    for (const { id } of rows) this.setStatus(id, 'failed', { error: message })
    return rows.length
  }

  // Prompts and visitor hashes are not kept longer than needed for limits and debugging.
  purgeOlderThan(cutoff: number) {
    this.db.prepare('DELETE FROM events WHERE jobId IN (SELECT id FROM jobs WHERE createdAt < ?)').run(cutoff)
    return Number(this.db.prepare('DELETE FROM jobs WHERE createdAt < ?').run(cutoff).changes)
  }

  close() {
    this.db.close()
  }
}
