import type { RowIdentity } from '../types'

// §8.5 の実 DOM 調査に基づくセレクタ。UI 変更時はこのファイルのみ修正する。
export const SELECTORS = {
  row: 'project-table table.project-table tbody tr[mat-row][role="row"]',
  title: 'span.project-table-title',
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
  const jslog = row.getAttribute('jslog')
  return { title, jslog: jslog && jslog.length > 0 ? jslog : null }
}

export function findRowByIdentity(id: RowIdentity, root: ParentNode = document): HTMLElement | null {
  const rows = getNotebookRows(root)
  if (id.jslog) {
    const byJslog = rows.find((r) => r.getAttribute('jslog') === id.jslog)
    if (byJslog) return byJslog
  }
  return rows.find((r) => getRowIdentity(r).title === id.title) ?? null
}

export function getMoreButton(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(SELECTORS.moreButton)
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
