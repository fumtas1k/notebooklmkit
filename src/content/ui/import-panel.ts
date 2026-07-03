import type { createT } from '../i18n'
import type { TabInfo } from '../../types'
import { parseUrlList } from '../url-list'
import './import-panel.css'

export interface ImportPanelHandlers {
  onImport(urls: string[]): void
  onStop(): void
  onLoadTabs(): Promise<TabInfo[]>
}

// ノートブックページ右下のフローティングボタン + インポートパネル。
// ノートブックページ自体の DOM 構造には依存せず、document.body 直下に固定配置する。
export function mountImportPanel(opts: {
  t: ReturnType<typeof createT>
  handlers: ImportPanelHandlers
  root?: HTMLElement
}) {
  const { t, handlers, root = document.body } = opts

  const host = document.createElement('div')
  host.className = 'nlk-import'
  host.setAttribute('data-nlk', 'import-host')

  const fab = document.createElement('button')
  fab.type = 'button'
  fab.className = 'nlk-import-fab'
  fab.setAttribute('data-nlk', 'import-fab')
  fab.textContent = t('importFab')
  fab.setAttribute('aria-controls', 'nlk-import-panel')
  fab.setAttribute('aria-expanded', 'false')

  const panel = document.createElement('div')
  panel.id = 'nlk-import-panel'
  panel.className = 'nlk-import-panel'
  panel.setAttribute('data-nlk', 'import-panel')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-label', t('importTitle'))
  panel.hidden = true

  const title = document.createElement('div')
  title.className = 'nlk-import-title'
  title.textContent = t('importTitle')

  const textarea = document.createElement('textarea')
  textarea.setAttribute('data-nlk', 'import-urls')
  textarea.placeholder = t('importPlaceholder')
  textarea.rows = 6

  const counts = document.createElement('div')
  counts.setAttribute('data-nlk', 'import-counts')

  const loadTabsBtn = document.createElement('button')
  loadTabsBtn.type = 'button'
  loadTabsBtn.setAttribute('data-nlk', 'import-load-tabs')
  loadTabsBtn.textContent = t('loadTabs')

  const tabList = document.createElement('div')
  tabList.className = 'nlk-import-tab-list'
  tabList.setAttribute('data-nlk', 'import-tab-list')
  tabList.hidden = true

  const addTabsBtn = document.createElement('button')
  addTabsBtn.type = 'button'
  addTabsBtn.setAttribute('data-nlk', 'import-add-tabs')
  addTabsBtn.textContent = t('addSelectedTabs')
  addTabsBtn.hidden = true

  const progress = document.createElement('div')
  progress.setAttribute('data-nlk', 'import-progress')

  const runBtn = document.createElement('button')
  runBtn.type = 'button'
  runBtn.setAttribute('data-nlk', 'import-run')

  const stopBtn = document.createElement('button')
  stopBtn.type = 'button'
  stopBtn.setAttribute('data-nlk', 'import-stop')
  stopBtn.textContent = t('abort')
  stopBtn.hidden = true

  panel.append(title, textarea, counts, loadTabsBtn, tabList, addTabsBtn, progress, runBtn, stopBtn)
  host.append(panel, fab)
  root.appendChild(host)

  let busy = false

  const render = () => {
    const { valid, invalid } = parseUrlList(textarea.value)
    counts.textContent = t('urlCounts', { valid: valid.length, invalid: invalid.length })
    runBtn.textContent = t('importRun', { count: valid.length })
    runBtn.disabled = busy || valid.length === 0
    runBtn.hidden = busy
    stopBtn.hidden = !busy
    textarea.disabled = busy
    loadTabsBtn.disabled = busy
    addTabsBtn.disabled = busy
  }

  const setOpen = (open: boolean) => {
    panel.hidden = !open
    fab.setAttribute('aria-expanded', String(open))
    if (open) textarea.focus()
  }

  fab.addEventListener('click', () => setOpen(panel.hidden))
  // キーボード操作対応（Escape で閉じて FAB へフォーカスを戻す）
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { setOpen(false); fab.focus() }
  })
  textarea.addEventListener('input', render)
  runBtn.addEventListener('click', () => {
    if (busy) return
    const { valid } = parseUrlList(textarea.value)
    if (valid.length === 0) return
    handlers.onImport(valid)
  })
  stopBtn.addEventListener('click', () => handlers.onStop())

  loadTabsBtn.addEventListener('click', () => {
    void (async () => {
      tabList.hidden = false
      tabList.textContent = ''
      addTabsBtn.hidden = true
      try {
        const tabs = await handlers.onLoadTabs()
        if (tabs.length === 0) {
          tabList.textContent = t('noTabs')
          return
        }
        for (const tab of tabs) {
          const label = document.createElement('label')
          label.setAttribute('data-nlk', 'import-tab-item')
          const check = document.createElement('input')
          check.type = 'checkbox'
          check.checked = true
          check.setAttribute('data-nlk', 'import-tab-check')
          check.dataset.url = tab.url
          const text = document.createElement('span')
          text.textContent = tab.title || tab.url
          text.title = tab.url
          label.append(check, text)
          tabList.appendChild(label)
        }
        addTabsBtn.hidden = false
      } catch {
        // background 不通など。パネルは壊さずメッセージだけ出す。
        tabList.textContent = t('tabsError')
      }
    })()
  })

  addTabsBtn.addEventListener('click', () => {
    const urls = Array.from(
      tabList.querySelectorAll<HTMLInputElement>('[data-nlk="import-tab-check"]'),
    )
      .filter((c) => c.checked)
      .map((c) => c.dataset.url ?? '')
      .filter(Boolean)
    if (urls.length === 0) return
    const sep = textarea.value.trim() === '' ? '' : '\n'
    textarea.value = textarea.value.trimEnd() + sep + urls.join('\n') + '\n'
    render()
  })

  render()

  return {
    setBusy(b: boolean) {
      busy = b
      render()
    },
    setProgress(text: string | null) {
      progress.textContent = text ?? ''
    },
    // 成功した URL の行を textarea から取り除く（失敗・未処理分が残りリトライしやすい）。
    // 1行に複数 URL を書いた行は対象外（行単位マッチのみ）。
    removeUrls(urls: string[]) {
      const remove = new Set(urls)
      textarea.value = textarea.value
        .split(/\r?\n/)
        .filter((line) => !remove.has(line.trim()))
        .join('\n')
      render()
    },
    destroy() {
      host.remove()
    },
  }
}
