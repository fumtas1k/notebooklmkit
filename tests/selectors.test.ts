import { describe, it, expect, beforeEach } from 'vitest'
import {
  getNotebookRows, getRowIdentity, findRowByIdentity,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
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

  it('reads identity with jslog and title', () => {
    const [row] = getNotebookRows()
    expect(getRowIdentity(row)).toEqual({ title: 'Alpha', jslog: '12345;track:xyz' })
  })

  it('reads identity with null jslog', () => {
    const row = getNotebookRows()[1]
    expect(getRowIdentity(row)).toEqual({ title: 'Beta', jslog: null })
  })

  it('finds a row by identity (jslog preferred)', () => {
    const found = findRowByIdentity({ title: 'Alpha', jslog: '12345;track:xyz' })
    expect(found).not.toBeNull()
    expect(getRowIdentity(found!).title).toBe('Alpha')
  })

  it('finds a row by title when jslog is null', () => {
    const found = findRowByIdentity({ title: 'Beta', jslog: null })
    expect(getRowIdentity(found!).title).toBe('Beta')
  })

  it('returns null when the row is gone', () => {
    expect(findRowByIdentity({ title: 'Ghost', jslog: null })).toBeNull()
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
