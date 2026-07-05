export type Lang = 'ja' | 'en'

const EN = {
  selectAll: 'Select all',
  deselectAll: 'Clear all',
  selectedCount: '{count} selected',
  deleteSelected: 'Delete {count} selected',
  confirmTitle: 'Delete {count} notebook(s)',
  confirmBody: 'This action cannot be undone.',
  confirmType: 'Type {count} to confirm',
  cancel: 'Cancel',
  deleteNow: 'Delete',
  progress: 'Deleting {done} / {total}…',
  doneSummary: 'Done: {ok} succeeded / {ng} failed',
  abortedSummary: 'Stopped: {ok} deleted / {rest} not processed',
  abort: 'Stop',
  domError: 'Stopped: NotebookLM UI structure did not match expectations',
  selectionChanged: 'Cancelled: the selection changed while the confirmation dialog was open',
  importFab: 'Import URLs',
  importTitle: 'Bulk import URLs / tabs',
  importPlaceholder: 'Paste URLs, one per line',
  loadTabs: 'Load open tabs',
  addSelectedTabs: 'Add selected tabs',
  noTabs: 'No importable tabs',
  tabsError: 'Could not list open tabs',
  tabSelectionCounts: 'Selected {selected} / {total}',
  urlCounts: '{valid} valid / {invalid} invalid',
  importRun: 'Import {count}',
  importProgress: 'Importing {done} / {total}…',
  importBatchProgress: 'Adding {count} URLs at once…',
  importDone: 'Done: {ok} imported / {ng} failed',
  importFailedSummary: 'Stopped: {ok} imported / {ng} failed / {rest} not processed',
  importAborted: 'Stopped: {ok} imported / {rest} not processed',
} as const

export type MsgKey = keyof typeof EN

const MESSAGES: Record<Lang, Record<MsgKey, string>> = {
  en: EN,
  ja: {
    selectAll: 'すべて選択',
    deselectAll: 'すべて解除',
    selectedCount: '{count}件選択中',
    deleteSelected: '選択した{count}件を削除',
    confirmTitle: '{count}件のノートブックを削除します',
    confirmBody: 'この操作は取り消せません。',
    confirmType: '確認のため {count} と入力してください',
    cancel: 'キャンセル',
    deleteNow: '削除',
    progress: '{done} / {total} 削除中…',
    doneSummary: '完了: 成功 {ok}件 / 失敗 {ng}件',
    abortedSummary: '中断しました: 成功 {ok}件 / 残り {rest}件は未処理',
    abort: '中断',
    domError: 'NotebookLM の画面構造が想定と異なるため中断しました',
    selectionChanged: '確認ダイアログ表示中に選択が変更されたため中止しました',
    importFab: 'URLをインポート',
    importTitle: 'URL / タブの一括インポート',
    importPlaceholder: 'URL を1行に1件ずつ貼り付け',
    loadTabs: '開いているタブを読み込む',
    addSelectedTabs: '選択したタブを追加',
    noTabs: 'インポートできるタブがありません',
    tabsError: 'タブ一覧を取得できませんでした',
    tabSelectionCounts: '選択 {selected} / 全 {total}',
    urlCounts: '有効 {valid}件 / 無効 {invalid}件',
    importRun: '{count}件をインポート',
    importProgress: '{done} / {total} インポート中…',
    importBatchProgress: '{count} 件を一括追加中…',
    importDone: '完了: 成功 {ok}件 / 失敗 {ng}件',
    importFailedSummary: '中断: 成功 {ok}件 / 失敗 {ng}件 / 残り {rest}件は未処理',
    importAborted: '中断しました: 成功 {ok}件 / 残り {rest}件は未処理',
  },
}

export function detectLang(nav: { language: string } = navigator): Lang {
  return nav.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function createT(lang: Lang) {
  return (key: MsgKey, vars: Record<string, string | number> = {}): string => {
    const table = MESSAGES[lang] as Record<string, string>
    const template = table[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_m, name) =>
      name in vars ? String(vars[name]) : `{${name}}`,
    )
  }
}
