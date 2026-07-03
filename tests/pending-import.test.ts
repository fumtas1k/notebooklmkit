import { describe, it, expect, vi } from 'vitest'
import { handlePending, type PendingEnv } from '../src/content/pending-import'
import { PENDING_TTL_MS } from '../src/types'

function makeEnv(pending: unknown, now = 1000): PendingEnv & { removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    storageGet: vi.fn(async () => (pending === undefined ? {} : { pendingImport: pending })),
    storageRemove: vi.fn(async (k: string) => { removed.push(k) }),
    now: () => now,
  }
}

describe('handlePending', () => {
  it('does nothing when notebookId is null', async () => {
    const env = makeEnv({ notebookId: 'a', url: 'https://x/', ts: 1000 })
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending(null, env, run, report)
    expect(run).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('does nothing when there is no pendingImport', async () => {
    const env = makeEnv(undefined)
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual([])
  })

  it('ignores (and does not remove) a pendingImport for another notebook', async () => {
    const env = makeEnv({ notebookId: 'other', url: 'https://x/', ts: 1000 })
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual([]) // 他タブが拾うため残す
  })

  it('cleans up a stale pendingImport without running', async () => {
    const env = makeEnv({ notebookId: 'a', url: 'https://x/', ts: 0 }, PENDING_TTL_MS + 1)
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual(['pendingImport'])
    expect(report).not.toHaveBeenCalled()
  })

  it('runs a fresh matching pendingImport, clears it, and reports ok', async () => {
    const env = makeEnv({ notebookId: 'a', url: 'https://x/', ts: 1000 }, 1500)
    const run = vi.fn(async () => true)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(env.removed).toEqual(['pendingImport']) // 実行前にクリア
    expect(run).toHaveBeenCalledWith('https://x/')
    expect(report).toHaveBeenCalledWith(true)
  })

  it('reports failure when run returns false', async () => {
    const env = makeEnv({ notebookId: 'a', url: 'https://x/', ts: 1000 }, 1500)
    const run = vi.fn(async () => false)
    const report = vi.fn()
    await handlePending('a', env, run, report)
    expect(report).toHaveBeenCalledWith(false)
  })
})
