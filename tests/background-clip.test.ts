import { describe, it, expect, vi, type Mock } from 'vitest'
import { handleClipClick, handleCreateResult, resetStuckClip, type ClipDeps } from '../src/background/main'

function makeDeps(): ClipDeps & {
  set: Mock<[Record<string, unknown>], Promise<void>>
  created: unknown[]
  badges: string[]
  removed: string[]
} {
  const created: unknown[] = []
  const badges: string[] = []
  const removed: string[] = []
  const set = vi.fn(async (_i: Record<string, unknown>) => {})
  return {
    created, badges, set, removed,
    storageSet: set,
    createTab: vi.fn(async (p) => { created.push(p); return {} }),
    setBadge: (t: string) => { badges.push(t) },
    now: () => 1000,
    storageGet: vi.fn(async (_k: string) => ({})),
    storageRemove: vi.fn(async (k: string) => { removed.push(k) }),
  }
}

describe('handleClipClick', () => {
  it('badges "!" and does nothing for a non-http url', async () => {
    const d = makeDeps()
    await handleClipClick('chrome://extensions/', d)
    expect(d.badges).toContain('!')
    expect(d.set).not.toHaveBeenCalled()
    expect(d.created).toEqual([])
  })

  it('stores pendingCreate and opens NotebookLM home in the foreground', async () => {
    const d = makeDeps()
    await handleClipClick('https://x.example/', d)
    expect(d.set).toHaveBeenCalledWith({ pendingCreate: { urls: ['https://x.example/'], ts: 1000 } })
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/', active: true }])
    expect(d.badges).toContain('…')
  })

  it('falls back to "!" without throwing when storageSet rejects', async () => {
    const d = makeDeps()
    d.storageSet = vi.fn(async () => { throw new Error('storage unavailable') })
    await expect(handleClipClick('https://x.example/', d)).resolves.toBeUndefined()
    expect(d.badges).toContain('!')
  })

  it('falls back to "!" without throwing when createTab rejects', async () => {
    const d = makeDeps()
    d.createTab = vi.fn(async () => { throw new Error('no tab') })
    await expect(handleClipClick('https://x.example/', d)).resolves.toBeUndefined()
    expect(d.badges).toContain('!')
    // M-1: createTab 失敗時は pendingCreate を残さない（後で手動で NotebookLM を
    // 開いた際に意図しない自動作成が起きるのを防ぐ）
    expect(d.removed).toEqual(['pendingCreate'])
  })
})

describe('resetStuckClip', () => {
  it('badges "!" and removes pendingCreate when it is still present (content script never ran)', async () => {
    const badges: string[] = []
    const removed: string[] = []
    await resetStuckClip({
      storageGet: async (_k: string) => ({ pendingCreate: { urls: ['https://x.example/'], ts: 1000 } }),
      storageRemove: async (k: string) => { removed.push(k) },
      setBadge: (t: string) => { badges.push(t) },
    })
    expect(badges).toEqual(['!'])
    expect(removed).toEqual(['pendingCreate'])
  })

  it('does nothing when pendingCreate is already gone (normal flow completed)', async () => {
    const badges: string[] = []
    const removed: string[] = []
    await resetStuckClip({
      storageGet: async (_k: string) => ({}),
      storageRemove: async (k: string) => { removed.push(k) },
      setBadge: (t: string) => { badges.push(t) },
    })
    expect(badges).toEqual([])
    expect(removed).toEqual([])
  })
})

describe('handleCreateResult', () => {
  it('badges check on success and bang on failure', () => {
    const ok: string[] = []
    handleCreateResult(true, { setBadge: (t) => ok.push(t) })
    handleCreateResult(false, { setBadge: (t) => ok.push(t) })
    expect(ok).toEqual(['✓', '!'])
  })
})
