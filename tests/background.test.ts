import { describe, it, expect } from 'vitest'
import { toImportableTabs } from '../src/background/main'

describe('toImportableTabs', () => {
  it('keeps only http/https tabs and drops NotebookLM itself', () => {
    const tabs = [
      { title: 'A', url: 'https://a.example/' },
      { title: 'Ext', url: 'chrome://extensions/' },
      { title: 'NLM', url: 'https://notebooklm.google.com/notebook/x' },
      { title: 'B', url: 'http://b.example/' },
      { title: 'NoUrl' },
      { title: 'Broken', url: '::::' },
    ]
    expect(toImportableTabs(tabs)).toEqual([
      { title: 'A', url: 'https://a.example/' },
      { title: 'B', url: 'http://b.example/' },
    ])
  })

  it('defaults missing titles to empty string', () => {
    expect(toImportableTabs([{ url: 'https://a.example/' }])).toEqual([
      { title: '', url: 'https://a.example/' },
    ])
  })
})
