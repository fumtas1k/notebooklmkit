import { makeTarget, type RowIdentity } from '../types'

// §8.5 の実 DOM 調査に基づくセレクタ。UI 変更時はこのファイルのみ修正する。
export const SELECTORS = {
  row: 'project-table table.project-table tbody tr[mat-row][role="row"]',
  title: 'span.project-table-title',
  titleCell: 'td.title-column',
  moreButton: 'project-action-button button.project-button-more',
  deleteMenuItem: '.cdk-overlay-container button.mat-mdc-menu-item.delete-button',
  confirmDialog: 'mat-dialog-container',
  confirmDeleteButton: 'button.primary-button',
  cancelButton: 'button.tertiary-button',
  // ---- 以下 Phase 2（ソース追加フロー）。2026-07-03 実機調査済み（requirements.md §8.6）。----
  // クラス churn に強いよう、テキスト / aria-label マッチング（SOURCE_TEXT）を主軸にしつつ、
  // 候補集合を安定クラス（drop-zone-icon-button 等）で絞って誤マッチを防ぐ。
  // UI が変わったらこのファイルだけを直す。実機確認手順は docs/e2e-checklist-phase2.md §0。
  sourceDialog: 'mat-dialog-container',
  sourceChipCandidates: 'mat-chip, .mdc-evolution-chip, [role="option"], button.drop-zone-icon-button',
} as const

export function getNotebookRows(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTORS.row))
}

export function getRowIdentity(row: HTMLElement): RowIdentity {
  const title = row.querySelector(SELECTORS.title)?.textContent?.trim() ?? ''
  return { title }
}

// 行 `jslog` は全行同一で識別子に使えないため、タイトルで一致を取る。
export function findRowByIdentity(id: RowIdentity, root: ParentNode = document): HTMLElement | null {
  return getNotebookRows(root).find((r) => getRowIdentity(r).title === id.title) ?? null
}

// 行から選択キーを導出（identity → key を1箇所に集約）。
export function getRowKey(row: HTMLElement): string {
  return makeTarget(getRowIdentity(row)).key
}

export function getMoreButton(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(SELECTORS.moreButton)
}

// チェックボックスを入れるホストセル（タイトル列）。新しい列を足すと
// ヘッダー行とズレるため、既存のタイトルセル内に注入する。
export function getTitleCell(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(SELECTORS.titleCell)
}

export function getDeleteMenuItem(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.deleteMenuItem)
}

export function getConfirmDialog(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.confirmDialog)
}

export function getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(SELECTORS.confirmDeleteButton)
}

// ソース追加フローのテキストマッチャ（ja / en）。NotebookLM の UI 言語に依らず動くよう両対応。
export const SOURCE_TEXT = {
  addButtonLabel: /ソースを追加|add source/i,
  addButtonExact: /^[+＋]?\s*(追加|add)$/i,
  websiteChip: /ウェブサイト|website/i,
  submit: /挿入|insert/i,
} as const

// ソースパネルの「追加」ボタン。自拡張が注入した UI（data-nlk 配下）は除外する。
export function getAddSourceButton(root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button')).filter(
    (b) => !b.closest('[data-nlk]'),
  )
  return (
    buttons.find((b) => b.classList.contains('add-source-button')) ??
    buttons.find((b) => SOURCE_TEXT.addButtonLabel.test(b.getAttribute('aria-label') ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.addButtonLabel.test(b.textContent ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.addButtonExact.test((b.textContent ?? '').trim())) ??
    null
  )
}

export function getSourceDialog(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.sourceDialog)
}

// ダイアログ内の「ウェブサイト」チップ。querySelectorAll は document order（親→子）
// なので、テキストを含む最外のクリック可能候補が返る。
export function getWebsiteChip(dialog: HTMLElement): HTMLElement | null {
  const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(SELECTORS.sourceChipCandidates))
  return candidates.find((el) => SOURCE_TEXT.websiteChip.test(el.textContent ?? '')) ?? null
}

export function getSourceUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  return (
    dialog.querySelector<HTMLTextAreaElement>('textarea[formcontrolname="urls"]') ??
    dialog.querySelector<HTMLInputElement>('input[type="url"]') ??
    dialog.querySelector<HTMLInputElement>('input[type="text"]') ??
    dialog.querySelector<HTMLInputElement>('input:not([type])') ??
    dialog.querySelector<HTMLTextAreaElement>('textarea')
  )
}

export function getSourceSubmitButton(dialog: HTMLElement): HTMLElement | null {
  // 実 DOM の挿入ボタンは type="button"。テキスト（ja/en）で一致させる。
  // 死んだ button[type="submit"] フォールバックは撤去（無関係な submit の誤クリック防止）。
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
  return buttons.find((b) => SOURCE_TEXT.submit.test((b.textContent ?? '').trim())) ?? null
}
