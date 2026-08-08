import { describe, it, expect, vi } from 'vitest'
import { deleteNotebooks, type DeleterDeps } from '../src/content/deleter'
import { waitFor } from '../src/content/dom-utils'
import { makeTarget, type NotebookTarget } from '../src/types'

// 削除対象の世界を実 DOM ノードで表現するフェイク world。
// row.isConnected を実際の DOM 接続状態として検証できるようにする。
function makeWorld(titles: string[]) {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  document.body.appendChild(container)
  for (const t of titles) {
    const tr = document.createElement('div'); tr.dataset.title = t; container.appendChild(tr)
  }
  let menuRow: HTMLElement | null = null
  let dialogRow: HTMLElement | null = null
  const el = (name: string) => { const e = document.createElement('div'); e.dataset.name = name; return e }
  const firstRow = (title: string) =>
    ([...container.children] as HTMLElement[]).find((r) => r.dataset.title === title) ?? null

  const deps: DeleterDeps = {
    findRow: (t) => firstRow(t.title),
    getMoreButton: (row) => { const b = el('more'); (b as any)._row = row; return b },
    getDeleteMenuItem: () => (menuRow ? el('delete') : null),
    getConfirmDialog: () => (dialogRow ? el('dialog') : null),
    getConfirmDeleteButton: () => el('confirm'),
    click: (e) => {
      const name = e.dataset.name
      if (name === 'more') menuRow = (e as any)._row ?? null
      else if (name === 'delete') { dialogRow = menuRow; menuRow = null }
      else if (name === 'confirm') { dialogRow?.remove(); dialogRow = null }
    },
    waitFor,
    timeout: 200,
    // テストは実時間を待たない。settle 待機が「呼ばれたか / 何 ms か」だけ検証する。
    delay: async () => {},
  }
  return { deps, container }
}

const targets = (...names: string[]): NotebookTarget[] =>
  names.map((n) => makeTarget({ title: n }))

describe('deleteNotebooks', () => {
  it('deletes all targets sequentially and reports progress', async () => {
    const { deps, container } = makeWorld(['A', 'B', 'C'])
    const progress = vi.fn()
    const res = await deleteNotebooks(targets('A', 'B', 'C'), deps, { onProgress: progress })
    expect(res.succeeded.length).toBe(3)
    expect(res.failed).toEqual([])
    expect(res.aborted).toBe(false)
    expect(container.children.length).toBe(0)
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: 3, completed: 3, failed: 0 }),
    )
  })

  it('waits for the confirm Delete button to render after the dialog appears', async () => {
    const { deps, container } = makeWorld(['A'])
    // mat-dialog-container は先に出るが Delete ボタンは遅れて描画される状況を再現：
    // 最初の取得は null、次回以降ボタンを返す。同期取得だった旧実装なら失敗する。
    const realGetBtn = deps.getConfirmDeleteButton
    let calls = 0
    deps.getConfirmDeleteButton = (dialog) => {
      calls++
      return calls < 2 ? null : realGetBtn(dialog)
    }
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(res.succeeded.length).toBe(1)
    expect(res.failed).toEqual([])
    expect(container.children.length).toBe(0)
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('records a failure when a row never disappears, and stops', async () => {
    const { deps } = makeWorld(['A', 'B'])
    // confirm click は行を消さないよう差し替え → 消滅待ちがタイムアウト。
    // more→menu, delete→dialog の開閉は維持し、⑤ まで到達させる。
    let menuOpen = false
    let dialogOpen = false
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') menuOpen = true
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      // confirm: 何もしない（行を残したまま）
    }
    deps.getDeleteMenuItem = () => (menuOpen ? document.createElement('div') : null)
    deps.getConfirmDialog = () => (dialogOpen ? document.createElement('div') : null)
    const res = await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(res.succeeded.length).toBe(0)
    expect(res.failed.length).toBe(1) // 最初の失敗で停止
    expect(res.failed[0].key).toBe('title:A')
  })

  it('aborts between items when signal is aborted', async () => {
    const { deps } = makeWorld(['A', 'B', 'C'])
    const ac = new AbortController()
    let count = 0
    const baseClick = deps.click
    const wrapped = { ...deps, click: (e: HTMLElement) => {
      baseClick(e)
      if (e.dataset.name === 'confirm') { count++; if (count === 1) ac.abort() }
    } }
    const res = await deleteNotebooks(targets('A', 'B', 'C'), wrapped, { signal: ac.signal })
    expect(res.aborted).toBe(true)
    expect(res.succeeded.length).toBe(1) // 1件完了後に中断
  })

  it('deletes duplicate-titled notebooks without a false failure', async () => {
    const { deps, container } = makeWorld(['X', 'X'])
    const res = await deleteNotebooks(targets('X', 'X'), deps, {})
    expect(res.succeeded.length).toBe(2)
    expect(res.failed).toEqual([])
    expect(container.children.length).toBe(0)
  })
})

// #82: 確認ダイアログ出現直後のクリックは「閉じるだけで削除されない」（実機確認・§8.11）。
// 対策は (1) confirm クリック前の settle 待機、(2) 未削除を確認したうえでの再試行。
describe('confirm click settling and retry', () => {
  // click ディスパッチは dataset.name で分岐するため、フェイク要素には必ず名前を付ける。
  const named = (name: string): HTMLElement => {
    const e = document.createElement('div')
    e.dataset.name = name
    return e
  }

  it('waits (settle) after finding the confirm button and before clicking it', async () => {
    const { deps } = makeWorld(['A'])
    const order: string[] = []
    const realClick = deps.click
    deps.delay = async (ms) => { order.push(`delay:${ms}`) }
    deps.click = (e) => { order.push(`click:${e.dataset.name}`); realClick(e) }
    await deleteNotebooks(targets('A'), deps, {})
    // 「confirm ボタンを見つけた後・クリックする前」に待機が入っていること
    expect(order).toContain('click:confirm')
    const settleIdx = order.findIndex((o) => o.startsWith('delay:'))
    expect(settleIdx).toBeGreaterThanOrEqual(0)
    expect(settleIdx).toBeLessThan(order.indexOf('click:confirm'))
  })

  it('uses the configured settleMs', async () => {
    const { deps } = makeWorld(['A'])
    const waited: number[] = []
    deps.delay = async (ms) => { waited.push(ms) }
    deps.settleMs = 321
    await deleteNotebooks(targets('A'), deps, {})
    expect(waited).toContain(321)
  })

  it('retries the whole flow when the first confirm click silently fails', async () => {
    const { deps, container } = makeWorld(['A'])
    // 1回目の confirm クリックだけ「ダイアログは閉じるが行は消えない」を再現する。
    let menuOpen = false, dialogOpen = false, confirmClicks = 0
    let rowToRemove: HTMLElement | null = null
    deps.getMoreButton = (row) => { const b = named('more'); (b as any)._row = row; return b }
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') { menuOpen = true; rowToRemove = (e as any)._row ?? null }
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') {
        confirmClicks++
        dialogOpen = false                       // ダイアログは必ず閉じる
        if (confirmClicks >= 2) rowToRemove?.remove()  // 2回目で初めて実際に消える
      }
    }
    deps.getDeleteMenuItem = () => (menuOpen ? named('delete') : null)
    deps.getConfirmDialog = () => (dialogOpen ? named('dialog') : null)
    deps.getConfirmDeleteButton = () => named('confirm')

    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(confirmClicks).toBe(2)
    expect(res.succeeded).toEqual(['title:A'])
    expect(res.failed).toEqual([])
    expect(container.children.length).toBe(0)
  })

  it('gives up after maxAttempts and records the failure (does not loop forever)', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    let menuOpen = false, dialogOpen = false, confirmClicks = 0
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') menuOpen = true
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') { confirmClicks++; dialogOpen = false } // 行は永久に消えない
    }
    deps.getDeleteMenuItem = () => (menuOpen ? named('delete') : null)
    deps.getConfirmDialog = () => (dialogOpen ? named('dialog') : null)
    deps.getConfirmDeleteButton = () => named('confirm')
    deps.maxAttempts = 3

    const res = await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(confirmClicks).toBe(3)          // 上限まで試して打ち切る
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1)      // 最初の失敗で停止（B には進まない）
    expect(res.failed[0].key).toBe('title:A')
    expect(container.children.length).toBe(2)
  })

  it('never re-clicks confirm once the row is gone (no double deletion)', async () => {
    const { deps } = makeWorld(['A'])
    let confirmClicks = 0
    const realClick = deps.click
    deps.click = (e) => { if (e.dataset.name === 'confirm') confirmClicks++; realClick(e) }
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(confirmClicks).toBe(1)          // 成功した1件を二度押さない
    expect(res.succeeded).toEqual(['title:A'])
  })
})
