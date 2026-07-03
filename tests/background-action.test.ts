import { describe, it, expect, vi, type Mock } from 'vitest'
import { handleActionClick, handleImportResult, type ActionDeps } from '../src/background/main'

function makeDeps(over: Partial<ActionDeps> & { lastNotebook?: unknown } = {}): ActionDeps & {
  set: Mock<[Record<string, unknown>], Promise<void>>; created: unknown[]; sent: { id: number; msg: unknown }[]; badges: string[]
} {
  const created: unknown[] = []
  const sent: { id: number; msg: unknown }[] = []
  const badges: string[] = []
  const set = vi.fn(async (_items: Record<string, unknown>) => {})
  return {
    created, sent, badges, set,
    storageGet: vi.fn(async () => (over.lastNotebook === undefined ? {} : { lastNotebook: over.lastNotebook })),
    storageSet: set,
    queryTabs: over.queryTabs ?? vi.fn(async () => []),
    createTab: vi.fn(async (p) => { created.push(p); return {} }),
    sendTabMessage: vi.fn(async (id, msg) => { sent.push({ id, msg }) }),
    setBadge: (t: string) => { badges.push(t) },
    now: () => 1000,
  }
}

describe('handleActionClick', () => {
  it('badges "!" and does nothing for a non-http url', async () => {
    const d = makeDeps({ lastNotebook: { id: 'a', title: 'A' } })
    await handleActionClick('chrome://extensions/', d)
    expect(d.badges).toContain('!')
    expect(d.set).not.toHaveBeenCalled()
    expect(d.created).toEqual([])
  })

  it('opens NotebookLM home and badges "!" when no lastNotebook', async () => {
    const d = makeDeps({ lastNotebook: undefined })
    await handleActionClick('https://x.example/', d)
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/', active: true }])
    expect(d.badges).toContain('!')
    expect(d.set).not.toHaveBeenCalled()
  })

  it('stores pendingImport and sends run-pending to an existing notebook tab', async () => {
    const d = makeDeps({
      lastNotebook: { id: 'a', title: 'A' },
      queryTabs: vi.fn(async () => [{ id: 7, url: 'https://notebooklm.google.com/notebook/a' }]),
    })
    await handleActionClick('https://x.example/', d)
    expect(d.set).toHaveBeenCalledWith({ pendingImport: { notebookId: 'a', url: 'https://x.example/', ts: 1000 } })
    expect(d.sent).toEqual([{ id: 7, msg: { type: 'nlk:run-pending' } }])
    expect(d.created).toEqual([])
    expect(d.badges).toContain('…')
  })

  it('opens a background notebook tab when none exists', async () => {
    const d = makeDeps({
      lastNotebook: { id: 'a', title: 'A' },
      queryTabs: vi.fn(async () => [{ id: 9, url: 'https://notebooklm.google.com/notebook/other' }]),
    })
    await handleActionClick('https://x.example/', d)
    expect(d.set).toHaveBeenCalledWith({ pendingImport: { notebookId: 'a', url: 'https://x.example/', ts: 1000 } })
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/notebook/a', active: false }])
    expect(d.sent).toEqual([])
  })
})

describe('handleImportResult', () => {
  it('badges check on success and bang on failure', () => {
    const ok: string[] = []
    handleImportResult(true, { setBadge: (t) => ok.push(t) })
    handleImportResult(false, { setBadge: (t) => ok.push(t) })
    expect(ok).toEqual(['✓', '!'])
  })
})
