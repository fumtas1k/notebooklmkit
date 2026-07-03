import { describe, it, expect, vi } from 'vitest'
import { handlePendingCreate, type CreateEnv } from '../src/content/main'
import { CREATE_RESULT_MESSAGE, PENDING_TTL_MS } from '../src/types'

function makeEnv(pending: unknown, now = 1000): CreateEnv & { removed: string[]; sent: unknown[] } {
  const removed: string[] = []
  const sent: unknown[] = []
  return {
    removed, sent,
    storageGet: vi.fn(async () => (pending === undefined ? {} : { pendingCreate: pending })),
    storageRemove: vi.fn(async (k: string) => { removed.push(k) }),
    now: () => now,
    sendMessage: (m: unknown) => { sent.push(m) },
  }
}

describe('handlePendingCreate', () => {
  it('does nothing when there is no pendingCreate', async () => {
    const env = makeEnv(undefined)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual([])
  })

  it('runs a fresh pendingCreate, clears it first, and reports the result', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000 }, 1500)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(env.removed).toEqual(['pendingCreate']) // 実行前クリア
    expect(run).toHaveBeenCalledWith(['https://a/'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: true }])
  })

  it('reports failure when run returns false', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000 }, 1500)
    const run = vi.fn(async () => false)
    await handlePendingCreate(env, run)
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false }])
  })

  it('cleans up a stale pendingCreate without running', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 0 }, PENDING_TTL_MS + 1)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual(['pendingCreate'])
    expect(env.sent).toEqual([])
  })
})
