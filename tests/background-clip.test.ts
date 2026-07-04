import { describe, it, expect, vi, type Mock } from 'vitest'
import { handleClipClick, handleCreateResult, resetStuckClip, type ClipDeps } from '../src/background/main'

type Badge = { text: string; tabId?: number }

function makeDeps(): ClipDeps & {
  set: Mock<[Record<string, unknown>], Promise<void>>
  created: unknown[]
  badges: Badge[]
  removed: string[]
} {
  const created: unknown[] = []
  const badges: Badge[] = []
  const removed: string[] = []
  const set = vi.fn(async (_i: Record<string, unknown>) => {})
  return {
    created, badges, set, removed,
    storageSet: set,
    createTab: vi.fn(async (p) => { created.push(p); return {} }),
    setBadge: (text: string, tabId?: number) => { badges.push({ text, tabId }) },
    now: () => 1000,
    storageGet: vi.fn(async (_k: string) => ({})),
    storageRemove: vi.fn(async (k: string) => { removed.push(k) }),
  }
}

describe('handleClipClick', () => {
  it('badges "!" on the source tab and does nothing for a non-http url', async () => {
    const d = makeDeps()
    await handleClipClick('chrome://extensions/', 7, d)
    expect(d.badges).toContainEqual({ text: '!', tabId: 7 })
    expect(d.set).not.toHaveBeenCalled()
    expect(d.created).toEqual([])
  })

  it('stores pendingCreate with tabId and badges "…" on the source tab', async () => {
    const d = makeDeps()
    await handleClipClick('https://x.example/', 7, d)
    expect(d.set).toHaveBeenCalledWith({ pendingCreate: { urls: ['https://x.example/'], ts: 1000, tabId: 7 } })
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/', active: false }])
    expect(d.badges).toContainEqual({ text: '…', tabId: 7 })
  })

  it('stores tabId undefined when the clicked tab has no id (global fallback)', async () => {
    const d = makeDeps()
    await handleClipClick('https://x.example/', undefined, d)
    expect(d.set).toHaveBeenCalledWith({ pendingCreate: { urls: ['https://x.example/'], ts: 1000, tabId: undefined } })
    expect(d.badges).toContainEqual({ text: '…', tabId: undefined })
  })

  it('falls back to "!" on the source tab without throwing when storageSet rejects', async () => {
    const d = makeDeps()
    d.storageSet = vi.fn(async () => { throw new Error('storage unavailable') })
    await expect(handleClipClick('https://x.example/', 7, d)).resolves.toBeUndefined()
    expect(d.badges).toContainEqual({ text: '!', tabId: 7 })
  })

  it('falls back to "!" and removes pendingCreate when createTab rejects', async () => {
    const d = makeDeps()
    d.createTab = vi.fn(async () => { throw new Error('no tab') })
    await expect(handleClipClick('https://x.example/', 7, d)).resolves.toBeUndefined()
    expect(d.badges).toContainEqual({ text: '!', tabId: 7 })
    expect(d.removed).toEqual(['pendingCreate'])
  })
})

describe('resetStuckClip', () => {
  it('badges "!" on the stored tabId and removes pendingCreate when it is still present', async () => {
    const badges: Badge[] = []
    const removed: string[] = []
    await resetStuckClip({
      storageGet: async (_k: string) => ({ pendingCreate: { urls: ['https://x.example/'], ts: 1000, tabId: 9 } }),
      storageRemove: async (k: string) => { removed.push(k) },
      setBadge: (text: string, tabId?: number) => { badges.push({ text, tabId }) },
    })
    expect(badges).toEqual([{ text: '!', tabId: 9 }])
    expect(removed).toEqual(['pendingCreate'])
  })

  it('does nothing when pendingCreate is already gone (normal flow completed)', async () => {
    const badges: Badge[] = []
    const removed: string[] = []
    await resetStuckClip({
      storageGet: async (_k: string) => ({}),
      storageRemove: async (k: string) => { removed.push(k) },
      setBadge: (text: string, tabId?: number) => { badges.push({ text, tabId }) },
    })
    expect(badges).toEqual([])
    expect(removed).toEqual([])
  })
})

describe('handleCreateResult', () => {
  it('badges check/bang on the given tabId', () => {
    const badges: Badge[] = []
    const setBadge = (text: string, tabId?: number) => { badges.push({ text, tabId }) }
    handleCreateResult(true, 3, { setBadge })
    handleCreateResult(false, 3, { setBadge })
    expect(badges).toEqual([{ text: '✓', tabId: 3 }, { text: '!', tabId: 3 }])
  })
})
