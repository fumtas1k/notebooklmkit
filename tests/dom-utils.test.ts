import { describe, it, expect, vi, afterEach } from 'vitest'
import { waitFor, safeClick, delay, TimeoutError, AbortError } from '../src/content/dom-utils'

afterEach(() => {
  vi.useRealTimers()
})

describe('waitFor', () => {
  it('resolves as soon as fn returns truthy', async () => {
    let n = 0
    const v = await waitFor(() => (++n >= 3 ? 'ok' : null), { interval: 1, timeout: 1000 })
    expect(v).toBe('ok')
  })

  it('rejects with TimeoutError when never truthy', async () => {
    await expect(waitFor(() => null, { interval: 1, timeout: 20 })).rejects.toBeInstanceOf(TimeoutError)
  })

  it('rejects with AbortError when signal aborts', async () => {
    const ac = new AbortController()
    const p = waitFor(() => null, { interval: 5, timeout: 1000, signal: ac.signal })
    ac.abort()
    await expect(p).rejects.toBeInstanceOf(AbortError)
  })
})

describe('safeClick', () => {
  it('clicks and returns true for an element', () => {
    const btn = document.createElement('button')
    const spy = vi.fn()
    btn.addEventListener('click', spy)
    expect(safeClick(btn)).toBe(true)
    expect(spy).toHaveBeenCalledOnce()
  })
  it('returns false for null', () => {
    expect(safeClick(null)).toBe(false)
  })
})

describe('delay', () => {
  it('rejects immediately if already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(delay(10, ac.signal)).rejects.toBeInstanceOf(AbortError)
  })
})
