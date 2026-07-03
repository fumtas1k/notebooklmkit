import { describe, it, expect, vi, type Mock } from 'vitest'
import { handleClipClick, handleCreateResult, type ClipDeps } from '../src/background/main'

function makeDeps(): ClipDeps & { set: Mock<[Record<string, unknown>], Promise<void>>; created: unknown[]; badges: string[] } {
  const created: unknown[] = []
  const badges: string[] = []
  const set = vi.fn(async (_i: Record<string, unknown>) => {})
  return {
    created, badges, set,
    storageSet: set,
    createTab: vi.fn(async (p) => { created.push(p); return {} }),
    setBadge: (t: string) => { badges.push(t) },
    now: () => 1000,
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
