export interface RowIdentity {
  title: string
}

export interface NotebookTarget extends RowIdentity {
  key: string
}

export interface DeleteProgress {
  total: number
  completed: number
  failed: number
  currentTitle?: string
}

export interface DeleteResult {
  succeeded: string[]
  failed: { key: string; reason: string }[]
  aborted: boolean
}

// キーはタイトル。NotebookLM の行 `jslog` は全行で同一の汎用トラッキング記述子
// （行ごとに一意でない）ため、識別子として使えない。実機確認済み（2026-07-02）。
// 同名ノートブックは区別できないが実運用ではほぼ一意（既知エッジケース）。
export function makeTarget(id: RowIdentity): NotebookTarget {
  return { ...id, key: `title:${id.title}` }
}

export interface ImportProgress {
  total: number
  completed: number
  failed: number
  currentUrl?: string
}

export interface ImportResult {
  succeeded: string[]
  failed: { url: string; reason: string }[]
  aborted: boolean
}

// background の chrome.tabs.query 結果から content に渡すタブ情報。
export interface TabInfo {
  title: string
  url: string
}

// content ↔ background 間の「タブ一覧をくれ」メッセージ種別。
export const LIST_TABS_MESSAGE = 'nlk:list-tabs'

// F2-2（現ページから新規ノートブック作成）: 実行待ちの URL 群（storage.local）。
// 実行後クリア＋ts 古さガードで残留を無視する。
// tabId はクリック元タブ（バッジ表示先）。tab.id 欠落時は undefined。
export interface PendingCreate {
  urls: string[]
  ts: number
  tabId?: number
}

// content → background: 新規ノートブック作成の結果（バッジ更新用）。
export const CREATE_RESULT_MESSAGE = 'nlk:create-result'

// 隔離ワールド content → 主ワールド content の「このタイルを実クリックして」ブリッジ。
// Angular Material の音声解説生成タイル（div[role=button]）は、隔離ワールド由来の合成イベントに
// 反応しない（主ワールドの instanceof 判定等に落ちる）。そのためページと同一の主ワールドで動く
// content script（world: 'MAIN'）に postMessage して実ポインタ列でクリックさせる（§8.7・2026-07-04 実機確認）。
export const MAIN_WORLD_CLICK_MESSAGE = 'nlk:click-main-world'
// 主ワールド側がクリック対象を一意に特定するための一時マーカー属性（クリック後に除去）。
// getAudioOverviewButton の [data-nlk] 除外にはかからない別属性名。
export const CLICK_TARGET_ATTR = 'data-nlk-click-target'
// pendingCreate の有効期限（ms）。超過分は実行せず掃除する。
export const PENDING_TTL_MS = 60000
