import { LIST_TABS_MESSAGE, type TabInfo } from '../types'

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
