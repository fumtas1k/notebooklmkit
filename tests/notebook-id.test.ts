import { describe, it, expect } from 'vitest'
import { parseNotebookId, parseNotebookTitle } from '../src/content/notebook-id'

describe('parseNotebookId', () => {
  it('extracts the id from a /notebook/<id> path', () => {
    expect(parseNotebookId('/notebook/abc-123')).toBe('abc-123')
  })
  it('extracts the id when trailing segments/query exist', () => {
    expect(parseNotebookId('/notebook/abc-123/foo')).toBe('abc-123')
  })
  it('returns null for non-notebook paths', () => {
    expect(parseNotebookId('/')).toBeNull()
    expect(parseNotebookId('/notebook')).toBeNull()
    expect(parseNotebookId('/notebook/')).toBeNull()
    expect(parseNotebookId('/projects/abc')).toBeNull()
  })
})

describe('parseNotebookTitle', () => {
  it('strips the " - NotebookLM" suffix', () => {
    expect(parseNotebookTitle('Web標準動向 2026年6月版 - NotebookLM')).toBe('Web標準動向 2026年6月版')
  })
  it('returns the trimmed title when no suffix', () => {
    expect(parseNotebookTitle('  My Notebook  ')).toBe('My Notebook')
  })
  it('returns empty string for empty title', () => {
    expect(parseNotebookTitle('')).toBe('')
  })
})
