import { describe, it, expect, vi } from 'vitest'
import { deleteNotebooks, type DeleterDeps } from '../src/content/deleter'
import { waitFor } from '../src/content/dom-utils'
import { makeTarget, type NotebookTarget } from '../src/types'

// 削除対象の世界を配列で表現するフェイク DOM。
function makeWorld(titles: string[]) {
  const present = new Set(titles)
  const el = (name: string) => {
    const e = document.createElement('div'); e.dataset.name = name; return e
  }
  let menuOpenFor: string | null = null
  let dialogOpenFor: string | null = null

  const deps: DeleterDeps = {
    findRow: (t) => (present.has(t.title) ? el(t.title) : null),
    getMoreButton: (row) => {
      const b = el('more'); b.dataset.for = row.dataset.name!; return b
    },
    getDeleteMenuItem: () => (menuOpenFor ? el('delete') : null),
    getConfirmDialog: () => (dialogOpenFor ? el('dialog') : null),
    getConfirmDeleteButton: () => el('confirm'),
    click: (e) => {
      const name = e.dataset.name
      if (name === 'more') menuOpenFor = e.dataset.for ?? null
      else if (name === 'delete') { dialogOpenFor = menuOpenFor; menuOpenFor = null }
      else if (name === 'confirm') {
        if (dialogOpenFor) present.delete(dialogOpenFor)
        dialogOpenFor = null
      }
    },
    waitFor,
    timeout: 200,
  }
  return { deps, present }
}

const targets = (...names: string[]): NotebookTarget[] =>
  names.map((n) => makeTarget({ title: n }))

describe('deleteNotebooks', () => {
  it('deletes all targets sequentially and reports progress', async () => {
    const { deps, present } = makeWorld(['A', 'B', 'C'])
    const progress = vi.fn()
    const res = await deleteNotebooks(targets('A', 'B', 'C'), deps, { onProgress: progress })
    expect(res.succeeded.length).toBe(3)
    expect(res.failed).toEqual([])
    expect(res.aborted).toBe(false)
    expect(present.size).toBe(0)
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: 3, completed: 3, failed: 0 }),
    )
  })

  it('records a failure when a row never disappears, and stops', async () => {
    const { deps } = makeWorld(['A', 'B'])
    // confirm click は行を消さないよう差し替え → 消滅待ちがタイムアウト
    deps.click = (e) => { if (e.dataset.name === 'more') {/* open menu */} }
    // getDeleteMenuItem を常に返し、confirm も返すが、行は残り続ける
    deps.getDeleteMenuItem = () => document.createElement('div')
    deps.getConfirmDialog = () => document.createElement('div')
    const res = await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(res.succeeded.length).toBe(0)
    expect(res.failed.length).toBe(1) // 最初の失敗で停止
    expect(res.failed[0].key).toBe('title:A')
  })

  it('aborts between items when signal is aborted', async () => {
    const { deps } = makeWorld(['A', 'B', 'C'])
    const ac = new AbortController()
    let count = 0
    const wrapped = { ...deps, click: (e: HTMLElement) => {
      deps.click(e)
      if (e.dataset.name === 'confirm') { count++; if (count === 1) ac.abort() }
    } }
    const res = await deleteNotebooks(targets('A', 'B', 'C'), wrapped, { signal: ac.signal })
    expect(res.aborted).toBe(true)
    expect(res.succeeded.length).toBe(1) // 1件完了後に中断
  })
})
