import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handlePendingCreate, start, type CreateEnv } from '../src/content/main'
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
      getAddSourceButton: () => null,
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

// #119: start() の既定ランナー（defaultCreateRunner）を実 DOM（jsdom）に結線して、作成後に
// ダイアログが自動で開かない UI で「ソースを追加」を押してから URL を挿入することを固定する。
// 単体テスト（notebook-creator.test.ts）はフェイクの deps を渡すので、main.ts の配線の誤り
// （例: getAddSourceButton の未配線）はここでしか捕まえられない。
describe('start() default create runner on a page where the source dialog does not auto-open (#119)', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = '' })
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = '' })

  function on(sel: string, handler: () => void, root: ParentNode = document) {
    root.querySelector<HTMLElement>(sel)!.addEventListener('click', handler)
  }

  it('clicks ソースを追加, then website → insert, and reports success', async () => {
    const log: string[] = []
    let inserted = ''
    document.body.innerHTML = '<button aria-label="新しいノートブック">新しいノートブック</button>'
    on('button', () => {
      log.push('create')
      // 遷移先の /notebook/<id> は「ソースを追加」だけを描画し、ダイアログは開かない（§8.15）。
      document.body.innerHTML = '<button aria-label="ソースを追加">ソースを追加</button>'
      on('button', () => {
        log.push('add-source')
        const dialog = document.createElement('mat-dialog-container')
        dialog.innerHTML =
          '<button class="source-action-button">ウェブサイト</button>' +
          '<textarea formcontrolname="urls"></textarea><button class="insert">挿入</button>'
        on('.source-action-button', () => { log.push('chip') }, dialog)
        on('.insert', () => {
          log.push('submit')
          inserted = dialog.querySelector('textarea')!.value
          dialog.remove()
        }, dialog)
        document.body.append(dialog)
      })
    })
    const env = makeEnv({ urls: ['https://a/', 'https://b/'], ts: 1000, tabId: 5 }, 1500)
    const dispose = start(document, () => '/', env)
    await vi.advanceTimersByTimeAsync(5000)
    expect(log).toEqual(['create', 'add-source', 'chip', 'submit'])
    expect(inserted).toBe('https://a/\nhttps://b/')
    expect(env.sent).toEqual([{ type: CREATE_RESULT_MESSAGE, ok: true, tabId: 5 }])
    dispose()
  })
})
