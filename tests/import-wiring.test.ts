import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { initImport, type ImportEnv } from '../src/content/main'

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
})
