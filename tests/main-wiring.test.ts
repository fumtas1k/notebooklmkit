import { describe, it, expect, beforeEach, vi } from 'vitest'
import { init, start, buildTargets, sameTargetKeys } from '../src/content/main'
import { makeTarget } from '../src/types'
import { SelectionStore } from '../src/content/selection'
import { CHECKBOX_ATTR } from '../src/content/ui/row-checkbox'
import { deleteNotebooks } from '../src/content/deleter'

vi.mock('../src/content/deleter', () => ({
  deleteNotebooks: vi.fn(),
}))

const LIST = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">A</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">B</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table></div>`

const CARD_LIST = `
<welcome-page><div class="all-projects-container"><div class="my-projects-container">
  <project-button class="project-button"><mat-card class="project-button-card">
    <div class="project-button-box">
      <div class="project-button-box-icon">💻</div>
      <project-action-button><button class="project-button-more"></button></project-action-button>
    </div>
    <div><span class="project-button-title">Gamma</span></div>
  </mat-card></project-button>
</div></div></welcome-page>`

describe('buildTargets', () => {
  beforeEach(() => { document.body.innerHTML = LIST })
  it('returns targets for currently selected keys only', () => {
    const store = new SelectionStore()
    store.set('title:A', true)
    const targets = buildTargets(store)
    expect(targets.map((t) => t.title)).toEqual(['A'])
    expect(targets.map((t) => t.key)).toEqual(['title:A'])
  })

  // issue #23: おすすめ（Reader ロール）行は3点メニュー（moreButton）が無く削除起点も
  // 無いため、たとえ選択キーがストアにあっても対象から除外する（防御。通常経路では
  // そもそもチェックボックスが注入されないため選択され得ない）。
  it('excludes a selected row that has no more button (non-deletable / recommended row)', () => {
    document.body.innerHTML = `
    <div class="all-projects-container"><project-table><table class="project-table"><tbody>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">Recommended</span></td></tr>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">Owned</span></td>
        <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
    </tbody></table></project-table></div>`
    const store = new SelectionStore()
    // 通常経路では注入されないが、防御的な除外を検証するため直接キーを入れる。
    store.set('title:Recommended', true)
    store.set('title:Owned', true)
    const targets = buildTargets(store)
    expect(targets.map((t) => t.title)).toEqual(['Owned'])
  })
})

describe('onSelectAll', () => {
  beforeEach(() => { document.body.innerHTML = LIST })

  // issue #23: 「すべて選択」は削除可能な行（moreButton あり）だけを選択に入れる。
  it('selects only rows that have a more button, skipping recommended/Reader rows', () => {
    document.body.innerHTML = `
    <div class="all-projects-container"><project-table><table class="project-table"><tbody>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">Recommended</span></td></tr>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">Owned</span></td>
        <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
    </tbody></table></project-table></div>`
    const dispose = init()
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()

    const rows = document.querySelectorAll('tr[mat-row]')
    expect(rows[0].querySelector(`[${CHECKBOX_ATTR}]`)).toBeNull()
    const ownedBox = rows[1].querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    expect(ownedBox.checked).toBe(true)

    // 選択件数表示も1件のみ（Recommended が幽霊選択として紛れ込んでいないこと）。
    const count = document.querySelector('[data-nlk="bar-count"]')!
    expect(count.textContent).toMatch(/^1/)

    dispose()
  })
})

describe('action bar count = visible selection (issue #31)', () => {
  beforeEach(() => { document.body.innerHTML = LIST })

  it('counts only visible selection and updates on list mutation (ghost excluded)', async () => {
    const dispose = init()
    // すべて選択（A, B）→ 件数2
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()
    const count = document.querySelector('[data-nlk="bar-count"]')!
    expect(count.textContent).toContain('2')

    // B の行を DOM から削除（NotebookLM 側削除／リネーム消失を模擬）。
    // 選択キー title:B は store に残る（幽霊選択）が、可視行は A のみ。
    const rows = document.querySelectorAll('tr[mat-row]')
    rows[1].remove()

    // 一覧再描画 observer（マイクロタスク）発火を待つ → bar.refresh() で再計算。
    await new Promise((r) => setTimeout(r, 0))

    // 件数は可視選択（A の1件）のみ。幽霊 title:B は数えない。
    expect(count.textContent).toContain('1')
    expect(count.textContent).not.toContain('2')
    // 削除ボタンのラベルも可視件数（1件）に統一されている。
    expect(document.querySelector('[data-nlk="bar-delete"]')!.textContent).toContain('1')
    dispose()
  })
})

describe('sameTargetKeys', () => {
  const tgt = (title: string) => makeTarget({ title })

  it('returns true for the same key set regardless of order', () => {
    expect(sameTargetKeys([tgt('A'), tgt('B')], [tgt('B'), tgt('A')])).toBe(true)
  })
  it('returns false when lengths differ', () => {
    expect(sameTargetKeys([tgt('A')], [tgt('A'), tgt('B')])).toBe(false)
    expect(sameTargetKeys([tgt('A'), tgt('B')], [tgt('A')])).toBe(false)
  })
  it('returns false when contents differ', () => {
    expect(sameTargetKeys([tgt('A'), tgt('B')], [tgt('A'), tgt('C')])).toBe(false)
  })
  it('compares duplicate keys as a multiset (same-title edge case)', () => {
    // 同名タイトルはキーが重複する（docs/requirements.md §8.5 の既知エッジケース）。
    // 単純な Set 比較だと [A,A] と [A,B] を区別できないため多重集合で比較する。
    expect(sameTargetKeys([tgt('A'), tgt('A')], [tgt('A'), tgt('A')])).toBe(true)
    expect(sameTargetKeys([tgt('A'), tgt('A')], [tgt('A'), tgt('B')])).toBe(false)
    expect(sameTargetKeys([tgt('A'), tgt('B')], [tgt('A'), tgt('A')])).toBe(false)
  })
})

describe('init', () => {
  beforeEach(() => { document.body.innerHTML = LIST })
  it('injects checkboxes and the action bar', () => {
    init()
    expect(document.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
  })

  it('injects a checkbox in card (grid) view too', () => {
    document.body.innerHTML = CARD_LIST
    const dispose = init()
    expect(document.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(1)
    expect(document.querySelector('.project-button-box [data-nlk-checkbox]')).not.toBeNull()
    dispose()
  })
})

// 表示モード切替（カード⇄一覧）で NotebookLM は .all-projects-container を
// 新ノードに丸ごと置換する。observer を安定祖先 welcome-page に張ることで、
// 置換後の新テーブルにもチェックボックスが再注入されることを検証する。
describe('init re-injects after view-mode switch (container swap)', () => {
  const WRAPPED = (rows: string) => `
  <welcome-page><div class="welcome-page-container"><div class="all-projects-container">
    <project-table><table class="project-table"><tbody>${rows}</tbody></table></project-table>
  </div></div></welcome-page>`

  const ROW = (title: string) => `
    <tr mat-row role="row"><td class="title-column"><span class="project-table-title">${title}</span></td>
      <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>`

  it('re-injects checkboxes into a freshly swapped .all-projects-container', async () => {
    const root = document.createElement('div')
    root.innerHTML = WRAPPED(ROW('A') + ROW('B'))
    const dispose = init(root)
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)

    // 表示モード切替を模倣: .all-projects-container を別行を含む新ノードで置換する。
    const wpc = root.querySelector('.welcome-page-container')!
    wpc.querySelector('.all-projects-container')!.remove()
    const fresh = document.createElement('div')
    fresh.innerHTML = `<div class="all-projects-container"><project-table><table class="project-table"><tbody>${ROW('C') + ROW('D')}</tbody></table></project-table></div>`
    wpc.appendChild(fresh.firstElementChild!)

    // MutationObserver コールバックは microtask としてキューされる。
    await Promise.resolve()
    await Promise.resolve()

    const boxes = root.querySelectorAll(`[${CHECKBOX_ATTR}]`)
    expect(boxes.length).toBe(2)
    const titles = [...boxes].map((b) => b.getAttribute('aria-label')).sort()
    expect(titles).toEqual(['C', 'D'])
    dispose()
  })

  it('restores checked state from the selection store after the swap', async () => {
    const root = document.createElement('div')
    root.innerHTML = WRAPPED(ROW('A') + ROW('B'))
    const dispose = init(root)
    // A を選択（注入済みチェックボックスを change 発火でトグル）。
    const boxA = [...root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)]
      .find((b) => b.getAttribute('aria-label') === 'A')!
    boxA.checked = true
    boxA.dispatchEvent(new Event('change'))

    // 同名 A を含む新コンテナへ置換。
    const wpc = root.querySelector('.welcome-page-container')!
    wpc.querySelector('.all-projects-container')!.remove()
    const fresh = document.createElement('div')
    fresh.innerHTML = `<div class="all-projects-container"><project-table><table class="project-table"><tbody>${ROW('A') + ROW('C')}</tbody></table></project-table></div>`
    wpc.appendChild(fresh.firstElementChild!)
    await Promise.resolve()
    await Promise.resolve()

    const newBoxA = [...root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)]
      .find((b) => b.getAttribute('aria-label') === 'A')!
    expect(newBoxA.checked).toBe(true)
    dispose()
  })
})

describe('start (async / SPA mount)', () => {
  it('waits for .all-projects-container to appear, then bootstraps init exactly once', async () => {
    // Use a detached, dedicated root: no `.all-projects-container` exists yet,
    // simulating a cold/SPA load where the container mounts asynchronously.
    // Scoping the DOM (and the bootstrap observer) to a detached root keeps
    // this test isolated from stale MutationObservers left behind by other
    // `init()` calls elsewhere in this file (init/start never auto-disconnect
    // unless the caller keeps and invokes the returned disposer).
    const root = document.createElement('div')
    expect(root.querySelector('.all-projects-container')).toBeNull()

    const dispose = start(root)
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(0)

    root.innerHTML = LIST
    // MutationObserver callbacks are queued as microtasks.
    await Promise.resolve()
    await Promise.resolve()

    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()

    dispose()
  })

  it('calls init immediately when the container already exists', () => {
    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = start(root)
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
    dispose()
  })
})

describe('runDelete error recovery', () => {
  beforeEach(() => {
    vi.mocked(deleteNotebooks).mockReset()
  })

  it('un-busies the action bar and shows domError if deleteNotebooks rejects', async () => {
    vi.mocked(deleteNotebooks).mockRejectedValue(new Error('unexpected DOM failure'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Use a detached root for the notebook rows/checkboxes: init() never
    // disconnects its MutationObserver, so earlier tests in this file left
    // observers watching `document`/`document.body`. Feeding rows through a
    // node those stale observers don't watch keeps this test from racing
    // with them (the action bar / confirm dialog still mount on
    // document.body by default, which is fine since only this test drives
    // them).
    const root = document.createElement('div')
    root.innerHTML = LIST
    init(root)
    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    expect(checkbox).not.toBeNull()
    checkbox!.checked = true
    checkbox!.dispatchEvent(new Event('change'))

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')
    deleteBtn!.click()

    // confirmDeletion resolves its promise synchronously up to the dialog
    // insertion, so the confirm dialog is present right after the click.
    const okBtn = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')
    expect(okBtn).not.toBeNull()
    okBtn!.click()

    // Flush the microtask queue so the rejected deleteNotebooks() and the
    // surrounding try/finally in runDelete settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const stopBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-stop"]')
    const progress = document.querySelector('[data-nlk="bar-progress"]')
    expect(stopBtn!.hidden).toBe(true) // bar left the busy state
    expect(deleteBtn!.hidden).toBe(false)
    expect(progress!.textContent).toMatch(/did not match expectations|想定と異なる/)
    expect(errSpy).toHaveBeenCalled()

    errSpy.mockRestore()
  })

  it('shows the abortedSummary (not doneSummary) when deleteNotebooks resolves aborted', async () => {
    vi.mocked(deleteNotebooks).mockResolvedValue({
      succeeded: ['title:A'],
      failed: [],
      aborted: true,
    })

    // Detached root, same rationale as the error-recovery test above: avoids
    // interference from stale MutationObservers left by earlier init() calls
    // in this file.
    const root = document.createElement('div')
    root.innerHTML = LIST
    init(root)
    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    expect(checkbox).not.toBeNull()
    checkbox!.checked = true
    checkbox!.dispatchEvent(new Event('change'))

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')
    deleteBtn!.click()

    // Single selected item -> normal confirm dialog, confirm-ok enabled immediately.
    const okBtn = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')
    expect(okBtn).not.toBeNull()
    okBtn!.click()

    // Flush the microtask queue so the resolved deleteNotebooks() and the
    // surrounding try/finally in runDelete settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const stopBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-stop"]')
    const progress = document.querySelector('[data-nlk="bar-progress"]')
    expect(stopBtn!.hidden).toBe(true) // bar left the busy state
    expect(deleteBtn!.hidden).toBe(false)
    expect(progress!.textContent).toMatch(/中断しました|not processed/)
    expect(progress!.textContent).not.toMatch(/^完了|^Done/)
  })

  it('ignores a re-entrant delete click while the confirm dialog is open', async () => {
    const root = document.createElement('div')
    root.innerHTML = LIST
    init(root)
    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    expect(checkbox).not.toBeNull()
    checkbox!.checked = true
    checkbox!.dispatchEvent(new Event('change'))

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')

    // 1 回目: 確認ダイアログが開く
    deleteBtn!.click()
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(1)

    // 確認ダイアログ表示中（await confirmDeletion の最中）に 2 回目を押す
    deleteBtn!.click()

    // 再入場ガードにより 2 つ目の runDelete は無視され、ダイアログは 1 つのまま
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(1)
    // どちらの runDelete も confirm を通過していないため削除は開始されない。
    // deleteNotebooks は beforeEach の mockReset で inert のまま。成功モックで
    // 退行（ガードが壊れて再入場が deleteNotebooks に到達する）を隠さない。
    expect(deleteNotebooks).not.toHaveBeenCalled()

    // ダイアログをキャンセルして pending な confirmDeletion を解決させ、
    // overlay / document キャプチャリスナーのリークを防ぐ。あわせて外側
    // finally の `deleting = false` リセット経路を、再度削除を開始できる
    // （新しいダイアログが開く）ことで検証する。
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(0)

    deleteBtn!.click()
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(1)

    // 後片付け: 開いたダイアログを閉じ、overlay / リスナーを残さない。
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('aborts without deleting when the selection changed while the confirm dialog was open', async () => {
    // Detached root: 同 describe 内の他テストと同じ理由（古い MutationObserver との競合回避）。
    const root = document.createElement('div')
    root.innerHTML = LIST
    init(root)
    const boxes = root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    expect(boxes.length).toBe(2)
    boxes[0].checked = true
    boxes[0].dispatchEvent(new Event('change'))

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')
    deleteBtn!.click()
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()

    // 確認ダイアログ表示中に背後の選択を変更する（issue #13 の割り込み経路を再現）
    boxes[1].checked = true
    boxes[1].dispatchEvent(new Event('change'))

    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 古いスナップショットのまま削除に進んではならない
    expect(deleteNotebooks).not.toHaveBeenCalled()
    const progress = document.querySelector('[data-nlk="bar-progress"]')
    expect(progress!.textContent).toMatch(/削除対象の一覧が変わった|notebooks to delete changed/)

    // 中止後は deleting フラグが解除され、再度削除を開始できる
    deleteBtn!.click()
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(1)
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  // issue #23 レビュー指摘1: buildTargets / onSelectAll が削除可能行のみを対象に
  // するようになったので、runDelete の isSelectAll 判定（件数タイプ確認の発火条件）
  // も削除可能行だけを分母にしなければならない。削除不可行（Reader）を分母に残すと、
  // 混在リストで削除可能行を全選択しても targets.length < totalRows となって
  // isSelectAll が false に希薄化し、以前は発火していた strong confirm が漏れる。
  it('fires the strong confirm when all deletable rows are selected in a mixed list', () => {
    // 削除可能2行（A / B）＋ Reader 1行。削除可能行は STRONG_CONFIRM_THRESHOLD 未満なので、
    // strong confirm はもっぱら isSelectAll 経由でしか発火しない。
    const root = document.createElement('div')
    root.innerHTML = `
    <div class="all-projects-container"><project-table><table class="project-table"><tbody>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">Recommended</span></td></tr>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">A</span></td>
        <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
      <tr mat-row role="row"><td class="title-column"><span class="project-table-title">B</span></td>
        <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
    </tbody></table></project-table></div>`
    const dispose = init(root)

    // アクションバーは document.body に mount される（dedup 無し）。他テストが残した
    // バーと取り違えないよう、最後に mount した自分のバーの操作要素だけを叩く。
    const bars = document.querySelectorAll('[data-nlk="action-bar"]')
    const bar = bars[bars.length - 1]
    bar.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()
    bar.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()

    // 削除可能行 2 件を全選択 → isSelectAll=true → 件数タイプ確認（confirm-input あり）。
    expect(document.querySelector('[data-nlk="confirm-input"]')).not.toBeNull()

    // 後片付け: ダイアログを閉じ、overlay / document キャプチャリスナーを残さない。
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    dispose()
  })

  // issue #16: 削除処理が pending の間に init() の disposer が呼ばれると、
  // deleteNotebooks の settle 時に内側 finally が破棄済み observer を復活させて
  // しまう（現状 production では disposer 未保持のため到達不能だが、将来の SPA
  // 遷移 teardown で顕在化する）。disposed フラグでガードされていることを検証する。
  it('does not resurrect a disposed observer when delete settles after dispose', async () => {
    const observeSpy = vi.spyOn(MutationObserver.prototype, 'observe')
    let resolveDelete: (v: Awaited<ReturnType<typeof deleteNotebooks>>) => void = () => {}
    vi.mocked(deleteNotebooks).mockImplementation(
      () => new Promise((resolve) => { resolveDelete = resolve }),
    )

    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)
    const observeCallsAfterInit = observeSpy.mock.calls.length

    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    expect(checkbox).not.toBeNull()
    checkbox!.checked = true
    checkbox!.dispatchEvent(new Event('change'))

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')
    deleteBtn!.click()
    const okBtn = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')
    expect(okBtn).not.toBeNull()
    okBtn!.click()

    // runDelete が deleteNotebooks の呼び出しに到達し、pending な await で
    // 止まるまでマイクロタスクをフラッシュする。
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 削除が pending の間に dispose する（SPA 遷移 teardown のシミュレーション）。
    dispose()

    // pending だった削除処理を settle させる。
    resolveDelete({ succeeded: ['title:A'], failed: [], aborted: false })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // dispose 後は内側 finally が observer を再 observe してはならない。
    expect(observeSpy.mock.calls.length).toBe(observeCallsAfterInit)

    observeSpy.mockRestore()
  })

  // issue #16: disposer は observer の復活を防ぐだけでなく、進行中の削除ループも
  // abort しなければならない。abort しないと deleter が teardown 後も破壊的クリックを
  // 打ち続け、Stop ボタンも消えて中断手段が無くなる。
  it('aborts the in-flight delete when disposed mid-run', async () => {
    let capturedSignal: AbortSignal | undefined
    let resolveDelete: (v: Awaited<ReturnType<typeof deleteNotebooks>>) => void = () => {}
    vi.mocked(deleteNotebooks).mockImplementation(
      (_targets, _deps, opts) => {
        capturedSignal = opts?.signal
        return new Promise((resolve) => { resolveDelete = resolve })
      },
    )

    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)

    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))

    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(capturedSignal?.aborted).toBe(false)

    // 削除が pending の間に dispose すると、渡した signal が abort されること。
    dispose()
    expect(capturedSignal?.aborted).toBe(true)

    resolveDelete({ succeeded: [], failed: [], aborted: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  // レビュー第2ラウンド finding B: `await confirmDeletion` の待機中に dispose
  // された場合、currentAbort はまだ null（confirm 後にしか代入されない）で
  // no-op になるうえ、確認ダイアログは init 管理外の document.body に残るため
  // teardown を生き延びる。dispose 後にユーザーが確定してしまうと、confirm 後に
  // disposed を再チェックしていないと新品の AbortController で破壊的削除一式が
  // 始まってしまう（issue #16 と同じハザード）。
  it('does not start deleteNotebooks when disposed while the confirm dialog is still awaiting the user', async () => {
    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)

    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))

    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()

    // 確認ダイアログが確定されるより前に teardown される（SPA 遷移のシミュレーション）。
    dispose()

    // teardown 後にユーザー（または確定済みの Enter ハンドラ）がダイアログを確定する。
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(deleteNotebooks).not.toHaveBeenCalled()
  })
})

// issue #99: deleteNotebooks は最初の失敗で停止する（安全側）が、そのとき aborted は
// false（aborted は利用者の「中断」ボタン専用）。doneSummary をそのまま出すと
// 「完了: 成功 0件 / 失敗 1件」となり、残りが未処理であること・途中で止まったことが
// 伝わらない。失敗ありのときは未処理件数つきの failedSummary を出す。
describe('runDelete summary (issue #99)', () => {
  // 4 行中 3 行を選ぶ: 全選択ではなく 10 件未満なので通常の確認ダイアログ
  // （confirm-ok が即押せる）になる。
  const FOUR_ROWS = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
${['A', 'B', 'C', 'D'].map((title) => `
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">${title}</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>`).join('')}
</tbody></table></project-table></div>`

  beforeEach(() => {
    vi.mocked(deleteNotebooks).mockReset()
    document.body.innerHTML = ''
  })

  // 先頭 3 行を選択 → 削除 → 確認ダイアログを確定し、進捗表示のテキストを返す。
  async function deleteFirstThree(): Promise<string> {
    // 行は detached root に置く（他テストが残した observer と競合させないため。
    // 上の error recovery テストと同じ理由）。
    const root = document.createElement('div')
    root.innerHTML = FOUR_ROWS
    const dispose = init(root)
    const boxes = [...root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}] input, input[${CHECKBOX_ATTR}]`)]
    expect(boxes).toHaveLength(4)
    for (const box of boxes.slice(0, 3)) {
      box.checked = true
      box.dispatchEvent(new Event('change'))
    }

    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    const okBtn = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')
    expect(okBtn).not.toBeNull()
    expect(okBtn!.disabled).toBe(false)
    okBtn!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(vi.mocked(deleteNotebooks)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deleteNotebooks).mock.calls[0][0]).toHaveLength(3)
    const text = document.querySelector('[data-nlk="bar-progress"]')!.textContent ?? ''
    dispose()
    return text
  }

  it('shows the failedSummary with the unprocessed count when the run stopped on a failure', async () => {
    const failed = [{ key: 'title:A', reason: 'row did not disappear' }]
    vi.mocked(deleteNotebooks).mockResolvedValue({ succeeded: [], failed, aborted: false })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const text = await deleteFirstThree()

    // 3 件選択・1 件目で失敗 → 成功 0 / 失敗 1 / 残り 2。
    expect(text).toMatch(
      /^(Stopped: 0 deleted \/ 1 failed \/ 2 not processed|中断: 成功 0件 \/ 失敗 1件 \/ 残り 2件は未処理)$/,
    )
    expect(text).not.toMatch(/^完了|^Done/)
    // 停止理由は画面に出さず、コンソールに残す。
    expect(warnSpy).toHaveBeenCalledWith('notebooklmkit: delete stopped', failed)
    warnSpy.mockRestore()
  })

  it('counts the already-deleted ones when it stopped on a later item', async () => {
    vi.mocked(deleteNotebooks).mockResolvedValue({
      succeeded: ['title:A'],
      failed: [{ key: 'title:B', reason: 'timeout' }],
      aborted: false,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const text = await deleteFirstThree()

    expect(text).toMatch(
      /^(Stopped: 1 deleted \/ 1 failed \/ 1 not processed|中断: 成功 1件 \/ 失敗 1件 \/ 残り 1件は未処理)$/,
    )
    warnSpy.mockRestore()
  })

  it('keeps the doneSummary when everything succeeded', async () => {
    vi.mocked(deleteNotebooks).mockResolvedValue({
      succeeded: ['title:A', 'title:B', 'title:C'],
      failed: [],
      aborted: false,
    })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const text = await deleteFirstThree()

    expect(text).toMatch(/^(Done: 3 succeeded \/ 0 failed|完了: 成功 3件 \/ 失敗 0件)$/)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('keeps the abortedSummary when the user stopped the run', async () => {
    vi.mocked(deleteNotebooks).mockResolvedValue({ succeeded: ['title:A'], failed: [], aborted: true })

    const text = await deleteFirstThree()

    expect(text).toMatch(
      /^(Stopped: 1 deleted \/ 2 not processed|中断しました: 成功 1件 \/ 残り 2件は未処理)$/,
    )
  })
})

// issue #28: Angular のインターポレーション更新（{{title}}）は既存テキストノードの
// nodeValue を書き換えるだけで childList レコードを出さない。characterData を
// 監視しないと、リネームフロー（メニュー/ダイアログは監視対象コンテナ外の
// .cdk-overlay-container に出る）でチェックボックスのキー / aria-label / checked が
// stale なまま残る。
describe('observer characterData tracking (issue #28)', () => {
  beforeEach(() => {
    vi.mocked(deleteNotebooks).mockReset()
  })

  it('re-syncs checkbox key / aria-label / checked when a title text node is rewritten in place', async () => {
    // Detached root: 同ファイル内の他テストと同じ理由（古い MutationObserver との競合回避）。
    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)

    const row = root.querySelector('tr[mat-row]')!
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))

    // リネームをシミュレート: 既存テキストノードの nodeValue のみを書き換える
    // （span.textContent への代入はテキストノード置換＝ childList レコードに
    // なってしまうため、ここでは使わない）。
    const textNode = row.querySelector('span.project-table-title')!.firstChild as Text
    textNode.nodeValue = 'A-renamed'
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(box.getAttribute(CHECKBOX_ATTR)).toBe('title:A-renamed')
    expect(box.getAttribute('aria-label')).toBe('A-renamed')
    // 新タイトルのキーは未選択のため checked も追従して外れる
    // （旧キー title:A はストアに残留する。既知の title 識別トレードオフ）。
    expect(box.checked).toBe(false)

    dispose()
  })

  it('still re-syncs an in-place title rewrite after a delete completes (finally re-attach includes characterData)', async () => {
    vi.mocked(deleteNotebooks).mockResolvedValue({ succeeded: ['title:A'], failed: [], aborted: false })

    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)

    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))

    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 削除完了後（finally で observer 再接続済み）に、削除に関与していない行 B の
    // タイトルをその場（nodeValue）で書き換える。再接続が characterData 込みで
    // なければこのリネームは観測されず stale なまま残るため、振る舞いとして
    // 「finally の再接続オプション」を検証できる（スパイ・呼び出し回数への結合を
    // 避ける。オプション2箇所の乖離防止は LIST_OBSERVE_OPTIONS 定数化が担保）。
    const rowB = root.querySelectorAll('tr[mat-row]')[1]!
    const boxB = rowB.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)!
    const textNode = rowB.querySelector('span.project-table-title')!.firstChild as Text
    textNode.nodeValue = 'B-renamed'
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(boxB.getAttribute(CHECKBOX_ATTR)).toBe('title:B-renamed')
    expect(boxB.getAttribute('aria-label')).toBe('B-renamed')

    dispose()
  })
})

// 2026-10-04 実機の DOM（requirements §8.14）。全行がノートブック ID を持ち、選択キーは id:<ID>。
// 同名ノートブックを区別できることを配線レベルで固定する（独立レビュー指摘）。
describe('init with notebook ids (same-titled notebooks, §8.14)', () => {
  const MORE = `<project-action-button><nb-icon-button class="project-button-more"><button></button></nb-icon-button></project-action-button>`
  const row = (id: string, title: string) => `
    <tr mat-row role="row">
      <td class="title-column"><a class="project-table-title" title="${title}" href="/notebook/${id}"><span class="project-table-emoji">📄</span> ${title} </a></td>
      <td class="actions-column">${MORE}</td>
    </tr>`
  const PAGE = `
  <welcome-page><div class="all-projects-container"><div class="my-projects-container">
    <project-table><table class="project-table"><tbody>${row('id-a', 'Same')}${row('id-b', 'Same')}</tbody></table></project-table>
  </div></div></welcome-page>`
  const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`))
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => { document.body.innerHTML = PAGE })

  it('buildTargets returns only the selected one of two same-titled notebooks', () => {
    const store = new SelectionStore()
    store.set('id:id-b', true)
    expect(buildTargets(store).map((t) => t.key)).toEqual(['id:id-b'])
  })

  it('checking one same-titled row counts 1, deletes only it, and leaves the other unselected', async () => {
    vi.mocked(deleteNotebooks).mockReset()
    vi.mocked(deleteNotebooks).mockResolvedValue({ succeeded: ['id:id-a'], failed: [], aborted: false })
    const dispose = init()
    const [a, b] = boxes()
    a.checked = true
    a.dispatchEvent(new Event('change'))
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('1')
    expect(b.checked).toBe(false)

    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await tick()

    const targets = vi.mocked(deleteNotebooks).mock.calls[0][0]
    expect(targets.map((t) => t.key)).toEqual(['id:id-a'])
    // 成功キーが store から外れ、同名のもう片方は未選択のまま。
    expect(boxes().map((x) => x.checked)).toEqual([false, false])
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('0')
    dispose()
  })

  it('select-all stores id keys', () => {
    const dispose = init()
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()
    expect(boxes().map((x) => x.getAttribute(CHECKBOX_ATTR))).toEqual(['id:id-a', 'id:id-b'])
    expect(boxes().every((x) => x.checked)).toBe(true)
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toContain('2')
    dispose()
  })

  // ID は属性（href / id）にある。Angular が行ノードを同名の別ノートブックへ付け替えると
  // 変化は属性だけになり、childList / characterData では観測できない。
  it('re-syncs a checkbox when only the notebook id attribute of a row changes', async () => {
    const dispose = init()
    const [a] = boxes()
    a.checked = true
    a.dispatchEvent(new Event('change'))
    document.querySelector('a.project-table-title')!.setAttribute('href', '/notebook/id-c')
    await tick()
    expect(a.getAttribute(CHECKBOX_ATTR)).toBe('id:id-c')
    expect(a.checked).toBe(false)
    dispose()
  })
})

// issue #33 / #34: 行挿入〜タイトル充填の間、ID も取れない行は選択キーが空（`title:`）になる。
// 規則は 1 つ: 「キーが空の行」はチェックボックス注入・すべて選択・削除対象のどれにも入れない。
// ID が取れていればキーは有効なので、タイトルが空でもすべての経路で通常の行として扱う。
describe('rows whose title is not filled yet (#33 / #34)', () => {
  const ROW = (title: string) => `
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">${title}</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>`
  const LIST_WITH_EMPTY = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  ${ROW('A')}${ROW('')}
</tbody></table></project-table></div>`
  const flush = () => new Promise((r) => setTimeout(r, 0))

  beforeEach(() => { document.body.innerHTML = '' })

  it('select-all does not put the empty key into the store (count matches the checkboxes)', () => {
    const root = document.createElement('div')
    root.innerHTML = LIST_WITH_EMPTY
    const dispose = init(root)
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(1)
    expect(document.querySelector('[data-nlk="bar-count"]')!.textContent).toMatch(/1/)
    dispose()
  })

  it('buildTargets never targets a row whose key is empty even if the empty key is in the store', () => {
    document.body.innerHTML = LIST_WITH_EMPTY
    const store = new SelectionStore()
    store.set('title:', true)
    store.set('title:A', true)
    expect(buildTargets(store).map((t) => t.key)).toEqual(['title:A'])
  })

  // 除外するのは「キーが空になる行」だけ。ID が取れていればキーは有効なので、選択済みの行の
  // タイトルが一時的に空になっても対象から無言で落とさない（codex P2）。
  it('keeps a selected id-keyed row as a target even while its title is transiently empty', () => {
    document.body.innerHTML = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><a class="project-table-title" href="/notebook/abc" title=""></a></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table></div>`
    const store = new SelectionStore()
    store.set('id:abc', true)
    expect(buildTargets(store).map((t) => t.key)).toEqual(['id:abc'])
  })

  // 件数タイプ確認を既に経ている（10 件以上）なら、確認中に「選択 = 全件」へ変わっても中止しない。
  // 中止するのは確認強度が 弱 → 強 に変わった場合だけ（codex P3）。
  it('does not abort when select-all is reached after a strong confirm was already given', async () => {
    vi.mocked(deleteNotebooks).mockClear()
    vi.mocked(deleteNotebooks).mockResolvedValue({ succeeded: [], failed: [], aborted: false })
    const root = document.createElement('div')
    const names = Array.from({ length: 11 }, (_, i) => `N${i}`)
    root.innerHTML = `<div class="all-projects-container"><project-table><table class="project-table"><tbody>${names.map(ROW).join('')}</tbody></table></project-table></div>`
    const dispose = init(root)
    const boxes = root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    for (let i = 0; i < 10; i++) { boxes[i].checked = true; boxes[i].dispatchEvent(new Event('change')) }
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    const input = document.querySelector<HTMLInputElement>('[data-nlk="confirm-dialog"] input')!
    input.value = '10'
    input.dispatchEvent(new Event('input'))
    // 未選択の 1 件が消えて「選択 = 全件」になる
    root.querySelectorAll('tr[mat-row]')[10].remove()
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await flush()
    expect(deleteNotebooks).toHaveBeenCalledTimes(1)
    dispose()
  })

  // チェックボックスの表示は常にストアに従う。タイトルが一時的に空の行でも「すべて解除」で
  // チェックが残ると、見た目は選択済みなのに削除されない表示ずれが固定化する（codex P2）。
  it('clear-all unchecks a selected row even while its title is transiently empty', () => {
    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)
    const boxA = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}="title:A"]`)!
    boxA.checked = true
    boxA.dispatchEvent(new Event('change'))
    root.querySelector('.project-table-title')!.textContent = ''
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-clear-all"]')!.click()
    expect(boxA.checked).toBe(false)
    dispose()
  })

  // タイトルは title 属性を優先して読む（§8.14）。属性だけが後から充填される更新順でも
  // observer が拾って注入・件数を同期し直す（codex P2）。
  it('injects for an id-keyed row with an empty title and fills the label when only the title attribute arrives', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><a class="project-table-title" href="/notebook/abc" title=""></a></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table></div>`
    const dispose = init(root)
    // ID が取れているのでチェックボックスは出る（すべて選択の対象と一致させる）。読み上げ名はまだ無い。
    const box = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}="id:abc"]`)
    expect(box).not.toBeNull()
    expect(box!.hasAttribute('aria-label')).toBe(false)
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-select-all"]')!.click()
    expect(box!.checked).toBe(true)
    root.querySelector('.project-table-title')!.setAttribute('title', 'Late')
    await flush()
    expect(box!.getAttribute('aria-label')).toBe('Late')
    expect(box!.checked).toBe(true)
    dispose()
  })

  // 確認時点では一部選択（件数タイプ確認なし）でも、確認中に未選択行が選択可能でなくなり
  // 「選択 = 全件」になったら、弱い確認のまま進めない（codex P2）。
  it('aborts when the selection became select-all while the plain confirm dialog was open', async () => {
    vi.mocked(deleteNotebooks).mockClear()
    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = init(root)
    const boxes = root.querySelectorAll<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    boxes[0].checked = true
    boxes[0].dispatchEvent(new Event('change'))
    document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')!.click()
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()
    // 未選択の B が一覧から消える（別タブでの削除など）→ 選択 A が全件になる
    root.querySelectorAll('tr[mat-row]')[1].remove()
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.click()
    await flush()
    expect(deleteNotebooks).not.toHaveBeenCalled()
    expect(document.querySelector('[data-nlk="bar-progress"]')!.textContent)
      .toMatch(/削除対象の一覧が変わった|notebooks to delete changed/)
    dispose()
  })

  // #34: ガードのコメントが主張する「タイトル充填時の mutation で observer が再発火して注入される」
  // 自己修復パスそのもの。空 span へのテキスト充填は childList レコード（テキストノード追加）になる。
  it('injects the checkbox once the empty title is filled in (observer self-heal)', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    root.innerHTML = LIST_WITH_EMPTY
    const dispose = init(root)
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(1)
    const titles = root.querySelectorAll('.project-table-title')
    titles[1].appendChild(document.createTextNode('Late'))
    await flush()
    expect(root.querySelector(`[${CHECKBOX_ATTR}="title:Late"]`)).not.toBeNull()
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
    dispose()
  })
})
