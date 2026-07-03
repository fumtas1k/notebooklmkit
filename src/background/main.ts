import {
  LIST_TABS_MESSAGE, RUN_PENDING_MESSAGE, IMPORT_RESULT_MESSAGE, type TabInfo, type PendingImport,
} from '../types'
import { parseNotebookId } from '../content/notebook-id'

// chrome.tabs.query の結果からインポート候補になるタブだけを残す純関数。
// http/https 以外（chrome:// 等）はソースにできず、NotebookLM 自身のタブも対象外。
export function toImportableTabs(tabs: { title?: string; url?: string }[]): TabInfo[] {
  const out: TabInfo[] = []
  for (const t of tabs) {
    if (!t.url) continue
    let u: URL
    try {
      u = new URL(t.url)
    } catch {
      continue
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
    if (u.hostname === 'notebooklm.google.com') continue
    out.push({ title: t.title ?? '', url: t.url })
  }
  return out
}

// service worker として読み込まれたときだけリスナー登録。
// テスト（jsdom）には chrome が無いため、import しても副作用は無い。
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse): boolean => {
    if ((message as { type?: string } | null)?.type !== LIST_TABS_MESSAGE) return false
    // 多層防御: 自拡張以外からのメッセージには応答しない（externally_connectable
    // 未宣言の現構成では他所から届かないはずだが、将来の設定変更に備える）
    if (sender.id !== chrome.runtime.id) return false
    // 要求元（NotebookLM タブ）と同じウィンドウのタブを返す
    const windowId = sender.tab?.windowId
    // sender.tab が無い場合（popup などタブ以外のコンテキストからのメッセージ時）は現在のウィンドウにフォールバック
    const query = windowId !== undefined ? { windowId } : { currentWindow: true }
    chrome.tabs.query(query, (tabs) => sendResponse({ tabs: toImportableTabs(tabs) }))
    return true // sendResponse を非同期で呼ぶためチャネルを開いたままにする
  })
}

export const NOTEBOOK_HOME = 'https://notebooklm.google.com/'
export function notebookUrl(id: string): string {
  return `${NOTEBOOK_HOME}notebook/${id}`
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface ActionDeps {
  storageGet(key: string): Promise<Record<string, unknown>>
  storageSet(items: Record<string, unknown>): Promise<void>
  queryTabs(query: { url: string }): Promise<{ id?: number; url?: string }[]>
  createTab(props: { url: string; active: boolean }): Promise<unknown>
  sendTabMessage(tabId: number, message: unknown): Promise<void>
  setBadge(text: string): void
  now(): number
}

// ツールバーアイコンのクリック本体。現在ページ URL を、最後に開いたノートブックへ
// ソース追加するためのオーケストレーション（storage / tabs / messaging）を行う。
export async function handleActionClick(clickedUrl: string | undefined, d: ActionDeps): Promise<void> {
  if (!clickedUrl || !isHttpUrl(clickedUrl)) {
    d.setBadge('!')
    return
  }
  const got = await d.storageGet('lastNotebook')
  const last = got.lastNotebook as { id: string; title: string } | undefined
  if (!last) {
    // 対象が無い: NotebookLM を開いて「先に開いて」を促す
    await d.createTab({ url: NOTEBOOK_HOME, active: true })
    d.setBadge('!')
    return
  }
  const id = last.id
  const pending: PendingImport = { notebookId: id, url: clickedUrl, ts: d.now() }
  await d.storageSet({ pendingImport: pending })
  d.setBadge('…')

  const tabs = await d.queryTabs({ url: `${NOTEBOOK_HOME}*` })
  const existing = tabs.find((t) => {
    if (t.id === undefined || !t.url) return false
    try {
      return parseNotebookId(new URL(t.url).pathname) === id
    } catch {
      return false
    }
  })
  if (existing?.id !== undefined) {
    await d.sendTabMessage(existing.id, { type: RUN_PENDING_MESSAGE })
  } else {
    await d.createTab({ url: notebookUrl(id), active: false })
  }
}

// content からのインポート結果でバッジを更新する。
export function handleImportResult(ok: boolean, d: Pick<ActionDeps, 'setBadge'>): void {
  d.setBadge(ok ? '✓' : '!')
}

// 実 chrome への配線（薄いグルー・非テスト）。chrome.action が無い環境（テスト/一部 SW）では登録しない。
// chrome は @types/chrome のグローバル型を使う（既存 nlk:list-tabs ブロックと同じ）。declare は追加しない。
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  const clearLater = (t: string) => {
    if (t === '✓' || t === '!') setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000)
  }
  const deps: ActionDeps = {
    storageGet: (k) => chrome.storage.local.get(k),
    storageSet: (i) => chrome.storage.local.set(i),
    queryTabs: (q) => chrome.tabs.query(q),
    createTab: (p) => chrome.tabs.create(p),
    sendTabMessage: (id, m) => chrome.tabs.sendMessage(id, m),
    setBadge: (text) => { void chrome.action.setBadgeText({ text }); clearLater(text) },
    now: () => Date.now(),
  }
  chrome.action.onClicked.addListener((tab: { url?: string }) => { void handleActionClick(tab?.url, deps) })
  chrome.runtime.onMessage.addListener((msg: unknown, sender: { id?: string }) => {
    if (sender.id !== chrome.runtime.id) return
    const m = msg as { type?: string; ok?: boolean } | null
    if (m?.type === IMPORT_RESULT_MESSAGE) handleImportResult(!!m.ok, deps)
  })
}
