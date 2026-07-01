import { describe, it, expect } from 'vitest'
import { makeTarget } from '../src/types'

describe('makeTarget', () => {
  it('uses jslog as key when present', () => {
    expect(makeTarget({ title: 'A', jslog: 'id-1' }).key).toBe('id-1')
  })
  it('falls back to title when jslog is null', () => {
    expect(makeTarget({ title: 'A', jslog: null }).key).toBe('title:A')
  })
})
