import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountActionBar } from '../src/content/ui/action-bar'
import { SelectionStore } from '../src/content/selection'
import { createT } from '../src/content/i18n'

const t = createT('en')

describe('action bar', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const noop = { onSelectAll(){}, onClearAll(){}, onDelete(){}, onStop(){} }

  it('renders and reflects selection count, disables delete at 0', () => {
    const store = new SelectionStore()
    mountActionBar({ store, t, handlers: noop })
    const del = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!
    expect(del.disabled).toBe(true)
    store.replaceAll(['a', 'b'])
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('2')
    expect(del.disabled).toBe(false)
  })

  it('wires button handlers', () => {
    const store = new SelectionStore()
    const handlers = { onSelectAll: vi.fn(), onClearAll: vi.fn(), onDelete: vi.fn(), onStop: vi.fn() }
    store.replaceAll(['a'])
    mountActionBar({ store, t, handlers })
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-clear-all"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    expect(handlers.onSelectAll).toHaveBeenCalledOnce()
    expect(handlers.onClearAll).toHaveBeenCalledOnce()
    expect(handlers.onDelete).toHaveBeenCalledOnce()
  })

  it('shows the stop button only when busy and wires onStop', () => {
    const store = new SelectionStore()
    const handlers = { onSelectAll: vi.fn(), onClearAll: vi.fn(), onDelete: vi.fn(), onStop: vi.fn() }
    const bar = mountActionBar({ store, t, handlers })
    const stop = document.querySelector<HTMLButtonElement>('[data-nlk="bar-stop"]')!
    expect(stop.hidden).toBe(true)
    bar.setBusy(true)
    expect(stop.hidden).toBe(false)
    stop.click()
    expect(handlers.onStop).toHaveBeenCalledOnce()
    bar.setBusy(false)
    expect(stop.hidden).toBe(true)
  })

  it('setProgress and setBusy update the bar', () => {
    const store = new SelectionStore()
    const bar = mountActionBar({ store, t, handlers: noop })
    bar.setProgress('Deleting 1 / 3…')
    expect(document.querySelector('[data-nlk="bar-progress"]')!.textContent).toBe('Deleting 1 / 3…')
    bar.setBusy(true)
    expect(document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.disabled).toBe(true)
    bar.destroy()
    expect(document.querySelector('[data-nlk="action-bar"]')).toBeNull()
  })

  it('uses the injected count callback instead of store.size', () => {
    const store = new SelectionStore()
    store.replaceAll(['a', 'b', 'c']) // store.size = 3
    let visible = 1
    mountActionBar({ store, t, handlers: noop, count: () => visible })
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('1')
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).not.toContain('3')
    const del = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!
    expect(del.textContent).toContain('1')
    expect(del.disabled).toBe(false)
  })

  it('refresh() re-evaluates the count callback', () => {
    const store = new SelectionStore()
    store.replaceAll(['a', 'b'])
    let visible = 2
    const bar = mountActionBar({ store, t, handlers: noop, count: () => visible })
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('2')
    visible = 0
    bar.refresh()
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('0')
    expect(document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.disabled).toBe(true)
  })

  // issue #72: refresh() は一覧 observer の tick ごとに呼ばれる。値が変わっていなければ DOM を書き換えない
  // （将来 mount 先が監視対象に入っても自己発火ループにならないための冪等性）。
  it('does not touch the DOM on refresh() when nothing changed', () => {
    const store = new SelectionStore()
    store.replaceAll(['a'])
    const bar = mountActionBar({ store, t, handlers: noop })
    const el = document.querySelector('[data-nlk="action-bar"]')!
    const mo = new MutationObserver(() => {})
    mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true })
    bar.refresh()
    bar.refresh()
    expect(mo.takeRecords()).toEqual([])
    mo.disconnect()
  })

  it('still re-renders on refresh() when the injected count changed', () => {
    const store = new SelectionStore()
    let n = 1
    const bar = mountActionBar({ store, t, handlers: noop, count: () => n })
    n = 3
    bar.refresh()
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('3')
    expect(document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.disabled).toBe(false)
  })

  it('re-renders when busy toggles even if the count is unchanged', () => {
    const store = new SelectionStore()
    store.replaceAll(['a'])
    const bar = mountActionBar({ store, t, handlers: noop })
    const del = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!
    bar.setBusy(true)
    expect(del.hidden).toBe(true)
    bar.setBusy(false)
    expect(del.hidden).toBe(false)
    expect(del.disabled).toBe(false)
  })
})
