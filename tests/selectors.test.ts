import { describe, it, expect, beforeEach } from 'vitest'
import {
  getNotebookRows, getRowIdentity, findDeletableRowByIdentity,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
  getListObserveTarget, getCheckboxHost, isDeletableRow, getRowKey, getOpenMenuBackdrop,
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

// 2026-08-08 実機 DOM（§8.10）。確定は yes-button / 取消は no-button。
// 旧 primary-button / tertiary-button は消滅した。
const DIALOG_HTML = `
<mat-dialog-container>
  <button class="mdc-icon-button mat-mdc-icon-button">close</button>
  <button class="mdc-button no-button mdc-button--outlined mat-primary">キャンセル</button>
  <button class="mdc-button yes-button mdc-button--unelevated mat-primary">削除</button>
</mat-dialog-container>`

// クラスが再び変わってもテキストで拾えること／取り違えないことの確認用。
const DIALOG_HTML_NO_CLASS = `
<mat-dialog-container>
  <button class="mdc-button">キャンセル</button>
  <button class="mdc-button">削除</button>
</mat-dialog-container>`

const DIALOG_HTML_EN = `
<mat-dialog-container>
  <button class="mdc-button">Cancel</button>
  <button class="mdc-button">Delete</button>
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
    const found = findDeletableRowByIdentity({ title: 'Beta' })
    expect(getRowIdentity(found!).title).toBe('Beta')
  })

  it('returns null when the row is gone', () => {
    expect(findDeletableRowByIdentity({ title: 'Ghost' })).toBeNull()
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
    const btn = getConfirmDeleteButton(dialog)
    expect(btn?.textContent).toBe('削除')
    expect(btn?.classList.contains('yes-button')).toBe(true)
  })
})

// 誤って「キャンセル」を掴むと削除が無言で no-op になり、掴み損ねると deleter が
// タイムアウトしてモーダルが開いたまま止まる（#81 の実害）。両方向を固定する。
describe('getConfirmDeleteButton', () => {
  const dialogOf = (html: string): HTMLElement => {
    document.body.innerHTML = html
    return getConfirmDialog()!
  }

  it('prefers the stable yes-button class', () => {
    expect(getConfirmDeleteButton(dialogOf(DIALOG_HTML))?.classList.contains('yes-button')).toBe(true)
  })

  it('falls back to an exact 削除 text match when the class is gone', () => {
    expect(getConfirmDeleteButton(dialogOf(DIALOG_HTML_NO_CLASS))?.textContent).toBe('削除')
  })

  it('falls back to an exact Delete text match in English UI', () => {
    expect(getConfirmDeleteButton(dialogOf(DIALOG_HTML_EN))?.textContent).toBe('Delete')
  })

  it('never returns the cancel button', () => {
    for (const html of [DIALOG_HTML, DIALOG_HTML_NO_CLASS, DIALOG_HTML_EN]) {
      const text = (getConfirmDeleteButton(dialogOf(html))?.textContent ?? '').trim()
      expect(['キャンセル', 'Cancel']).not.toContain(text)
    }
  })

  it('returns null rather than guessing when no delete button is present', () => {
    const dialog = dialogOf('<mat-dialog-container><button class="mdc-button">キャンセル</button></mat-dialog-container>')
    expect(getConfirmDeleteButton(dialog)).toBeNull()
  })

  it('does not mistake a cancel button that happens to carry the yes-button class', () => {
    const dialog = dialogOf(
      '<mat-dialog-container><button class="yes-button">キャンセル</button><button>削除</button></mat-dialog-container>',
    )
    expect(getConfirmDeleteButton(dialog)?.textContent).toBe('削除')
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

// 2026-10-04 実機の DOM（requirements §8.14）。3点メニューは nb-icon-button.project-button-more で
// ラップされ、内側の button は専用クラスを持たない。おすすめ（featured）行にも 3点メニューが付く
// （ただしメニューに「削除」は無い）。一覧表示のタイトルは a.project-table-title（title 属性つき、
// 絵文字 span を内包）。
const MORE_2026_10 = `<project-action-button><nb-icon-button class="project-button-more nb-button"><button aria-label="プロジェクトの操作メニュー"><mat-icon>more_vert</mat-icon></button></nb-icon-button><mat-menu></mat-menu></project-action-button>`
const LIST_HTML_2026_10 = `
<div class="all-projects-container">
  <div class="my-projects-container"><project-table><table class="project-table"><tbody>
    <tr mat-row role="row">
      <td class="title-column"><a class="project-table-title" title="Owned" href="/notebook/x"><span class="project-table-emoji">📄</span> Owned </a></td>
      <td class="actions-column">${MORE_2026_10}</td>
    </tr>
  </tbody></table></project-table></div>
  <div class="featured-projects-container"><project-table><table class="project-table"><tbody>
    <tr mat-row role="row">
      <td class="title-column"><a class="project-table-title" title="Featured" href="/notebook/y"><span class="project-table-emoji"><img alt="作成者のロゴ"></span> Featured </a></td>
      <td class="actions-column">${MORE_2026_10}</td>
    </tr>
  </tbody></table></project-table></div>
</div>`
const CARD_HTML_2026_10 = `
<div class="all-projects-container">
  <div class="featured-projects-container">
    <project-button class="project-button"><mat-card class="project-button-card featured-project-card">
      <div class="project-button-box"><div class="project-button-box-left"></div>${MORE_2026_10}</div>
      <div><span class="project-button-title"> Featured </span></div>
    </mat-card></project-button>
  </div>
  <div class="my-projects-container">
    <project-button class="project-button"><mat-card class="project-button-card">
      <div class="project-button-box"><div class="project-button-box-left"></div>${MORE_2026_10}</div>
      <div><span class="project-button-title"> Owned </span></div>
    </mat-card></project-button>
  </div>
</div>`

describe('selectors (2026-10 DOM, §8.14)', () => {
  it('gets the more button wrapped in nb-icon-button.project-button-more (table)', () => {
    document.body.innerHTML = LIST_HTML_2026_10
    const btn = getMoreButton(getNotebookRows()[0])
    expect(btn?.tagName).toBe('BUTTON')
    expect(btn?.getAttribute('aria-label')).toBe('プロジェクトの操作メニュー')
  })

  it('gets the wrapped more button for a card', () => {
    document.body.innerHTML = CARD_HTML_2026_10
    expect(getMoreButton(getNotebookRows()[1])?.tagName).toBe('BUTTON')
  })

  it('reads the table title from a.project-table-title without the emoji prefix', () => {
    document.body.innerHTML = LIST_HTML_2026_10
    expect(getRowIdentity(getNotebookRows()[0]).title).toBe('Owned')
  })

  it('table and card views derive the same title (selection key survives a view switch)', () => {
    document.body.innerHTML = LIST_HTML_2026_10
    const tableTitle = getRowIdentity(getNotebookRows()[0]).title
    document.body.innerHTML = CARD_HTML_2026_10
    expect(getRowIdentity(getNotebookRows()[1]).title).toBe(tableTitle)
  })

  // おすすめ行にも 3点メニューが付いたため、moreButton の有無だけでは削除可否を判定できない。
  it('treats featured rows as non-deletable even though they now have a more button (table)', () => {
    document.body.innerHTML = LIST_HTML_2026_10
    const [owned, featured] = getNotebookRows()
    expect(isDeletableRow(owned)).toBe(true)
    expect(isDeletableRow(featured)).toBe(false)
  })

  it('treats featured cards as non-deletable even though they now have a more button', () => {
    document.body.innerHTML = CARD_HTML_2026_10
    const [featured, owned] = getNotebookRows()
    expect(isDeletableRow(featured)).toBe(false)
    expect(isDeletableRow(owned)).toBe(true)
  })

  it('finds the confirm button in the 2026-10 dialog (no yes-button class) and never the cancel button', () => {
    const dialog = document.createElement('div')
    // 実 DOM に近い入れ子（ラベルは span.mdc-button__label 内）。並び順を入れ替えても取消は返さない。
    const cancel = `<button><span class="mdc-button__label">キャンセル</span></button>`
    const del = `<button class="mat-tonal-button"><span class="mdc-button__label">削除</span></button>`
    dialog.innerHTML = cancel + del
    expect(getConfirmDeleteButton(dialog)?.textContent).toBe('削除')
    dialog.innerHTML = del + cancel
    expect(getConfirmDeleteButton(dialog)?.textContent).toBe('削除')
    dialog.innerHTML = cancel
    expect(getConfirmDeleteButton(dialog)).toBeNull()
  })

  // グリッド表示ではおすすめセクションが文書順で先。所有ノートブックと同名のおすすめがあると、
  // タイトルだけで引くとおすすめ行を掴み、「削除」項目の無いメニューを開いてタイムアウトする
  // （選択した所有ノートブックが消せない。レビュー指摘）。
  it('findDeletableRowByIdentity skips a same-titled featured row that comes first', () => {
    document.body.innerHTML = CARD_HTML_2026_10.replace(' Featured ', ' Owned ')
    const [featured, owned] = getNotebookRows()
    expect(isDeletableRow(featured)).toBe(false)
    expect(findDeletableRowByIdentity({ title: 'Owned' })).toBe(owned)
  })

  it('findDeletableRowByIdentity returns null when only a non-deletable row matches', () => {
    document.body.innerHTML = CARD_HTML_2026_10
    expect(findDeletableRowByIdentity({ title: 'Featured' })).toBeNull()
  })

  it('falls back to text without the emoji when the title attribute is missing', () => {
    document.body.innerHTML = LIST_HTML_2026_10.replace(' title="Owned"', '')
    expect(getRowIdentity(getNotebookRows()[0]).title).toBe('Owned')
  })
})

// 2026-10-04 実機では全行がノートブック ID を持つ（§8.14）: 一覧は a.project-table-title の
// href="/notebook/<id>"、カードは span.project-button-title の id="project-<id>-title"。
// これを識別子に使い、同名ノートブックを区別する（タイトル識別の既知エッジケースの解消）。
const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-8222-222222222222'
const dupCard = (id: string) => `
  <project-button class="project-button"><mat-card class="project-button-card">
    <div class="project-button-box"><div class="project-button-box-left"></div>${MORE_2026_10}</div>
    <div><span class="project-button-title" id="project-${id}-title"> Same </span></div>
  </mat-card></project-button>`
const dupRow = (id: string) => `
  <tr mat-row role="row">
    <td class="title-column"><a class="project-table-title" title="Same" href="/notebook/${id}"><span class="project-table-emoji">📄</span> Same </a></td>
    <td class="actions-column">${MORE_2026_10}</td>
  </tr>`
const DUP_CARDS = `<div class="all-projects-container"><div class="my-projects-container">${dupCard(ID_A)}${dupCard(ID_B)}</div></div>`
const DUP_ROWS = `<div class="all-projects-container"><div class="my-projects-container"><project-table><table class="project-table"><tbody>${dupRow(ID_A)}${dupRow(ID_B)}</tbody></table></project-table></div></div>`

describe('notebook id identity (same-titled notebooks, §8.14)', () => {
  it('reads the notebook id from the card title span id', () => {
    document.body.innerHTML = DUP_CARDS
    expect(getNotebookRows().map((r) => getRowIdentity(r))).toEqual([
      { title: 'Same', id: ID_A }, { title: 'Same', id: ID_B },
    ])
  })

  it('reads the notebook id from the table title link href', () => {
    document.body.innerHTML = DUP_ROWS
    expect(getNotebookRows().map((r) => getRowIdentity(r).id)).toEqual([ID_A, ID_B])
  })

  it('gives same-titled notebooks distinct keys, identical across table and card views', () => {
    document.body.innerHTML = DUP_CARDS
    const cardKeys = getNotebookRows().map(getRowKey)
    expect(new Set(cardKeys).size).toBe(2)
    document.body.innerHTML = DUP_ROWS
    expect(getNotebookRows().map(getRowKey)).toEqual(cardKeys)
  })

  it('finds the selected one of two same-titled notebooks (never the other)', () => {
    document.body.innerHTML = DUP_CARDS
    const [a, b] = getNotebookRows()
    expect(findDeletableRowByIdentity({ title: 'Same', id: ID_B })).toBe(b)
    expect(findDeletableRowByIdentity({ title: 'Same', id: ID_A })).toBe(a)
  })

  it('does not fall back to a title match when the id-identified notebook is gone', () => {
    // ID_A を削除済みの状態。同名の ID_B を掴んではならない（選択していないものを消さない）。
    document.body.innerHTML = `<div class="all-projects-container"><div class="my-projects-container">${dupCard(ID_B)}</div></div>`
    expect(findDeletableRowByIdentity({ title: 'Same', id: ID_A })).toBeNull()
  })

  it('extracts the id from absolute / query-suffixed hrefs and ignores an empty id', () => {
    const idOf = (href: string) => {
      document.body.innerHTML = DUP_ROWS.replace(`/notebook/${ID_A}`, href)
      return getRowIdentity(getNotebookRows()[0]).id
    }
    expect(idOf(`https://notebook.google.com/notebook/${ID_A}`)).toBe(ID_A)
    expect(idOf(`/notebook/${ID_A}?authuser=0`)).toBe(ID_A)
    expect(idOf(`/notebook/${ID_A}#x`)).toBe(ID_A)
    // 空 ID は ID 扱いにしない（タイトルキーへフォールバック）。
    expect(idOf('/notebook/')).toBeUndefined()
    expect(getRowKey(getNotebookRows()[0])).toBe('title:Same')
  })

  it('falls back to a title key when a row exposes no id (old DOM)', () => {
    document.body.innerHTML = LIST_HTML
    expect(getRowKey(getNotebookRows()[0])).toBe('title:Alpha')
    expect(getRowIdentity(getNotebookRows()[0])).toEqual({ title: 'Alpha' })
  })
})

// #88: 「削除」項目が出ずに停止するとき、開いた3点メニューを閉じるためのバックドロップ。
// 2026-10-04 実機: メニューを開くと cdk-overlay-container に透明バックドロップが 1 枚足され、
// そのクリックでメニューが閉じる（§8.14）。
describe('getOpenMenuBackdrop', () => {
  const overlay = (inner: string) => `<div class="cdk-overlay-container">${inner}</div>`
  const BACKDROP = '<div class="cdk-overlay-backdrop cdk-overlay-transparent-backdrop"></div>'
  const MENU = '<div class="cdk-overlay-pane"><div class="mat-mdc-menu-panel project-actions-menu"></div></div>'

  it('returns the transparent backdrop while a menu panel is open', () => {
    document.body.innerHTML = overlay(BACKDROP + MENU)
    expect(getOpenMenuBackdrop()?.classList.contains('cdk-overlay-transparent-backdrop')).toBe(true)
  })

  it('returns null when no menu panel is open (never clicks a dialog backdrop)', () => {
    document.body.innerHTML = overlay(
      '<div class="cdk-overlay-backdrop cdk-overlay-dark-backdrop"></div><mat-dialog-container></mat-dialog-container>',
    )
    expect(getOpenMenuBackdrop()).toBeNull()
  })

  it('ignores the dark (dialog) backdrop even when a menu is open', () => {
    document.body.innerHTML = overlay('<div class="cdk-overlay-backdrop cdk-overlay-dark-backdrop"></div>' + MENU)
    expect(getOpenMenuBackdrop()).toBeNull()
  })

  // 行の3点メニュー以外（アカウントメニュー等）が開いているだけなら触らない（codex P2）。
  it('returns null when the open menu is not the project actions menu', () => {
    document.body.innerHTML = overlay(
      BACKDROP + '<div class="cdk-overlay-pane"><div class="mat-mdc-menu-panel some-other-menu"></div></div>',
    )
    expect(getOpenMenuBackdrop()).toBeNull()
  })

  it('returns the last transparent backdrop when several are stacked', () => {
    document.body.innerHTML = overlay(
      '<div id="first" class="cdk-overlay-backdrop cdk-overlay-transparent-backdrop"></div>' +
      '<div id="last" class="cdk-overlay-backdrop cdk-overlay-transparent-backdrop"></div>' + MENU,
    )
    expect(getOpenMenuBackdrop()?.id).toBe('last')
  })
})
