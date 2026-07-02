import { describe, it, expect, vi } from 'vitest'
import { importUrls, type ImporterDeps } from '../src/content/importer'
import { waitFor } from '../src/content/dom-utils'

// ソース追加フローの世界を実 DOM ノードで表現するフェイク world。
// dialog.isConnected を実際の DOM 接続状態として検証できるようにする。
function makeWorld() {
  document.body.innerHTML = ''
  const added: string[] = []
  let dialog: HTMLElement | null = null
  let input: HTMLInputElement | null = null
  const el = (name: string) => {
    const e = document.createElement('button')
    e.dataset.name = name
    return e
  }

  const deps: ImporterDeps = {
    getAddSourceButton: () => el('add'),
    getSourceDialog: () => dialog,
    getWebsiteChip: () => (dialog ? el('chip') : null),
    getUrlInput: () => input,
    getSubmitButton: () => {
      if (!dialog || !input) return null
      const b = el('submit') as HTMLButtonElement
      b.disabled = input.value === '' // URL 未入力の間は無効（実機の想定挙動）
      return b
    },
    setInputValue: (e, v) => { e.value = v },
    click: (e) => {
      const name = e.dataset.name
      if (name === 'add') {
        dialog = document.createElement('div')
        document.body.appendChild(dialog)
        input = null
      } else if (name === 'chip') {
        input = document.createElement('input')
        dialog?.appendChild(input)
      } else if (name === 'submit') {
        if (input) added.push(input.value)
        dialog?.remove()
        dialog = null
        input = null
      }
    },
    waitFor,
    timeout: 200,
  }
  return { deps, added, isDialogOpen: () => dialog !== null }
}

const URLS = ['https://a.example/', 'https://b.example/']

describe('importUrls', () => {
  it('imports all urls sequentially and reports progress', async () => {
    const { deps, added } = makeWorld()
    const progress = vi.fn()
    const res = await importUrls(URLS, deps, { onProgress: progress })
    expect(added).toEqual(URLS)
    expect(res.succeeded).toEqual(URLS)
    expect(res.failed).toEqual([])
    expect(res.aborted).toBe(false)
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: 2, completed: 2, failed: 0 }),
    )
  })

  it('waits for the website chip to render after the dialog appears', async () => {
    const { deps, added } = makeWorld()
    const realChip = deps.getWebsiteChip
    let calls = 0
    deps.getWebsiteChip = (d) => {
      calls++
      return calls < 2 ? null : realChip(d)
    }
    const res = await importUrls(['https://a.example/'], deps)
    expect(res.succeeded.length).toBe(1)
    expect(added).toEqual(['https://a.example/'])
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('records a failure and stops when the dialog never closes', async () => {
    const { deps } = makeWorld()
    const realClick = deps.click
    deps.click = (e) => {
      if (e.dataset.name === 'submit') return // 挿入しても閉じない（想定外 DOM）
      realClick(e)
    }
    const res = await importUrls(URLS, deps)
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1) // 最初の失敗で停止
    expect(res.failed[0].url).toBe(URLS[0])
  })

  it('aborts between items when signal is aborted', async () => {
    const { deps } = makeWorld()
    const ac = new AbortController()
    const realClick = deps.click
    deps.click = (e) => {
      realClick(e)
      if (e.dataset.name === 'submit') ac.abort()
    }
    const res = await importUrls(URLS, deps, { signal: ac.signal })
    expect(res.aborted).toBe(true)
    expect(res.succeeded).toEqual([URLS[0]]) // 処理中の1件は完了させる
  })
})
