import { describe, it, expect } from 'vitest'
import { detectLang, createT } from '../src/content/i18n'

describe('i18n', () => {
  it('detects ja and en, defaults to en', () => {
    expect(detectLang({ language: 'ja-JP' })).toBe('ja')
    expect(detectLang({ language: 'en-US' })).toBe('en')
    expect(detectLang({ language: 'fr-FR' })).toBe('en')
  })

  it('interpolates variables', () => {
    const t = createT('ja')
    expect(t('deleteSelected', { count: 3 })).toContain('3')
    const te = createT('en')
    expect(te('deleteSelected', { count: 3 })).toContain('3')
  })

  it('interpolates multiple variables', () => {
    const t = createT('en')
    const s = t('progress', { done: 1, total: 3 })
    expect(s).toContain('1')
    expect(s).toContain('3')
  })

  it('falls back to the key when missing (never throws)', () => {
    const t = createT('en')
    // @ts-expect-error unknown key
    expect(t('nope')).toBe('nope')
  })

  it('has import messages in both languages', () => {
    const ja = createT('ja')
    const en = createT('en')
    expect(ja('importRun', { count: 3 })).toContain('3')
    expect(en('importRun', { count: 3 })).toContain('3')
    expect(ja('urlCounts', { valid: 2, invalid: 1 })).toContain('2')
    expect(en('importFailedSummary', { ok: 1, ng: 1, rest: 2 })).toContain('2')
  })
})
