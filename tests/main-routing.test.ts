import { describe, it, expect, beforeEach, vi } from 'vitest'
import { start, initImport, isNotebookPath } from '../src/content/main'
import { importUrls } from '../src/content/importer'

vi.mock('../src/content/importer', () => ({
  importUrls: vi.fn(),
}))

const LIST = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">A</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table></div>`

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('isNotebookPath', () => {
  it('detects notebook pages by pathname', () => {
    expect(isNotebookPath('/notebook/abc123')).toBe(true)
    expect(isNotebookPath('/')).toBe(false)
    expect(isNotebookPath('/settings')).toBe(false)
  })
})

describe('start routing', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('mounts the list UI on the projects page', () => {
    document.body.innerHTML = LIST
    const dispose = start(document, () => '/')
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
    expect(document.querySelector('[data-nlk="import-fab"]')).toBeNull()
    dispose()
  })

  it('mounts the import UI on a notebook page', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const dispose = start(document, () => '/notebook/abc123')
    expect(document.querySelector('[data-nlk="import-fab"]')).not.toBeNull()
    expect(document.querySelector('[data-nlk="action-bar"]')).toBeNull()
    dispose()
  })

  it('switches UIs when the SPA navigates list → notebook', async () => {
    document.body.innerHTML = LIST
    let path = '/'
    const dispose = start(document, () => path)
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
    path = '/notebook/abc'
    document.body.innerHTML = '<div id="app"></div>' // SPA 再描画で mutation 発火
    await flush()
    expect(document.querySelector('[data-nlk="action-bar"]')).toBeNull()
    expect(document.querySelector('[data-nlk="import-fab"]')).not.toBeNull()
    dispose()
  })

  it('dispose unmounts whichever UI is active', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const dispose = start(document, () => '/notebook/abc')
    dispose()
    expect(document.querySelector('[data-nlk="import-fab"]')).toBeNull()
  })
})

describe('initImport wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.mocked(importUrls).mockReset()
  })

  function typeAndRun(text: string) {
    const ta = document.querySelector<HTMLTextAreaElement>('[data-nlk="import-urls"]')!
    ta.value = text
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('[data-nlk="import-run"]')!.click()
  }

  it('runs importUrls with parsed urls and shows a summary', async () => {
    vi.mocked(importUrls).mockResolvedValue({
      succeeded: ['https://a.example/'],
      failed: [],
      aborted: false,
    })
    const dispose = initImport()
    typeAndRun('https://a.example/\nbad-url')
    await Promise.resolve()
    expect(importUrls).toHaveBeenCalledTimes(1)
    expect(vi.mocked(importUrls).mock.calls[0][0]).toEqual(['https://a.example/'])
    await new Promise((r) => setTimeout(r, 0))
    const progress = document.querySelector('[data-nlk="import-progress"]')!
    expect(progress.textContent).toContain('1')
    // 成功した URL は textarea から除去される
    const ta = document.querySelector<HTMLTextAreaElement>('[data-nlk="import-urls"]')!
    expect(ta.value).not.toContain('https://a.example/')
    dispose()
  })

  it('ignores a second run while one is in flight', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(importUrls).mockReturnValue(new Promise((r) => { resolve = r }) as never)
    const dispose = initImport()
    typeAndRun('https://a.example/')
    typeAndRun('https://a.example/')
    expect(importUrls).toHaveBeenCalledTimes(1)
    resolve({ succeeded: [], failed: [], aborted: false })
    await new Promise((r) => setTimeout(r, 0))
    dispose()
  })
})
