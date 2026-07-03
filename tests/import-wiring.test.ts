import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { initImport, type ImportEnv } from '../src/content/main'
import { RUN_PENDING_MESSAGE, IMPORT_RESULT_MESSAGE, type PendingImport } from '../src/types'

function makeEnv(pathname: string, over: Partial<ImportEnv> = {}): ImportEnv & {
  set: Mock<[], Promise<void>>; listeners: ((msg: unknown) => void)[]; unsub: ReturnType<typeof vi.fn>
} {
  const listeners: ((msg: unknown) => void)[] = []
  const unsub = vi.fn()
  const set = vi.fn(async () => {})
  return {
    set, listeners, unsub,
    getPathname: () => pathname,
    getTitle: () => 'マイノート - NotebookLM',
    storageGet: vi.fn(async () => ({})),
    storageSet: set,
    storageRemove: vi.fn(async () => {}),
    now: () => 1000,
    addMessageListener: (h) => { listeners.push(h); return unsub },
    sendMessage: vi.fn(),
    ...over,
  }
}

describe('initImport wiring (F2-2)', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { vi.useRealTimers() })

  it('saves lastNotebook on mount when on a notebook page', () => {
    const env = makeEnv('/notebook/abc-1')
    const dispose = initImport(document, env)
    expect(env.set).toHaveBeenCalledWith({ lastNotebook: { id: 'abc-1', title: 'マイノート' } })
    dispose()
  })

  it('does not save lastNotebook when pathname is not a notebook page', () => {
    const env = makeEnv('/')
    const dispose = initImport(document, env)
    expect(env.set).not.toHaveBeenCalled()
    dispose()
  })

  it('unsubscribes the message listener on dispose', () => {
    const env = makeEnv('/notebook/abc-1')
    const dispose = initImport(document, env)
    expect(env.listeners.length).toBe(1)
    dispose()
    expect(env.unsub).toHaveBeenCalled()
  })

  it('checks pendingImport on mount (calls storageGet)', () => {
    const env = makeEnv('/notebook/abc-1')
    const dispose = initImport(document, env)
    expect(env.storageGet).toHaveBeenCalledWith('pendingImport')
    dispose()
  })

  it('runs handlePending on a run-pending message and reports the result via sendMessage', async () => {
    // このノートブック宛の fresh な pendingImport。mount 時（1回目の storageGet 呼び出し）
    // では意図的に「まだ無い」を返し、リスナー経由の run-pending（2回目の呼び出し）で
    // 初めて見つかる、という順序にすることで、「listener → handlePending 実行」経路を
    // mount 時の自動実行と混同せずに検証する。
    const pending: PendingImport = { notebookId: 'abc-1', url: 'https://example.com/', ts: 1000 }
    let storageGetCalls = 0
    const env = makeEnv('/notebook/abc-1', {
      storageGet: vi.fn(async (key: string) => {
        storageGetCalls += 1
        if (key === 'pendingImport' && storageGetCalls > 1) return { pendingImport: pending }
        return {}
      }),
    })

    // importer は実 DOM の「ソース追加」フローを waitFor（既定 10s タイムアウト）で
    // 待つため、要素が一切無い jsdom では実時間で 10 秒かかってしまう。フェイクタイマーで
    // 仮想時間だけを進め、決定的かつ高速にタイムアウト（＝失敗として処理）させる。
    // 主眼は「run-pending 受信 → handlePending 実行 → import-result 送信」の配線の
    // 疎通確認であり、importUrls 自体の成功/失敗は問わない（ok=false でもよい）。
    vi.useFakeTimers()
    try {
      const dispose = initImport(document, env)
      expect(env.sendMessage).not.toHaveBeenCalled()

      env.listeners[0]({ type: RUN_PENDING_MESSAGE })
      await vi.advanceTimersByTimeAsync(11000)

      expect(env.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: IMPORT_RESULT_MESSAGE, ok: expect.any(Boolean) }),
      )
      dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
