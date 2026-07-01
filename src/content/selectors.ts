import type { RowIdentity } from '../types'

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
