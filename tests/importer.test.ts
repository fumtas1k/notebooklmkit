import { describe, it, expect, vi } from 'vitest'
import { importUrls, type ImporterDeps } from '../src/content/importer'
import { waitFor } from '../src/content/dom-utils'

// ソース追加フローの世界を実 DOM ノードで表現するフェイク world。
// dialog.isConnected を実際の DOM 接続状態として検証できるようにする。
function makeWorld() {
  document.body.innerHTML = ''
  const added: string[] = []
  let addCount = 0
  let dialog: HTMLElement | null = null
  // textarea を使う: <input> は jsdom（実ブラウザ仕様どおり）代入時に改行を
  // 除去してしまい、バッチ投入（複数 URL を改行区切りで1回入力）を再現できない。
  let input: HTMLTextAreaElement | null = null
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
        addCount++
        dialog = document.createElement('div')
        document.body.appendChild(dialog)
        input = null
      } else if (name === 'chip') {
        input = document.createElement('textarea')
        dialog?.appendChild(input)
      } else if (name === 'submit') {
        // 実機は1挿入で改行区切りの複数 URL をまとめて追加する（§8.6）
        if (input) added.push(...input.value.split('\n').map((s) => s.trim()).filter(Boolean))
        dialog?.remove()
        dialog = null
        input = null
      }
    },
    waitFor,
    timeout: 200,
  }
  return { deps, added, addCount: () => addCount, isDialogOpen: () => dialog !== null }
}

const URLS = ['https://a.example/', 'https://b.example/']

describe('importUrls', () => {
  it('batches multiple urls into a single dialog submission', async () => {
    const { deps, added, addCount } = makeWorld()
    const progress = vi.fn()
    const res = await importUrls(URLS, deps, { onProgress: progress })
    expect(addCount()).toBe(1) // 1ダイアログで一括投入
    expect(added).toEqual(URLS)
    expect(res.succeeded).toEqual(URLS)
    expect(res.failed).toEqual([])
    expect(res.aborted).toBe(false)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ batch: true }))
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: 2, completed: 2, failed: 0 }),
    )
  })

  it('falls back to per-url when the batch fails before commit', async () => {
    const { deps, added, addCount } = makeWorld()
    // 複数行入力だと挿入ボタンが有効化しない世界（コミット前失敗）を再現
    const realSubmit = deps.getSubmitButton
    deps.getSubmitButton = (d) => {
      const b = realSubmit(d) as HTMLButtonElement | null
      if (b && d.querySelector('textarea')) {
        const v = d.querySelector('textarea')!.value
        if (v.includes('\n')) b.disabled = true
      }
      return b
    }
    const res = await importUrls(URLS, deps)
    expect(addCount()).toBe(3) // バッチ1回（失敗）＋フォールバック2回
    expect(added).toEqual(URLS) // 個別投入で両方成功
    expect(res.succeeded).toEqual(URLS)
    expect(res.failed).toEqual([])
  })

  it('fails all urls and stops when the batch dialog never closes after commit', async () => {
    const { deps, addCount } = makeWorld()
    const realClick = deps.click
    deps.click = (e) => {
      if (e.dataset.name === 'submit') return // 挿入しても閉じない（想定外 DOM）
      realClick(e)
    }
    const res = await importUrls(URLS, deps)
    expect(addCount()).toBe(1) // コミット後失敗はフォールバックしない
    expect(res.succeeded).toEqual([])
    expect(res.failed.map((f) => f.url)).toEqual(URLS) // 全件を失敗記録して停止
  })

  it('aborts before commit during the batch', async () => {
    const { deps, added } = makeWorld()
    deps.getWebsiteChip = () => null // チップが出ないまま待ち続ける（コミット前）
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    const res = await importUrls(URLS, deps, { signal: ac.signal })
    expect(res.aborted).toBe(true)
    expect(res.succeeded).toEqual([])
    expect(added).toEqual([])
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

  it('resolves immediately with an empty result for empty input', async () => {
    const { deps } = makeWorld()
    const progress = vi.fn()
    const res = await importUrls([], deps, { onProgress: progress })
    expect(res).toEqual({ succeeded: [], failed: [], aborted: false })
    expect(progress).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith({ total: 0, completed: 0, failed: 0 })
  })

  it('aborts promptly mid-item before the insert click', async () => {
    const { deps } = makeWorld()
    deps.getWebsiteChip = () => null // チップが出現しないまま待ち続ける
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 50)
    const res = await importUrls(['https://a.example/'], deps, { signal: ac.signal })
    expect(res.aborted).toBe(true)
    expect(res.succeeded).toEqual([])
    expect(res.failed).toEqual([])
  })

  // 回帰テスト: バッチ化導入前からあった「単一 URL の逐次パス」「フォールバックの逐次ループ」
  // の安全停止・境界中断の意味論は、バッチ化後も残っている（importOne 自体は変わっていない）。
  it('single-url path records a failure and stops when the dialog never closes', async () => {
    const { deps } = makeWorld()
    const realClick = deps.click
    deps.click = (e) => {
      if (e.dataset.name === 'submit') return // 挿入しても閉じない（想定外 DOM）
      realClick(e)
    }
    const res = await importUrls(['https://a.example/'], deps)
    // 単一 URL はバッチを経ず逐次パスを通る: 失敗を1件記録して停止
    expect(res.succeeded).toEqual([])
    expect(res.failed.map((f) => f.url)).toEqual(['https://a.example/'])
    expect(res.aborted).toBe(false)
  })

  it('fallback loop completes the in-flight url then aborts at the next boundary', async () => {
    const { deps, added } = makeWorld()
    // 複数行入力だと挿入ボタンが有効化しない世界＝バッチはコミット前失敗→逐次フォールバック
    const realSubmit = deps.getSubmitButton
    deps.getSubmitButton = (d) => {
      const b = realSubmit(d) as HTMLButtonElement | null
      const inp = d.querySelector('textarea')
      if (b && inp && inp.value.includes('\n')) b.disabled = true
      return b
    }
    const ac = new AbortController()
    const realClick = deps.click
    deps.click = (e) => {
      realClick(e)
      if (e.dataset.name === 'submit') ac.abort() // 各コミット直後に中断
    }
    const res = await importUrls(URLS, deps, { signal: ac.signal })
    // バッチ④で submit が無効のままタイムアウト（コミット前・submit未クリック）→ フォールバック。
    // フォールバック1件目は改行なしで submit 有効→成功→直後に abort。2件目は URL 境界で未処理。
    expect(res.aborted).toBe(true)
    expect(res.succeeded).toEqual([URLS[0]])
    expect(added).toEqual([URLS[0]])
  })
})
