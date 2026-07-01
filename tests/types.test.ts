import { describe, it, expect } from 'vitest'
import { makeTarget } from '../src/types'

describe('makeTarget', () => {
  it('derives a title-based key', () => {
    expect(makeTarget({ title: 'A' }).key).toBe('title:A')
  })
  it('distinct titles produce distinct keys', () => {
    expect(makeTarget({ title: 'A' }).key).not.toBe(makeTarget({ title: 'B' }).key)
  })
})
