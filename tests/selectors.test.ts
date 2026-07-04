import { describe, it, expect, beforeEach } from 'vitest'
import {
  getNotebookRows, getRowIdentity, findRowByIdentity,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
  getListObserveTarget,
} from '../src/content/selectors'

const LIST_HTML = `
<div class="all-projects-container"><div class="my-projects-container">
  <project-table><table class="project-table"><tbody>
    <tr mat-row role="row" jslog="12345;track:xyz">
      <td class="title-column"><span class="project-table-emoji">📘</span><span class="project-table-title">Alpha</span></td>
      <td class="actions-column"><project-action-button><button class="project-button-more" aria-label="プロジェクトの操作メニュー"></button></project-action-button></td>
    </tr>
    <tr mat-row role="row">
      <td class="title-column"><span class="project-table-title">Beta</span></td>
      <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td>
    </tr>
  </tbody></table></project-table>
</div></div>`

const MENU_HTML = `
<div class="cdk-overlay-container">
  <button class="mat-mdc-menu-item delete-button">削除</button>
</div>`

const DIALOG_HTML = `
<mat-dialog-container>
  <button class="primary-button">Delete</button>
  <button class="tertiary-button">キャンセル</button>
</mat-dialog-container>`

describe('selectors', () => {
  beforeEach(() => { document.body.innerHTML = LIST_HTML })

  it('lists all notebook rows', () => {
    expect(getNotebookRows().length).toBe(2)
  })

  it('reads identity as the row title (ignores the shared jslog)', () => {
    const [row] = getNotebookRows()
    expect(getRowIdentity(row)).toEqual({ title: 'Alpha' })
  })

  it('reads identity for a row without jslog', () => {
    const row = getNotebookRows()[1]
    expect(getRowIdentity(row)).toEqual({ title: 'Beta' })
  })

  it('finds a row by title', () => {
    const found = findRowByIdentity({ title: 'Beta' })
    expect(getRowIdentity(found!).title).toBe('Beta')
  })

  it('returns null when the row is gone', () => {
    expect(findRowByIdentity({ title: 'Ghost' })).toBeNull()
  })

  it('gets the more button of a row', () => {
    const [row] = getNotebookRows()
    expect(getMoreButton(row)?.classList.contains('project-button-more')).toBe(true)
  })

  it('gets delete menu item, confirm dialog and delete button', () => {
    document.body.innerHTML = MENU_HTML
    expect(getDeleteMenuItem()?.textContent).toBe('削除')
    document.body.innerHTML = DIALOG_HTML
    const dialog = getConfirmDialog()!
    expect(dialog).not.toBeNull()
    expect(getConfirmDeleteButton(dialog)?.textContent).toBe('Delete')
  })
})

describe('getListObserveTarget', () => {
  it('returns the welcome-page element when present', () => {
    const root = document.createElement('div')
    root.innerHTML = '<welcome-page><div class="all-projects-container"></div></welcome-page>'
    expect(getListObserveTarget(root)?.tagName.toLowerCase()).toBe('welcome-page')
  })
  it('returns null when there is no welcome-page', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="all-projects-container"></div>'
    expect(getListObserveTarget(root)).toBeNull()
  })
  it('falls back to .welcome-page-container when welcome-page is absent', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="welcome-page-container"><div class="all-projects-container"></div></div>'
    expect(getListObserveTarget(root)?.classList.contains('welcome-page-container')).toBe(true)
  })
  it('falls back to .app-body when neither welcome-page nor .welcome-page-container is present', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="app-body"><div class="all-projects-container"></div></div>'
    expect(getListObserveTarget(root)?.classList.contains('app-body')).toBe(true)
  })
  it('prefers welcome-page over .welcome-page-container when both are present', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '<div class="welcome-page-container"><welcome-page><div class="all-projects-container"></div></welcome-page></div>'
    expect(getListObserveTarget(root)?.tagName.toLowerCase()).toBe('welcome-page')
  })
  it('returns null when no stable ancestor candidate is present', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="all-projects-container"></div>'
    expect(getListObserveTarget(root)).toBeNull()
  })
})
