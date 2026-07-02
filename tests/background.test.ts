import { describe, it, expect, afterEach, vi } from 'vitest'
import { toImportableTabs } from '../src/background/main'
import { LIST_TABS_MESSAGE } from '../src/types'

// chrome.runtime.onMessage に登録される実リスナー本体（toImportableTabs 呼び出し込み）を検証する。
// main.ts はモジュール読み込み時に `typeof chrome !== 'undefined' && chrome.runtime?.onMessage`
// を見てリスナー登録するため、import 前に chrome グローバルをスタブし、
// 各テストでモジュールキャッシュをリセットしてから動的 import する。
type Listener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | undefined

function stubChrome() {
  const addListener = vi.fn()
  const query = vi.fn()
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener } },
    tabs: { query },
  })
  return { addListener, query }
}

async function loadListener() {
  const { addListener, query } = stubChrome()
  vi.resetModules()
  await import('../src/background/main')
  const listener = addListener.mock.calls[0]?.[0] as Listener
  return { listener, query }
}

describe('background onMessage listener', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('queries tabs in the sender window and responds with importable tabs only', async () => {
    const { listener, query } = await loadListener()
    const sendResponse = vi.fn()
    const sender = { tab: { windowId: 42 } } as chrome.runtime.MessageSender

    const result = listener({ type: LIST_TABS_MESSAGE }, sender, sendResponse)

    expect(result).toBe(true)
    expect(query).toHaveBeenCalledWith({ windowId: 42 }, expect.any(Function))

    const callback = query.mock.calls[0][1] as (tabs: unknown[]) => void
    callback([
      { title: 'A', url: 'https://a.example/' },
      { title: 'Ext', url: 'chrome://extensions/' },
      { title: 'NLM', url: 'https://notebooklm.google.com/notebook/x' },
    ])

    expect(sendResponse).toHaveBeenCalledWith({
      tabs: [{ title: 'A', url: 'https://a.example/' }],
    })
  })

  it('falls back to currentWindow when sender has no tab', async () => {
    const { listener, query } = await loadListener()
    const sendResponse = vi.fn()

    listener({ type: LIST_TABS_MESSAGE }, {} as chrome.runtime.MessageSender, sendResponse)

    expect(query).toHaveBeenCalledWith({ currentWindow: true }, expect.any(Function))
  })

  it('ignores non-matching messages and does not query tabs', async () => {
    const { listener, query } = await loadListener()
    const sendResponse = vi.fn()

    const result = listener({ type: 'other' }, {} as chrome.runtime.MessageSender, sendResponse)

    expect(result).toBe(false)
    expect(query).not.toHaveBeenCalled()
    expect(sendResponse).not.toHaveBeenCalled()
  })
})

describe('toImportableTabs', () => {
  it('keeps only http/https tabs and drops NotebookLM itself', () => {
    const tabs = [
      { title: 'A', url: 'https://a.example/' },
      { title: 'Ext', url: 'chrome://extensions/' },
      { title: 'NLM', url: 'https://notebooklm.google.com/notebook/x' },
      { title: 'B', url: 'http://b.example/' },
      { title: 'NoUrl' },
      { title: 'Broken', url: '::::' },
    ]
    expect(toImportableTabs(tabs)).toEqual([
      { title: 'A', url: 'https://a.example/' },
      { title: 'B', url: 'http://b.example/' },
    ])
  })

  it('defaults missing titles to empty string', () => {
    expect(toImportableTabs([{ url: 'https://a.example/' }])).toEqual([
      { title: '', url: 'https://a.example/' },
    ])
  })
})
