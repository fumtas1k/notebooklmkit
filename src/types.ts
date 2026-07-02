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
