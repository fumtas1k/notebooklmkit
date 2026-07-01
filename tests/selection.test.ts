import { describe, it, expect, vi } from 'vitest'
import { SelectionStore } from '../src/content/selection'

describe('SelectionStore', () => {
  it('toggles and reports membership and size', () => {
    const s = new SelectionStore()
    s.toggle('a'); s.toggle('b'); s.toggle('a')
    expect(s.has('a')).toBe(false)
    expect(s.has('b')).toBe(true)
    expect(s.size).toBe(1)
    expect(s.keys()).toEqual(['b'])
  })

  it('set on/off explicitly', () => {
    const s = new SelectionStore()
    s.set('a', true); s.set('a', true); s.set('b', false)
    expect(s.size).toBe(1)
    s.set('a', false)
    expect(s.size).toBe(0)
  })

  it('replaceAll replaces the selection (select-all)', () => {
    const s = new SelectionStore()
    s.toggle('x')
    s.replaceAll(['a', 'b', 'c'])
    expect(s.size).toBe(3)
    expect(s.has('x')).toBe(false)
  })

  it('clear empties selection', () => {
    const s = new SelectionStore()
    s.replaceAll(['a', 'b'])
    s.clear()
    expect(s.size).toBe(0)
  })

  it('notifies subscribers with new size and can unsubscribe', () => {
    const s = new SelectionStore()
    const cb = vi.fn()
    const off = s.onChange(cb)
    s.toggle('a')
    expect(cb).toHaveBeenLastCalledWith(1)
    off()
    s.toggle('b')
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
