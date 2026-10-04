import { describe, it, expect, vi } from 'vitest'
import { deleteNotebooks, type DeleterDeps } from '../src/content/deleter'
import { waitFor } from '../src/content/dom-utils'
import { makeTarget, type NotebookTarget } from '../src/types'

// 実 DOM の確認ダイアログは、開いている間ずっと同じノードで、開き直すと別ノードになる。
// deleter は最初に見たダイアログのノードに束縛する（#94）ので、フェイクも同じ性質にする
// （呼ぶたびに新しいノードを返すフェイクだと「差し替えられた」と誤判定され、実挙動と乖離する）。
function dialogFake() {
  let node: HTMLElement | null = null
  return (open: boolean): HTMLElement | null => {
    if (!open) { node = null; return null }
    return (node ??= document.createElement('div'))
  }
}
const dlg = dialogFake()

// 削除対象の世界を実 DOM ノードで表現するフェイク world。
// row.isConnected を実際の DOM 接続状態として検証できるようにする。
function makeWorld(titles: string[]) {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  document.body.appendChild(container)
  for (const t of titles) {
    const tr = document.createElement('div'); tr.dataset.title = t; container.appendChild(tr)
  }
  let menuRow: HTMLElement | null = null
  let dialogRow: HTMLElement | null = null
  // 実 DOM のメニュー項目 / ボタンは document に接続されている。deleter は押す直前に接続を確認する
  // ので、フェイクも接続しておく（切断済み要素を返すフェイクだと実挙動と乖離する）。
  const el = (name: string) => { const e = document.createElement('div'); e.dataset.name = name; document.body.appendChild(e); return e }
  const firstRow = (title: string) =>
    ([...container.children] as HTMLElement[]).find((r) => r.dataset.title === title) ?? null

  const deps: DeleterDeps = {
    findRow: (t) => firstRow(t.title),
    getMoreButton: (row) => { const b = el('more'); (b as any)._row = row; return b },
    getDeleteMenuItem: () => (menuRow ? el('delete') : null),
    getConfirmDialog: () => dlg(dialogRow != null),
    getConfirmDeleteButton: () => el('confirm'),
    click: (e) => {
      const name = e.dataset.name
      if (name === 'more') menuRow = (e as any)._row ?? null
      else if (name === 'delete') { dialogRow = menuRow; menuRow = null }
      else if (name === 'confirm') { dialogRow?.remove(); dialogRow = null }
    },
    waitFor,
    timeout: 200,
    // テストは実時間を待たない。settle 待機が「呼ばれたか / 何 ms か」だけ検証する。
    delay: async () => {},
  }
  return { deps, container }
}

const targets = (...names: string[]): NotebookTarget[] =>
  names.map((n) => makeTarget({ title: n }))

describe('deleteNotebooks', () => {
  it('deletes all targets sequentially and reports progress', async () => {
    const { deps, container } = makeWorld(['A', 'B', 'C'])
    const progress = vi.fn()
    const res = await deleteNotebooks(targets('A', 'B', 'C'), deps, { onProgress: progress })
    expect(res.succeeded.length).toBe(3)
    expect(res.failed).toEqual([])
    expect(res.aborted).toBe(false)
    expect(container.children.length).toBe(0)
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: 3, completed: 3, failed: 0 }),
    )
  })

  it('waits for the confirm Delete button to render after the dialog appears', async () => {
    const { deps, container } = makeWorld(['A'])
    // mat-dialog-container は先に出るが Delete ボタンは遅れて描画される状況を再現：
    // 最初の取得は null、次回以降ボタンを返す。同期取得だった旧実装なら失敗する。
    const realGetBtn = deps.getConfirmDeleteButton
    let calls = 0
    deps.getConfirmDeleteButton = (dialog) => {
      calls++
      return calls < 2 ? null : realGetBtn(dialog)
    }
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(res.succeeded.length).toBe(1)
    expect(res.failed).toEqual([])
    expect(container.children.length).toBe(0)
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('records a failure when a row never disappears, and stops', async () => {
    const { deps } = makeWorld(['A', 'B'])
    // confirm click は行を消さないよう差し替え → 消滅待ちがタイムアウト。
    // more→menu, delete→dialog の開閉は維持し、⑤ まで到達させる。
    let menuOpen = false
    let dialogOpen = false
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') menuOpen = true
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      // confirm: 何もしない（行を残したまま）
    }
    deps.getDeleteMenuItem = () => (menuOpen ? document.createElement('div') : null)
    deps.getConfirmDialog = () => dlg(dialogOpen)
    const res = await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(res.succeeded.length).toBe(0)
    expect(res.failed.length).toBe(1) // 最初の失敗で停止
    expect(res.failed[0].key).toBe('title:A')
  })

  it('aborts between items when signal is aborted', async () => {
    const { deps } = makeWorld(['A', 'B', 'C'])
    const ac = new AbortController()
    let count = 0
    const baseClick = deps.click
    const wrapped = { ...deps, click: (e: HTMLElement) => {
      baseClick(e)
      if (e.dataset.name === 'confirm') { count++; if (count === 1) ac.abort() }
    } }
    const res = await deleteNotebooks(targets('A', 'B', 'C'), wrapped, { signal: ac.signal })
    expect(res.aborted).toBe(true)
    expect(res.succeeded.length).toBe(1) // 1件完了後に中断
  })

  it('deletes duplicate-titled notebooks without a false failure', async () => {
    const { deps, container } = makeWorld(['X', 'X'])
    const res = await deleteNotebooks(targets('X', 'X'), deps, {})
    expect(res.succeeded.length).toBe(2)
    expect(res.failed).toEqual([])
    expect(container.children.length).toBe(0)
  })
})

// #82: 確認ダイアログ出現直後のクリックは「閉じるだけで削除されない」（実機確認・§8.11）。
// 対策は (1) confirm クリック前の settle 待機、(2) 未削除を確認したうえでの再試行。
describe('confirm click settling and retry', () => {
  // click ディスパッチは dataset.name で分岐するため、フェイク要素には必ず名前を付ける。
  const named = (name: string): HTMLElement => {
    const e = document.createElement('div')
    e.dataset.name = name
    document.body.appendChild(e)
    return e
  }

  it('waits (settle) after finding the confirm button and before clicking it', async () => {
    const { deps } = makeWorld(['A'])
    const order: string[] = []
    const realClick = deps.click
    deps.delay = async (ms) => { order.push(`delay:${ms}`) }
    deps.click = (e) => { order.push(`click:${e.dataset.name}`); realClick(e) }
    await deleteNotebooks(targets('A'), deps, {})
    // 「confirm ボタンを見つけた後・クリックする前」に待機が入っていること
    expect(order).toContain('click:confirm')
    const settleIdx = order.findIndex((o) => o.startsWith('delay:'))
    expect(settleIdx).toBeGreaterThanOrEqual(0)
    expect(settleIdx).toBeLessThan(order.indexOf('click:confirm'))
  })

  it('uses the configured settleMs', async () => {
    const { deps } = makeWorld(['A'])
    const waited: number[] = []
    deps.delay = async (ms) => { waited.push(ms) }
    deps.settleMs = 321
    await deleteNotebooks(targets('A'), deps, {})
    expect(waited).toContain(321)
  })

  it('retries the whole flow when the first confirm click silently fails', async () => {
    const { deps, container } = makeWorld(['A'])
    // 1回目の confirm クリックだけ「ダイアログは閉じるが行は消えない」を再現する。
    let menuOpen = false, dialogOpen = false, confirmClicks = 0
    let rowToRemove: HTMLElement | null = null
    deps.getMoreButton = (row) => { const b = named('more'); (b as any)._row = row; return b }
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') { menuOpen = true; rowToRemove = (e as any)._row ?? null }
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') {
        confirmClicks++
        dialogOpen = false                       // ダイアログは必ず閉じる
        if (confirmClicks >= 2) rowToRemove?.remove()  // 2回目で初めて実際に消える
      }
    }
    deps.getDeleteMenuItem = () => (menuOpen ? named('delete') : null)
    deps.getConfirmDialog = () => dlg(dialogOpen)
    deps.getConfirmDeleteButton = () => named('confirm')

    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(confirmClicks).toBe(2)
    expect(res.succeeded).toEqual(['title:A'])
    expect(res.failed).toEqual([])
    expect(container.children.length).toBe(0)
  })

  it('gives up after maxAttempts and records the failure (does not loop forever)', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    let menuOpen = false, dialogOpen = false, confirmClicks = 0
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') menuOpen = true
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') { confirmClicks++; dialogOpen = false } // 行は永久に消えない
    }
    deps.getDeleteMenuItem = () => (menuOpen ? named('delete') : null)
    deps.getConfirmDialog = () => dlg(dialogOpen)
    deps.getConfirmDeleteButton = () => named('confirm')
    deps.maxAttempts = 3

    const res = await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(confirmClicks).toBe(3)          // 上限まで試して打ち切る
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1)      // 最初の失敗で停止（B には進まない）
    expect(res.failed[0].key).toBe('title:A')
    expect(container.children.length).toBe(2)
  })

  // codex P1: タイムアウト = 拒否ではない。判定後〜再検索の間に削除が遅れて成立すると、
  // タイトル引きは同名の別行を掴み、選択していないノートブックを消し得る（TOCTOU）。
  it('resolves the row only once and never re-resolves it by title on retry', async () => {
    const { deps } = makeWorld(['X', 'X'])
    let findRowCalls = 0
    const realFind = deps.findRow
    deps.findRow = (t) => { findRowCalls++; return realFind(t) }
    let menuOpen = false, dialogOpen = false, confirmClicks = 0
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') menuOpen = true
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') { confirmClicks++; dialogOpen = false } // 行は消えない
    }
    deps.getDeleteMenuItem = () => (menuOpen ? named('delete') : null)
    deps.getConfirmDialog = () => dlg(dialogOpen)
    deps.getConfirmDeleteButton = () => named('confirm')
    deps.maxAttempts = 3

    await deleteNotebooks(targets('X'), deps, {})
    expect(confirmClicks).toBe(3)   // 再試行はする
    expect(findRowCalls).toBe(1)    // が、行の引き直しは一度きり
  })

  // 遅延が timeout を超えれば「もう一度押す」こと自体は避けられない（無限には待てない）。
  // 守るべき不変条件は、再試行が **掴んだ行だけ** に向き、同名の兄弟に波及しないこと。
  it('never touches a same-titled sibling when the deletion lands late during retry', async () => {
    const { deps, container } = makeWorld(['X', 'X'])
    const first = container.children[0] as HTMLElement
    const second = container.children[1] as HTMLElement
    let menuOpen = false, dialogOpen = false, confirmClicks = 0
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') menuOpen = true
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') {
        confirmClicks++
        dialogOpen = false
        // 「1回目のクリックは効いていたが反映が遅れた」= 消滅待ちがタイムアウトした後に消える
        if (confirmClicks === 1) setTimeout(() => first.remove(), 250)
      }
    }
    deps.getDeleteMenuItem = () => (menuOpen ? named('delete') : null)
    deps.getConfirmDialog = () => dlg(dialogOpen)
    deps.getConfirmDeleteButton = () => named('confirm')

    const res = await deleteNotebooks(targets('X'), deps, {})
    // 遅れて成立した削除は完了として扱われる
    expect(res.succeeded).toEqual(['title:X'])
    expect(first.isConnected).toBe(false)
    // 同名の兄弟は無傷（旧実装は findRow の引き直しでこれを消し得た）
    expect(second.isConnected).toBe(true)
    expect(container.children.length).toBe(1)
  })

  it('never re-clicks confirm once the row is gone (no double deletion)', async () => {
    const { deps } = makeWorld(['A'])
    let confirmClicks = 0
    const realClick = deps.click
    deps.click = (e) => { if (e.dataset.name === 'confirm') confirmClicks++; realClick(e) }
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(confirmClicks).toBe(1)          // 成功した1件を二度押さない
    expect(res.succeeded).toEqual(['title:A'])
  })
})

// #87: 掴んだ行ノードが生きていても、Angular が別のノートブックへ再利用していれば
// isConnected は true のまま。ID キーのときだけ、各試行の入口で同一性を確認する
// （引き直して操作するのではなく確認だけ。タイトルキーは一意でないので適用しない）。
describe('retry identity check for id-keyed targets (#87)', () => {
  const named = (name: string): HTMLElement => {
    const e = document.createElement('div')
    e.dataset.name = name
    document.body.appendChild(e)
    return e
  }
  // 1回目の confirm は「ダイアログが閉じるだけで行は消えない」世界。
  function silentFirstConfirm(deps: DeleterDeps) {
    const state = { moreClicks: 0, confirmClicks: 0 }
    let menuOpen = false, dialogOpen = false
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') { state.moreClicks++; menuOpen = true }
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') { state.confirmClicks++; dialogOpen = false }
    }
    deps.getDeleteMenuItem = () => (menuOpen ? named('delete') : null)
    deps.getConfirmDialog = () => dlg(dialogOpen)
    deps.getConfirmDeleteButton = () => named('confirm')
    return state
  }

  it('stops without clicking when the held row node now belongs to another notebook', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const held = container.children[0] as HTMLElement
    const other = container.children[1] as HTMLElement
    const state = silentFirstConfirm(deps)
    // 1回目の試行後、対象 ID は別ノードに移った（＝掴んだノードは別ノートブックに再利用された）。
    deps.findRow = () => (state.confirmClicks === 0 ? held : other)

    const res = await deleteNotebooks([makeTarget({ title: 'A', id: 'id-a' })], deps, {})
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].key).toBe('id:id-a')
    // 再試行のメニューも確認も押していない
    expect(state.moreClicks).toBe(1)
    expect(state.confirmClicks).toBe(1)
  })

  // findRow の null は「削除された」とは限らない（実装は ID 一致に加えて削除可能行であることも
  // 要求するので、再描画で一時的に引けないだけでも null になる）。成功扱いにすると未削除のまま
  // 次の対象へ進み選択も解除されるため、結果不明として停止する（codex P2）。
  it('stops as outcome-unknown when the target can no longer be resolved but the held node is still connected', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const held = container.children[0] as HTMLElement
    const state = silentFirstConfirm(deps)
    deps.findRow = (t) =>
      t.id === 'id-a' ? (state.confirmClicks === 0 ? held : null) : (container.children[1] as HTMLElement)

    const res = await deleteNotebooks(
      [makeTarget({ title: 'A', id: 'id-a' }), makeTarget({ title: 'B', id: 'id-b' })], deps, {})
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].key).toBe('id:id-a')
    // 再試行も、次の対象 B への着手もしていない
    expect(state.moreClicks).toBe(1)
    expect(state.confirmClicks).toBe(1)
  })

  it('still retries on the same node when the id still resolves to it', async () => {
    const { deps } = makeWorld(['A'])
    const state = silentFirstConfirm(deps)
    deps.maxAttempts = 2
    const res = await deleteNotebooks([makeTarget({ title: 'A', id: 'id-a' })], deps, {})
    expect(state.confirmClicks).toBe(2)
    expect(res.failed.length).toBe(1)
  })
})

// #88: 「削除」項目が出ない行（削除権限の無いノートブック等）を掴むとタイムアウトで
// 安全停止するが、開いたメニューを画面に残さない。
describe('closes the row menu when the delete item never appears (#88)', () => {
  it('calls closeMenu once and records the failure', async () => {
    const { deps } = makeWorld(['A', 'B'])
    deps.getDeleteMenuItem = () => null
    const closeMenu = vi.fn()
    deps.closeMenu = closeMenu
    const res = await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(closeMenu).toHaveBeenCalledTimes(1)
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].key).toBe('title:A')
  })

  it('does not call closeMenu on the normal path', async () => {
    const { deps } = makeWorld(['A'])
    const closeMenu = vi.fn()
    deps.closeMenu = closeMenu
    await deleteNotebooks(targets('A'), deps, {})
    expect(closeMenu).not.toHaveBeenCalled()
  })

  it('still records the original failure when closeMenu throws', async () => {
    const { deps } = makeWorld(['A'])
    deps.getDeleteMenuItem = () => null
    deps.closeMenu = () => { throw new Error('boom') }
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].reason).not.toBe('boom')
  })
})

// #94: メニュー項目と確認ダイアログは cdk-overlay（ページ全体）から取るので、「自分が開いたもの」で
// あることを確かめてから押す。削除中に利用者が別の行のメニューを開いても、その行を消さない。
describe('binds the menu and the confirm dialog to the target row (#94)', () => {
  it('asks for the delete item of the trigger it clicked', async () => {
    const { deps } = makeWorld(['A', 'B'])
    const clicked: HTMLElement[] = []
    const asked: (HTMLElement | undefined)[] = []
    const realClick = deps.click
    const realGet = deps.getDeleteMenuItem
    deps.click = (e) => { if (e.dataset.name === 'more') clicked.push(e); realClick(e) }
    deps.getDeleteMenuItem = (trigger) => { asked.push(trigger); return realGet(trigger) }
    await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(clicked.length).toBe(2)
    // 各対象について、押したトリガーそのものを渡して削除項目を引いている
    expect(new Set(asked)).toEqual(new Set(clicked))
  })

  it('stops without opening the menu when a confirm dialog is already open', async () => {
    const { deps, container } = makeWorld(['A'])
    const clicks: string[] = []
    deps.click = (e) => { clicks.push(e.dataset.name ?? '') }
    deps.getConfirmDialog = () => document.createElement('div') // 誰のものか分からないダイアログが開いている
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(clicks).toEqual([])
    expect(res.failed.length).toBe(1)
    expect(container.children.length).toBe(1)
  })

  it('does not click a confirm button that was detached while settling', async () => {
    const { deps, container } = makeWorld(['A'])
    const clicks: string[] = []
    const realClick = deps.click
    deps.click = (e) => { clicks.push(e.dataset.name ?? ''); realClick(e) }
    // settle 待機中にダイアログが閉じられた（＝掴んだボタンが DOM から外れた）
    let confirmEl: HTMLElement | null = null
    const realGetBtn = deps.getConfirmDeleteButton
    deps.getConfirmDeleteButton = (d) => (confirmEl = realGetBtn(d))
    deps.delay = async () => { confirmEl?.remove() }
    deps.maxAttempts = 1
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(clicks).not.toContain('confirm')
    expect(res.failed.length).toBe(1)
    expect(container.children.length).toBe(1)
  })

  // 確定ボタンを掴む前にダイアログが差し替わった（自分のを閉じられ、別の行の削除確認が開かれた）。
  // 後から現れたダイアログは自分が開いたものではないので、そのボタンを押さない（codex P1）。
  it('stops without confirming when the dialog is replaced before its button is found', async () => {
    const { deps, container } = makeWorld(['A'])
    const clicks: string[] = []
    const realClick = deps.click
    const first = document.createElement('div'), second = document.createElement('div')
    let opened = false, polls = 0
    deps.click = (e) => { clicks.push(e.dataset.name ?? ''); if (e.dataset.name === 'delete') opened = true; else realClick(e) }
    // 1 回目のポーリングは自分のダイアログ（ボタン未描画）、2 回目以降は別のダイアログ
    deps.getConfirmDialog = () => (!opened ? null : polls++ === 0 ? first : second)
    const realGetBtn = deps.getConfirmDeleteButton
    deps.getConfirmDeleteButton = (d) => (d === first ? null : realGetBtn(d))
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(clicks).not.toContain('confirm')
    expect(res.failed.length).toBe(1)
    expect(container.children.length).toBe(1)
  })

  // 自分のダイアログが閉じられ、しばらく何も無い状態を挟んでから別のダイアログが開いた場合も同じ。
  // 「ノード → 無し」の時点で止まり、後から現れたものに束縛し直さない。
  it('stops when its dialog disappears before the button is found, and never binds to a later one', async () => {
    const { deps, container } = makeWorld(['A'])
    const clicks: string[] = []
    const realClick = deps.click
    const first = document.createElement('div'), second = document.createElement('div')
    let opened = false, polls = 0
    deps.click = (e) => { clicks.push(e.dataset.name ?? ''); if (e.dataset.name === 'delete') opened = true; else realClick(e) }
    // 1 回目: 自分のダイアログ（ボタン未描画）/ 2 回目: 無し / 3 回目以降: 別のダイアログ
    deps.getConfirmDialog = () => {
      if (!opened) return null
      const n = polls++
      return n === 0 ? first : n === 1 ? null : second
    }
    const realGetBtn = deps.getConfirmDeleteButton
    deps.getConfirmDeleteButton = (d) => (d === first ? null : realGetBtn(d))
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(clicks).not.toContain('confirm')
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].reason).toMatch(/closed or replaced/)
    expect(container.children.length).toBe(1)
  })

  // 前の件の削除が成立して行は消えたが、そのダイアログがまだ閉じ切っていない。由来不明として
  // 即停止せず、閉じるのを待ってから次の件に進む（codex P2）。
  it('waits for the previous confirm dialog to finish closing before starting the next target', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    let menuRow: HTMLElement | null = null, dialogOpen = false
    const mk = (name: string) => { const e = document.createElement('div'); e.dataset.name = name; document.body.appendChild(e); return e }
    deps.getMoreButton = (row) => { const b = mk('more'); (b as any)._row = row; return b }
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') menuRow = (e as any)._row
      else if (name === 'delete') dialogOpen = true
      else if (name === 'confirm') {
        menuRow?.remove(); menuRow = null
        setTimeout(() => { dialogOpen = false }, 120)   // 行が先に消え、ダイアログは遅れて閉じる
      }
    }
    deps.getDeleteMenuItem = () => (menuRow && !dialogOpen ? mk('delete') : null)
    deps.getConfirmDialog = () => dlg(dialogOpen)
    deps.getConfirmDeleteButton = () => mk('confirm')
    deps.timeout = 1000
    const res = await deleteNotebooks(targets('A', 'B'), deps, {})
    expect(res.failed).toEqual([])
    expect(res.succeeded.length).toBe(2)
    expect(container.children.length).toBe(0)
  })

  // 最終試行で確定ボタンが外れていても、行が消えていれば（利用者が自分で確定した等）成功として扱う。
  it('reports success on the last attempt when the row is gone even though the confirm button was detached', async () => {
    const { deps, container } = makeWorld(['A'])
    const row = container.children[0] as HTMLElement
    let confirmEl: HTMLElement | null = null
    const realGetBtn = deps.getConfirmDeleteButton
    deps.getConfirmDeleteButton = (d) => (confirmEl = realGetBtn(d))
    const clicks: string[] = []
    const realClick = deps.click
    deps.click = (e) => { clicks.push(e.dataset.name ?? ''); realClick(e) }
    deps.delay = async () => { confirmEl?.remove(); row.remove() }
    deps.maxAttempts = 1
    const res = await deleteNotebooks(targets('A'), deps, {})
    expect(clicks).not.toContain('confirm')
    expect(res.succeeded).toEqual(['title:A'])
    expect(res.failed).toEqual([])
  })
})
