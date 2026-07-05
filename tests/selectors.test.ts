import { describe, it, expect, beforeEach } from 'vitest'
import {
  getNotebookRows, getRowIdentity, findRowByIdentity,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
  getListObserveTarget, getCheckboxHost, isDeletableRow,
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

// カード（グリッド）表示の DOM（requirements §8.8）。1枚目=所有カード（moreButton あり）、
// 2枚目=おすすめカード（moreButton 無し・project-action-button 無し）。
const CARD_HTML = `
<div class="all-projects-container"><div class="my-projects-container">
  <project-button class="project-button"><mat-card class="project-button-card">
    <a class="primary-action-button" role="link"></a>
    <div class="project-button-box">
      <div class="project-button-box-icon">💻</div>
      <project-action-button><button class="project-button-more" aria-label="プロジェクトの操作メニュー"></button></project-action-button>
    </div>
    <div><span class="project-button-title">Gamma</span></div>
    <div class="project-button-subtitle"><span>出典: 1 件</span></div>
  </mat-card></project-button>
  <project-button class="project-button"><mat-card class="project-button-card">
    <a class="primary-action-button" role="link"></a>
    <div class="project-button-box"><div class="project-button-box-icon">🌐</div></div>
    <div><span class="project-button-title">Recommended</span></div>
  </mat-card></project-button>
</div></div>`

describe('selectors (card / grid view)', () => {
  beforeEach(() => { document.body.innerHTML = CARD_HTML })

  it('lists project-button cards as notebook rows', () => {
    expect(getNotebookRows().length).toBe(2)
  })

  it('reads identity from the card title span', () => {
    const first = getNotebookRows()[0]
    expect(getRowIdentity(first).title).toBe('Gamma')
  })

  it('treats a card with a more button as deletable and one without as non-deletable', () => {
    const [owned, recommended] = getNotebookRows()
    expect(isDeletableRow(owned)).toBe(true)
    expect(isDeletableRow(recommended)).toBe(false)
  })

  it('returns the box as host and the action button as insert-before for a card', () => {
    const owned = getNotebookRows()[0]
    const placement = getCheckboxHost(owned)!
    expect(placement.host.classList.contains('project-button-box')).toBe(true)
    expect((placement.before as HTMLElement).tagName.toLowerCase()).toBe('project-action-button')
  })

  // insertBefore は before が host の直接子でないと NotFoundError を投げるため、
  // 将来 NotebookLM が action button をラップしても子孫検索で拾わないことを確認する
  // （PR #73 レビュー指摘）。graceful degradation として before は null（末尾 append）になる。
  it('returns null before (not the wrapped action button) when the action button is not a direct child of the box', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <project-button class="project-button"><mat-card class="project-button-card">
        <div class="project-button-box">
          <div class="wrap">
            <project-action-button><button class="project-button-more"></button></project-action-button>
          </div>
        </div>
        <div><span class="project-button-title">Wrapped</span></div>
      </mat-card></project-button>`
    const row = getNotebookRows(root)[0]
    const placement = getCheckboxHost(row)!
    expect(placement.host.classList.contains('project-button-box')).toBe(true)
    expect(placement.before).toBeNull()
  })
})

describe('getCheckboxHost (table view)', () => {
  beforeEach(() => { document.body.innerHTML = LIST_HTML })

  it('returns the title cell as host and its first child as insert-before', () => {
    const row = getNotebookRows()[0]
    const placement = getCheckboxHost(row)!
    expect(placement.host.classList.contains('title-column')).toBe(true)
    // 先頭に挿入するため before は title セルの現在の先頭ノード（emoji span 等）。
    expect(placement.before).toBe(placement.host.firstChild)
  })

  it('returns null when the row has neither a title cell/td nor a card box', () => {
    const bare = document.createElement('div')
    expect(getCheckboxHost(bare)).toBeNull()
  })
})
