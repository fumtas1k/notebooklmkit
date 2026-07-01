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
})
