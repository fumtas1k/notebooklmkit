import { describe, it, expect } from 'vitest'
import { makeTarget } from '../src/types'
import {
  RUN_PENDING_MESSAGE, IMPORT_RESULT_MESSAGE, PENDING_TTL_MS,
} from '../src/types'

describe('makeTarget', () => {
  it('derives a title-based key', () => {
    expect(makeTarget({ title: 'A' }).key).toBe('title:A')
  })
  it('distinct titles produce distinct keys', () => {
    expect(makeTarget({ title: 'A' }).key).not.toBe(makeTarget({ title: 'B' }).key)
  })
})

describe('f2-2 constants', () => {
  it('defines message types and ttl', () => {
    expect(RUN_PENDING_MESSAGE).toBe('nlk:run-pending')
    expect(IMPORT_RESULT_MESSAGE).toBe('nlk:import-result')
    expect(PENDING_TTL_MS).toBe(60000)
  })
})
