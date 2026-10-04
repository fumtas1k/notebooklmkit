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

  // 失敗による停止は、利用者が止めたとき（「中断しました」/ "Stopped:"）と書き出しで区別できること。
  it('words a failure stop differently from a user abort, for delete and import', () => {
    for (const lang of ['en', 'ja'] as const) {
      const t = createT(lang)
      const vars = { ok: 1, ng: 1, rest: 2 }
      const head = (s: string) => s.split(':')[0]
      expect(head(t('failedSummary', vars))).not.toBe(head(t('abortedSummary', vars)))
      expect(head(t('importFailedSummary', vars))).not.toBe(head(t('importAborted', vars)))
      expect(head(t('importFailedSummary', vars))).toBe(head(t('failedSummary', vars)))
    }
    expect(createT('ja')('importFailedSummary', { ok: 1, ng: 1, rest: 2 }))
      .toBe('失敗のため停止: 成功 1件 / 失敗 1件 / 残り 2件は未処理')
  })

  it('formats the delete failed summary in both languages (issue #99)', () => {
    const vars = { ok: 0, ng: 1, rest: 19 }
    expect(createT('en')('failedSummary', vars)).toBe('Stopped on failure: 0 deleted / 1 failed / 19 not processed')
    expect(createT('ja')('failedSummary', vars)).toBe('失敗のため停止: 成功 0件 / 失敗 1件 / 残り 19件は未処理')
  })

  it('formats the batch import progress in both languages', () => {
    expect(createT('en')('importBatchProgress', { count: 5 })).toBe('Adding 5 URLs at once…')
    expect(createT('ja')('importBatchProgress', { count: 5 })).toBe('5 件を一括追加中…')
  })
})
