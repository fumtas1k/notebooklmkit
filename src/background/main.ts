import {
  LIST_TABS_MESSAGE, CREATE_RESULT_MESSAGE, MAIN_WORLD_CLICK_MESSAGE, CLICK_TARGET_ATTR,
  type TabInfo, type PendingCreate,
} from '../types'

// chrome.scripting.executeScript({ world: 'MAIN' }) で対象タブの主ワールドに注入して実行される
// 自己完結クリック関数。executeScript は関数ソースをシリアライズして注入するため、外部変数 / import を
// 参照できない（引数のみ渡せる）。マーカー属性 attr で対象要素を特定し、実ポインタ列を発火する。
// 隔離ワールド（通常の content script）の合成イベントは Angular Material の生成タイル（div[role=button]）に
// 効かず、CSP は chrome-extension: の script-src を許可しないため、CSP 免除の executeScript を使う（§8.7）。
// SW 上では呼ばれず（DOM 無し）、注入先の主ワールドでのみ実行される。
export function clickMarkedTargetInMainWorld(attr: string): void {
  const el = document.querySelector<HTMLElement>(`[${attr}]`)
  if (!el) return
  el.removeAttribute(attr)
  const r = el.getBoundingClientRect()
  const base = {
    bubbles: true, cancelable: true, composed: true, view: window, button: 0,
    clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
  }
  el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true }))
  el.dispatchEvent(new MouseEvent('mousedown', base))
  el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true }))
  el.dispatchEvent(new MouseEvent('mouseup', base))
  el.dispatchEvent(new MouseEvent('click', base))
}

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
  storageGet(key: string): Promise<Record<string, unknown>>
  storageRemove(key: string): Promise<void>
  createTab(props: { url: string; active: boolean }): Promise<unknown>
  setBadge(text: string, tabId?: number): void
  now(): number
}

// ツールバーアイコンのクリック本体。現ページ URL を pendingCreate に置き、
// NotebookLM ホームを active:false でバックグラウンドに開く（content script が
// 新規作成を実行）。元タブをアクティブのまま保つため（#50）。バッジは元タブ X に
// スコープするので（#47）、元タブがアクティブのまま '…'→'✓'/'!' がそのまま見える。
export async function handleClipClick(
  clickedUrl: string | undefined,
  tabId: number | undefined,
  d: ClipDeps,
): Promise<void> {
  if (!clickedUrl || !isHttpUrl(clickedUrl)) {
    d.setBadge('!', tabId)
    return
  }
  // storage/tabs は reject し得る。失敗しても badge '!' に帰着させ '…' 固着を防ぐ。
  try {
    const pending: PendingCreate = { urls: [clickedUrl], ts: d.now(), tabId }
    await d.storageSet({ pendingCreate: pending })
    d.setBadge('…', tabId)
    await d.createTab({ url: NOTEBOOK_HOME, active: false })
  } catch {
    // M-1: storageSet 後に createTab が失敗すると pendingCreate が残留し、後で
    // 手動で NotebookLM を開いた際に意図しない自動作成を招く。二重障害でも
    // ここは投げずに badge '!' へ帰着させる。
    await d.storageRemove('pendingCreate').catch(() => {})
    d.setBadge('!', tabId)
  }
}

// content からの作成結果でバッジを更新する（元タブにスコープ）。
export function handleCreateResult(ok: boolean, tabId: number | undefined, d: Pick<ClipDeps, 'setBadge'>): void {
  d.setBadge(ok ? '✓' : '!', tabId)
}

// I-1: content script が nlk:create-result を返せない経路（未ログインで
// notebooklm→accounts にリダイレクトし content script が走らない／タブを
// 閉じる／ネットワーク断）でバッジが '…' のまま固着するのを防ぐウォッチドッグ。
// TTL 経過後も pendingCreate が残っている（＝content が実行前クリアしていない
// ＝フローが走らなかった）場合のみ badge '!' にして掃除する。正常フローでは
// content が先にクリアしているため no-op になる。
export async function resetStuckClip(
  d: Pick<ClipDeps, 'storageGet' | 'storageRemove' | 'setBadge'>,
): Promise<void> {
  const got = await d.storageGet('pendingCreate')
  const pending = got.pendingCreate as PendingCreate | undefined
  if (pending === undefined) return
  d.setBadge('!', pending.tabId)
  await d.storageRemove('pendingCreate')
}

// 実 chrome への配線（薄いグルー・非テスト）。chrome.action が無い環境では登録しない。
if (typeof chrome !== 'undefined' && chrome.action?.onClicked) {
  const STUCK_ALARM = 'nlk-reset-stuck'
  const clearLater = (t: string, tabId?: number) => {
    if (t === '✓' || t === '!') {
      setTimeout(() => {
        chrome.action.setBadgeText(tabId !== undefined ? { text: '', tabId } : { text: '' }).catch(() => {})
      }, 4000)
    }
  }
  const deps: ClipDeps = {
    storageSet: (i) => chrome.storage.local.set(i),
    storageGet: (k) => chrome.storage.local.get(k),
    storageRemove: (k) => chrome.storage.local.remove(k),
    createTab: (p) => chrome.tabs.create(p),
    setBadge: (text, tabId) => {
      chrome.action.setBadgeText(tabId !== undefined ? { text, tabId } : { text }).catch(() => {})
      clearLater(text, tabId)
    },
    now: () => Date.now(),
  }
  chrome.action.onClicked.addListener((tab: { id?: number; url?: string }) => {
    void handleClipClick(tab?.url, tab?.id, deps)
    // I-1: バッジ '…' 固着ウォッチドッグ。MV3 の SW はアイドルで終了され得るため
    // setTimeout ではなく chrome.alarms を使う（SW 終了後も再起動して発火する）。
    // 正常フローでは content が pendingCreate を実行前クリアするため resetStuckClip は no-op。
    chrome.alarms.create(STUCK_ALARM, { delayInMinutes: 1 })
  })
  chrome.alarms.onAlarm.addListener((alarm: { name?: string }) => {
    if (alarm.name === STUCK_ALARM) void resetStuckClip(deps)
  })
  chrome.runtime.onMessage.addListener((msg: unknown, sender: { id?: string; tab?: { id?: number } }) => {
    if (sender.id !== chrome.runtime.id) return
    const m = msg as { type?: string; ok?: boolean; tabId?: number } | null
    if (m?.type === CREATE_RESULT_MESSAGE) handleCreateResult(!!m.ok, m.tabId, deps)
    // F2-2: 音声解説タイルを送信元タブの主ワールドで実クリックする（§8.7）。
    if (m?.type === MAIN_WORLD_CLICK_MESSAGE && sender.tab?.id !== undefined) {
      chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: clickMarkedTargetInMainWorld,
        args: [CLICK_TARGET_ATTR],
      }).catch(() => {})
    }
  })
}
