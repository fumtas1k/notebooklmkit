import { describe, it, expect, vi } from 'vitest'
import { handlePendingCreate, type CreateEnv } from '../src/content/main'
import { CREATE_RESULT_MESSAGE, PENDING_TTL_MS } from '../src/types'
import { createNotebookWithUrls, type CreatorDeps } from '../src/content/notebook-creator'

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

  it('runs a fresh pendingCreate, clears it first, and reports the result with tabId echoed', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000, tabId: 5 }, 1500)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(env.removed).toEqual(['pendingCreate']) // 実行前クリア
    expect(run).toHaveBeenCalledWith(['https://a/'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: true, tabId: 5 }])
  })

  it('reports failure when run returns false', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000, tabId: 5 }, 1500)
    const run = vi.fn(async () => false)
    await handlePendingCreate(env, run)
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false, tabId: 5 }])
  })

  it('cleans up a stale pendingCreate without running', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 0 }, PENDING_TTL_MS + 1)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(run).not.toHaveBeenCalled()
    expect(env.removed).toEqual(['pendingCreate'])
    expect(env.sent).toEqual([])
  })

  it('reports failure and does not throw when run rejects (M-3)', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000, tabId: 5 }, 1500)
    const run = vi.fn(async () => { throw new Error('dom blew up') })
    await expect(handlePendingCreate(env, run)).resolves.toBeUndefined()
    expect(env.removed).toEqual(['pendingCreate'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false, tabId: 5 }])
  })

  it('echoes tabId undefined when pendingCreate has no tabId', async () => {
    const env = makeEnv({ urls: ['https://a/'], ts: 1000 }, 1500)
    const run = vi.fn(async () => true)
    await handlePendingCreate(env, run)
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: true, tabId: undefined }])
  })
})

// #45: storage の pendingCreate が壊れていた場合（urls が配列でない等）。handlePendingCreate は
// 形を検証せず run に渡すので、実 createNotebookWithUrls と結線して「throw せず、storage を
// 消し、失敗を返す」ことを固定する。
describe('handlePendingCreate with a malformed pendingCreate', () => {
  function makeRunner(): { run: (urls: string[]) => Promise<boolean>; clicks: string[]; inputs: string[] } {
    const clicks: string[] = []
    const inputs: string[] = []
    const el = (name: string) => ({ name, disabled: false, isConnected: false }) as unknown as HTMLElement
    const deps: CreatorDeps = {
      getCreateNewButton: () => el('create'),
      getSourceDialog: () => el('dialog'),
      getWebsiteChip: () => el('chip'),
      getUrlInput: () => ({}) as HTMLTextAreaElement,
      getSubmitButton: () => el('submit'),
      setInputValue: (_el, v) => { inputs.push(v) },
      click: (e) => { clicks.push((e as unknown as { name: string }).name) },
      waitFor: (async (fn: () => unknown) => {
        const v = fn()
        if (v) return v
        throw new Error('timeout')
      }) as unknown as CreatorDeps['waitFor'],
    }
    return { run: (urls) => createNotebookWithUrls(urls, deps), clicks, inputs }
  }

  // urls が無い: 何もクリックせずに失敗を返す。
  it.each([
    ['missing', { ts: 1000, tabId: 5 }],
    ['null', { urls: null, ts: 1000, tabId: 5 }],
  ])('reports failure without clicking anything when urls is %s', async (_label, pending) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = makeEnv(pending, 1500)
    const r = makeRunner()
    await expect(handlePendingCreate(env, r.run)).resolves.toBeUndefined()
    expect(env.removed).toEqual(['pendingCreate'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false, tabId: 5 }])
    expect(r.clicks).toEqual([])
    expect(r.inputs).toEqual([])
    error.mockRestore()
  })

  // urls が配列以外の値: URL は投入されず（挿入は押されず）失敗を返す。
  // 注: この形は「新規作成」「ウェブサイト」までは押してから失敗する（handlePendingCreate が
  // 形を検証しないため）。ここではその途中経過は固定せず、投入されないことだけを見る。
  it.each([
    ['a string', 'https://a/'],
    ['a number', 42],
    ['an object', { 0: 'https://a/' }],
  ])('reports failure without inserting when urls is %s', async (_label, urls) => {
    const env = makeEnv({ urls, ts: 1000, tabId: 5 }, 1500)
    const r = makeRunner()
    await expect(handlePendingCreate(env, r.run)).resolves.toBeUndefined()
    expect(env.removed).toEqual(['pendingCreate'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false, tabId: 5 }])
    expect(r.inputs).toEqual([])
    expect(r.clicks).not.toContain('submit')
  })

  it('reports failure without clicking anything when urls is an empty array', async () => {
    const env = makeEnv({ urls: [], ts: 1000, tabId: 5 }, 1500)
    const r = makeRunner()
    await handlePendingCreate(env, r.run)
    expect(env.removed).toEqual(['pendingCreate'])
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: false, tabId: 5 }])
    expect(r.clicks).toEqual([])
  })

  it('does not run when pendingCreate is null', async () => {
    const env = makeEnv(null)
    const r = makeRunner()
    await handlePendingCreate(env, r.run)
    expect(env.sent).toEqual([])
    expect(r.clicks).toEqual([])
  })
})
