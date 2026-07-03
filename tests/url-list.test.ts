import { describe, it, expect } from 'vitest'
import { parseUrlList } from '../src/content/url-list'

describe('parseUrlList', () => {
  it('splits by newlines and whitespace, trimming empties', () => {
    const r = parseUrlList('https://a.example/\n  https://b.example/x \n\n https://c.example ')
    expect(r.valid).toEqual(['https://a.example/', 'https://b.example/x', 'https://c.example'])
    expect(r.invalid).toEqual([])
  })

  it('accepts only http/https URLs and routes the rest to invalid', () => {
    const r = parseUrlList('https://ok.example\nftp://ng.example\nchrome://settings\nnot-a-url')
    expect(r.valid).toEqual(['https://ok.example'])
    expect(r.invalid).toEqual(['ftp://ng.example', 'chrome://settings', 'not-a-url'])
  })

  it('dedupes valid URLs preserving first-occurrence order', () => {
    const r = parseUrlList('https://a.example\nhttps://b.example\nhttps://a.example')
    expect(r.valid).toEqual(['https://a.example', 'https://b.example'])
  })

  it('returns empty arrays for empty/whitespace-only input', () => {
    expect(parseUrlList('')).toEqual({ valid: [], invalid: [] })
    expect(parseUrlList('  \n \n')).toEqual({ valid: [], invalid: [] })
  })
})
