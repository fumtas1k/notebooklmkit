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
