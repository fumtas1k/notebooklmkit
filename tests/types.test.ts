import { describe, it, expect } from 'vitest'
import { makeTarget } from '../src/types'
import { CREATE_RESULT_MESSAGE, PENDING_TTL_MS, SUPPORTED_HOSTS, isSupportedHost } from '../src/types'

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

describe('isSupportedHost', () => {
  it('accepts the current domain (notebook.google.com)', () => {
    expect(isSupportedHost('notebook.google.com')).toBe(true)
  })
  it('accepts the legacy domain (notebooklm.google.com)', () => {
    expect(isSupportedHost('notebooklm.google.com')).toBe(true)
  })
  it('rejects other hosts, including lookalikes', () => {
    expect(isSupportedHost('example.com')).toBe(false)
    expect(isSupportedHost('notebook.google.com.evil.test')).toBe(false)
    expect(isSupportedHost('evil-notebook.google.com')).toBe(false)
    expect(isSupportedHost('')).toBe(false)
  })
  it('lists the current domain first (used for the home URL)', () => {
    expect(SUPPORTED_HOSTS[0]).toBe('notebook.google.com')
    expect([...SUPPORTED_HOSTS]).toEqual(['notebook.google.com', 'notebooklm.google.com'])
  })
})
