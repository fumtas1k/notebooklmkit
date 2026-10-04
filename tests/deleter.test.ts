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
// isConnected は true のまま。ID キーのときだけ、再試行で確認ダイアログ消滅待ちの後・メニュー
// クリックの直前に同一性を確認する（#110）
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

  // #110: 再試行は「確認ダイアログが無くなるのを待つ」await を挟んでからメニューを押す。同一性の確認が
  // その待機より前にあると、待機中にノードが再利用されたとき別のノートブックのメニューを開く。
  // 前の試行のダイアログが閉じ切らずに残り、再試行の消滅待ちに入った**後で**閉じる世界を作る。
  // 順序は実時間ではなく待機の単位で固定する: waitFor を包んで「いまどの待機のポーリング中か」を
  // 記録し、確定クリックの後に確認ダイアログを見に来る待機を数える。
  //   1 つ目 = ループ末尾の「ダイアログが引くのを待つ」（開いたままなのでタイムアウトする）
  //   2 つ目 = 再試行の消滅待ち。その最初のポーリングの中でダイアログを閉じ、onClose で対象 ID の
  //            行を変える（＝再試行の消滅待ちに入った後・メニュークリックの前）。
  function lingeringDialogOnRetry(deps: DeleterDeps, onClose: () => void) {
    const state = { moreClicks: 0, confirmClicks: 0 }
    let menuOpen = false, dialogOpen = false
    let waitSeq = 0, pollingWait = 0
    const dialogWaitsAfterConfirm = new Set<number>()
    deps.waitFor = ((fn: () => unknown, opts?: Parameters<typeof waitFor>[1]) => {
      const id = ++waitSeq
      return waitFor(() => {
        pollingWait = id
        try { return fn() } finally { pollingWait = 0 }
      }, opts)
    }) as typeof waitFor
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') { state.moreClicks++; menuOpen = true }
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') state.confirmClicks++   // 無言で失敗し、ダイアログは残る
    }
    deps.getDeleteMenuItem = () => (menuOpen ? named('delete') : null)
    deps.getConfirmDialog = () => {
      if (state.confirmClicks === 1 && dialogOpen && pollingWait) {
        dialogWaitsAfterConfirm.add(pollingWait)
        if (dialogWaitsAfterConfirm.size === 2) { dialogOpen = false; onClose() }
      }
      return dlg(dialogOpen)
    }
    deps.getConfirmDeleteButton = () => named('confirm')
    return state
  }

  it('stops without clicking when the id moves to another node while waiting for the previous dialog to close', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const held = container.children[0] as HTMLElement
    const other = container.children[1] as HTMLElement
    let current: HTMLElement | null = held
    const state = lingeringDialogOnRetry(deps, () => { current = other })
    deps.findRow = () => current

    const res = await deleteNotebooks([makeTarget({ title: 'A', id: 'id-a' })], deps, {})
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].reason).toMatch(/re-identified/)
    // 再試行のメニューも確認も押していない
    expect(state.moreClicks).toBe(1)
    expect(state.confirmClicks).toBe(1)
    expect(container.children.length).toBe(2)
  })

  it('stops as outcome-unknown when the target stops resolving while waiting for the previous dialog to close', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const held = container.children[0] as HTMLElement
    let current: HTMLElement | null = held
    const state = lingeringDialogOnRetry(deps, () => { current = null })
    deps.findRow = (t) => (t.id === 'id-a' ? current : (container.children[1] as HTMLElement))

    const res = await deleteNotebooks(
      [makeTarget({ title: 'A', id: 'id-a' }), makeTarget({ title: 'B', id: 'id-b' })], deps, {})
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].key).toBe('id:id-a')
    expect(res.failed[0].reason).toMatch(/re-identified/)
    // 再試行も、次の対象 B への着手もしていない
    expect(state.moreClicks).toBe(1)
    expect(state.confirmClicks).toBe(1)
    expect(container.children.length).toBe(2)
  })
})

// #113: 1 回目の試行も、メニューを押す前に「確認ダイアログが無くなるのを待つ」。直前の件の削除直後
// （＝一覧の再描画と重なる時間帯）なので、行を先に掴んで待つと、待機中にそのノードが別のノートブックへ
// 再利用されたとき選択していないものを消す。ID キーでは、行の特定・ダイアログ不在の確認・メニューの
// クリックを同じ同期ブロックで行い、まだ何も押していない間は毎回 ID で引き直す。
describe('first-attempt identity check for id-keyed targets (#113)', () => {
  // 直前の件のダイアログが残っている世界。順序は実時間ではなく、確認ダイアログを見に来た回数で固定する:
  // 1 回目は開いたまま、2 回目で閉じ、その瞬間に onClose で一覧を書き換える
  // （＝消滅待ちに入った後・メニュークリックの前）。開いている間は同じノードを返す。
  function lingeringDialogAtStart(deps: DeleterDeps, onClose: () => void) {
    const state = { moreRows: [] as HTMLElement[], clicks: [] as string[] }
    const stale = document.createElement('div')
    const realDialog = deps.getConfirmDialog
    const realClick = deps.click
    let lingering = true, polls = 0
    deps.getConfirmDialog = () => {
      if (!lingering) return realDialog()
      if (++polls < 2) return stale
      lingering = false
      onClose()
      return realDialog()
    }
    deps.click = (e) => {
      state.clicks.push(e.dataset.name ?? '')
      if (e.dataset.name === 'more') state.moreRows.push((e as any)._row)
      realClick(e)
    }
    return state
  }
  const idA = () => makeTarget({ title: 'A', id: 'id-a' })
  const idB = () => makeTarget({ title: 'B', id: 'id-b' })

  it('does not open the menu of the originally found node when the id moves to another node while waiting', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const original = container.children[0] as HTMLElement
    const moved = container.children[1] as HTMLElement
    let current: HTMLElement | null = original
    // 待機中に対象 ID は別ノードへ移った（＝最初のノードは別のノートブックに再利用された）。
    const state = lingeringDialogAtStart(deps, () => { current = moved })
    deps.findRow = () => current

    const res = await deleteNotebooks([idA()], deps, {})
    // 押したのは、押す時点でその ID を持っていたノードだけ
    expect(state.moreRows).toEqual([moved])
    expect(original.isConnected).toBe(true)
    expect(moved.isConnected).toBe(false)
    expect(res.succeeded).toEqual(['id:id-a'])
    expect(res.failed).toEqual([])
  })

  it('re-resolves and deletes when the id temporarily stops resolving while waiting (no false failure)', async () => {
    const { deps, container } = makeWorld(['A'])
    const original = container.children[0] as HTMLElement
    const fresh = document.createElement('div'); fresh.dataset.title = 'A'
    let current: HTMLElement | null = original
    let nullPolls = 0
    // 再描画: 元のノードは外れ、しばらく引けず、その後に同じ ID の行が新しいノードで現れる。
    const state = lingeringDialogAtStart(deps, () => { original.remove(); current = null })
    deps.timeout = 1000 // 既定の 200ms はポーリング 3 回分しかない。引けない回を挟む余裕を取る
    deps.findRow = () => {
      if (current || original.isConnected) return current
      if (++nullPolls < 3) return null
      container.appendChild(fresh)
      return (current = fresh)
    }

    const res = await deleteNotebooks([idA()], deps, {})
    expect(nullPolls).toBe(3)
    expect(state.moreRows).toEqual([fresh])
    expect(fresh.isConnected).toBe(false)
    expect(res.succeeded).toEqual(['id:id-a'])
    expect(res.failed).toEqual([])
  })

  it('stops without clicking anything when the id never resolves again, and does not move on', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const original = container.children[0] as HTMLElement
    let current: HTMLElement | null = original
    const state = lingeringDialogAtStart(deps, () => { current = null })
    deps.findRow = (t) => (t.id === 'id-a' ? current : (container.children[1] as HTMLElement))

    const res = await deleteNotebooks([idA(), idB()], deps, {})
    expect(state.clicks).toEqual([])
    expect(res.succeeded).toEqual([])
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].key).toBe('id:id-a')
    // ダイアログは閉じている。行を引けなかったことが理由で、由来不明ダイアログとは報告しない。
    expect(res.failed[0].reason).not.toMatch(/already open/)
    expect(container.children.length).toBe(2)
  })

  it('stops without clicking when an unknown confirm dialog stays open (id key)', async () => {
    const { deps, container } = makeWorld(['A'])
    const clicks: string[] = []
    const stale = document.createElement('div')
    deps.click = (e) => { clicks.push(e.dataset.name ?? '') }
    deps.getConfirmDialog = () => stale
    const res = await deleteNotebooks([idA()], deps, {})
    expect(clicks).toEqual([])
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].reason).toMatch(/already open/)
    expect(container.children.length).toBe(1)
  })

  // 確認とクリックの間に await が無いことを固定する。行を引いた述語が値を返した直後（waitFor の
  // resolve が呼び出し側に届く前）に一覧を書き換える。クリックが述語の中にあれば、押した時点で
  // その ID の行は押したノードのまま。await の後ろで押す実装だと、書き換えの後に押すことになる。
  it('clicks the menu inside the same synchronous block that resolved the row (nothing can run in between)', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const original = container.children[0] as HTMLElement
    const other = container.children[1] as HTMLElement
    let current: HTMLElement = original
    deps.findRow = () => current
    let waits = 0
    deps.waitFor = ((fn: () => unknown, opts?: Parameters<typeof waitFor>[1]) => {
      const first = ++waits === 1
      return waitFor(() => {
        const v = fn()
        if (first && v) current = other   // 述語が行を返した直後に、対象 ID が別ノードへ移る
        return v
      }, opts)
    }) as typeof waitFor
    const atClick: { row: HTMLElement; idRow: HTMLElement }[] = []
    const realClick = deps.click
    deps.click = (e) => {
      if (e.dataset.name === 'more') atClick.push({ row: (e as any)._row, idRow: current })
      realClick(e)
    }

    const res = await deleteNotebooks([idA()], deps, {})
    // 押した瞬間、その ID の行は押したノードだった
    expect(atClick).toEqual([{ row: original, idRow: original }])
    expect(res.succeeded).toEqual(['id:id-a'])
    expect(original.isConnected).toBe(false)
    expect(other.isConnected).toBe(true)
  })

  // 押した直後から findRow が別ノードを返しても、完了判定（消滅待ち）と再試行は押したノードを見る。
  // 押した後に引き直す実装だと、別ノードの消滅を待ってタイムアウトし、再試行でそのノードを消す。
  it('tracks the node it clicked for completion, even if the id resolves elsewhere right after the click', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const original = container.children[0] as HTMLElement
    const other = container.children[1] as HTMLElement
    let current: HTMLElement = original
    deps.findRow = () => current
    const moreRows: HTMLElement[] = []
    const realClick = deps.click
    deps.click = (e) => {
      realClick(e)
      if (e.dataset.name === 'more') { moreRows.push((e as any)._row); current = other }
    }

    const res = await deleteNotebooks([idA()], deps, {})
    expect(moreRows).toEqual([original])
    expect(original.isConnected).toBe(false)
    expect(other.isConnected).toBe(true)
    expect(res.succeeded).toEqual(['id:id-a'])
    expect(res.failed).toEqual([])
  })

  // タイトルキーは新しい経路を通らない: 一度だけ引き、確認ダイアログの消滅を待ってから、掴んだノードを
  // 押す。待機中にそのノードが別のノートブックへ再利用されても気付けない（既知の残存リスク。ID を
  // 取れない DOM でだけ起きる。タイトルは一意でなく、同一性を確かめる手段が無い）。
  it('title-keyed targets keep the old path: resolve once, wait for the dialog, then click the held node', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const original = container.children[0] as HTMLElement
    const other = container.children[1] as HTMLElement
    let current: HTMLElement = original
    const order: string[] = []
    const state = lingeringDialogAtStart(deps, () => { order.push('dialog-closed'); current = other })
    deps.findRow = () => { order.push('findRow'); return current }

    const res = await deleteNotebooks(targets('A'), deps, {})
    // 行の特定はダイアログ消滅待ちの前に一度だけ。引き直さない。
    expect(order).toEqual(['findRow', 'dialog-closed'])
    expect(state.moreRows).toEqual([original])
    expect(res.succeeded).toEqual(['title:A'])
    expect(other.isConnected).toBe(true)
  })

  // この対象に対して一度でも押した後は引き直さない（#82）。1 回目に押したノードだけを操作し続ける。
  it('keeps operating on the node it clicked first; retries never switch to a re-resolved node', async () => {
    const { deps, container } = makeWorld(['A', 'B'])
    const first = container.children[0] as HTMLElement
    const other = container.children[1] as HTMLElement
    const moreRows: HTMLElement[] = []
    let menuOpen = false, dialogOpen = false, confirmClicks = 0
    deps.click = (e) => {
      const name = e.dataset.name
      if (name === 'more') { moreRows.push((e as any)._row); menuOpen = true }
      else if (name === 'delete') { dialogOpen = true; menuOpen = false }
      else if (name === 'confirm') { confirmClicks++; dialogOpen = false } // 行は消えない
    }
    deps.getDeleteMenuItem = () => (menuOpen ? namedEl('delete') : null)
    deps.getConfirmDialog = () => dlg(dialogOpen)
    deps.getConfirmDeleteButton = () => namedEl('confirm')
    // 1 回目のクリック後、対象 ID は別ノードで引けるようになる。
    deps.findRow = () => (confirmClicks === 0 ? first : other)

    const res = await deleteNotebooks([idA()], deps, {})
    expect(moreRows).toEqual([first])
    expect(confirmClicks).toBe(1)
    expect(res.failed.length).toBe(1)
    expect(res.failed[0].reason).toMatch(/re-identified/)
    expect(container.children.length).toBe(2)
  })
})

function namedEl(name: string): HTMLElement {
  const e = document.createElement('div')
  e.dataset.name = name
  document.body.appendChild(e)
  return e
}

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
