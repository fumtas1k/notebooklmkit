import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mountImportPanel, type ImportPanelHandlers } from '../src/content/ui/import-panel'
import { createT } from '../src/content/i18n'
import type { TabInfo } from '../src/types'

const flush = () => new Promise((r) => setTimeout(r, 0))
const q = <T extends HTMLElement>(nlk: string) =>
  document.querySelector<T>(`[data-nlk="${nlk}"]`)

function mount(over: Partial<ImportPanelHandlers> = {}, tabs: TabInfo[] = []) {
  const handlers: ImportPanelHandlers = {
    onImport: vi.fn(),
    onStop: vi.fn(),
    onLoadTabs: vi.fn().mockResolvedValue(tabs),
    ...over,
  }
  const api = mountImportPanel({ t: createT('en'), handlers })
  return { api, handlers }
}

function typeUrls(text: string) {
  const ta = q<HTMLTextAreaElement>('import-urls')!
  ta.value = text
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('mountImportPanel', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('mounts a fab and a hidden panel; fab toggles the panel', () => {
    mount()
    const panel = q('import-panel')!
    expect(q('import-fab')).not.toBeNull()
    expect(panel.hidden).toBe(true)
    q('import-fab')!.click()
    expect(panel.hidden).toBe(false)
    q('import-fab')!.click()
    expect(panel.hidden).toBe(true)
  })

  it('updates counts and the run button as urls are typed', () => {
    mount()
    const run = q<HTMLButtonElement>('import-run')!
    expect(run.disabled).toBe(true)
    typeUrls('https://a.example/\nnot-a-url')
    expect(q('import-counts')!.textContent).toContain('1')
    expect(run.disabled).toBe(false)
    expect(run.textContent).toContain('1')
  })

  it('calls onImport with parsed valid urls only', () => {
    const { handlers } = mount()
    typeUrls('https://a.example/\nhttps://a.example/\nbad')
    q('import-run')!.click()
    expect(handlers.onImport).toHaveBeenCalledWith(['https://a.example/'])
  })

  it('setBusy toggles run/stop and disables inputs; stop calls onStop', () => {
    const { api, handlers } = mount()
    typeUrls('https://a.example/')
    api.setBusy(true)
    expect(q<HTMLButtonElement>('import-run')!.hidden).toBe(true)
    expect(q<HTMLButtonElement>('import-stop')!.hidden).toBe(false)
    expect(q<HTMLTextAreaElement>('import-urls')!.disabled).toBe(true)
    q('import-stop')!.click()
    expect(handlers.onStop).toHaveBeenCalled()
    api.setBusy(false)
    expect(q<HTMLButtonElement>('import-run')!.hidden).toBe(false)
  })

  it('ignores run clicks while busy or with zero valid urls', () => {
    const { api, handlers } = mount()
    q('import-run')!.click() // 0件
    api.setBusy(true)
    typeUrls('https://a.example/')
    q('import-run')!.click() // busy
    expect(handlers.onImport).not.toHaveBeenCalled()
  })

  it('loads tabs into a checkbox list and appends only checked ones', async () => {
    mount({}, [
      { title: 'A', url: 'https://a.example/' },
      { title: 'B', url: 'https://b.example/' },
    ])
    q('import-load-tabs')!.click()
    await flush()
    const boxes = document.querySelectorAll<HTMLInputElement>('[data-nlk="import-tab-check"]')
    expect(boxes.length).toBe(2)
    boxes[1].checked = false
    q('import-add-tabs')!.click()
    expect(q<HTMLTextAreaElement>('import-urls')!.value).toContain('https://a.example/')
    expect(q<HTMLTextAreaElement>('import-urls')!.value).not.toContain('https://b.example/')
  })

  it('shows a message when there are no importable tabs', async () => {
    mount({}, [])
    q('import-load-tabs')!.click()
    await flush()
    expect(q('import-tab-list')!.textContent).toContain('No importable tabs')
    expect(q<HTMLButtonElement>('import-add-tabs')!.hidden).toBe(true)
  })

  it('shows an error when onLoadTabs rejects', async () => {
    mount({ onLoadTabs: vi.fn().mockRejectedValue(new Error('nope')) })
    q('import-load-tabs')!.click()
    await flush()
    expect(q('import-tab-list')!.textContent).toContain('Could not list open tabs')
  })

  it('setProgress and removeUrls update the panel', () => {
    const { api } = mount()
    api.setProgress('Importing 1 / 2…')
    expect(q('import-progress')!.textContent).toContain('1 / 2')
    typeUrls('https://a.example/\nhttps://b.example/')
    api.removeUrls(['https://a.example/'])
    const value = q<HTMLTextAreaElement>('import-urls')!.value
    expect(value).not.toContain('https://a.example/')
    expect(value).toContain('https://b.example/')
  })

  it('destroy removes everything', () => {
    const { api } = mount()
    api.destroy()
    expect(q('import-fab')).toBeNull()
    expect(q('import-panel')).toBeNull()
  })
})
