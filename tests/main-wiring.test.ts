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

describe('buildTargets', () => {
  beforeEach(() => { document.body.innerHTML = LIST })
  it('returns targets for currently selected keys only', () => {
    const store = new SelectionStore()
    store.set('title:A', true)
    const targets = buildTargets(store)
    expect(targets.map((t) => t.title)).toEqual(['A'])
    expect(targets.map((t) => t.key)).toEqual(['title:A'])
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
    expect(progress!.textContent).toMatch(/選択が変更された|selection changed/)

    // 中止後は deleting フラグが解除され、再度削除を開始できる
    deleteBtn!.click()
    expect(document.querySelectorAll('[data-nlk="confirm-dialog"]').length).toBe(1)
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
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
})
