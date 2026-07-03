import {
  LIST_TABS_MESSAGE, CREATE_RESULT_MESSAGE, type TabInfo, type PendingCreate,
} from '../types'

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

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface ClipDeps {
  storageSet(items: Record<string, unknown>): Promise<void>
  createTab(props: { url: string; active: boolean }): Promise<unknown>
  setBadge(text: string): void
  now(): number
}

// ツールバーアイコンのクリック本体。現ページ URL を pendingCreate に置き、
// NotebookLM ホームをフォアグラウンドで開く（content script が新規作成を実行）。
export async function handleClipClick(clickedUrl: string | undefined, d: ClipDeps): Promise<void> {
  if (!clickedUrl || !isHttpUrl(clickedUrl)) {
    d.setBadge('!')
    return
  }
  // storage/tabs は reject し得る。失敗しても badge '!' に帰着させ '…' 固着を防ぐ。
  try {
    const pending: PendingCreate = { urls: [clickedUrl], ts: d.now() }
    await d.storageSet({ pendingCreate: pending })
    d.setBadge('…')
    await d.createTab({ url: NOTEBOOK_HOME, active: true })
  } catch {
    d.setBadge('!')
  }
}

// content からの作成結果でバッジを更新する。
export function handleCreateResult(ok: boolean, d: Pick<ClipDeps, 'setBadge'>): void {
  d.setBadge(ok ? '✓' : '!')
}

// 実 chrome への配線（薄いグルー・非テスト）。chrome.action が無い環境では登録しない。
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  const clearLater = (t: string) => {
    if (t === '✓' || t === '!') setTimeout(() => chrome.action.setBadgeText({ text: '' }), 4000)
  }
  const deps: ClipDeps = {
    storageSet: (i) => chrome.storage.local.set(i),
    createTab: (p) => chrome.tabs.create(p),
    setBadge: (text) => { void chrome.action.setBadgeText({ text }); clearLater(text) },
    now: () => Date.now(),
  }
  chrome.action.onClicked.addListener((tab: { url?: string }) => { void handleClipClick(tab?.url, deps) })
  chrome.runtime.onMessage.addListener((msg: unknown, sender: { id?: string }) => {
    if (sender.id !== chrome.runtime.id) return
    const m = msg as { type?: string; ok?: boolean } | null
    if (m?.type === CREATE_RESULT_MESSAGE) handleCreateResult(!!m.ok, deps)
  })
}
