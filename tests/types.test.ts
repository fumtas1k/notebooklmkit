import { describe, it, expect } from 'vitest'
import { makeTarget } from '../src/types'
import { CREATE_RESULT_MESSAGE, PENDING_TTL_MS } from '../src/types'

describe('makeTarget', () => {
  it('derives a title-based key', () => {
    expect(makeTarget({ title: 'A' }).key).toBe('title:A')
  })
  it('distinct titles produce distinct keys', () => {
    expect(makeTarget({ title: 'A' }).key).not.toBe(makeTarget({ title: 'B' }).key)
  })
})

describe('f2-2 clip constants', () => {
  it('defines the create-result message type and ttl', () => {
    expect(CREATE_RESULT_MESSAGE).toBe('nlk:create-result')
    expect(PENDING_TTL_MS).toBe(60000)
  })
})
