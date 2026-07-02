import { describe, it, expect, beforeEach } from 'vitest'
import {
  needsStrongConfirm, isConfirmInputValid, confirmDeletion, STRONG_CONFIRM_THRESHOLD,
} from '../src/content/confirm-dialog'
import { createT } from '../src/content/i18n'

const t = createT('en')

describe('confirm logic', () => {
  it('threshold is 10', () => {
    expect(STRONG_CONFIRM_THRESHOLD).toBe(10)
  })
  it('requires strong confirm for >=10 or select-all', () => {
    expect(needsStrongConfirm(9, false)).toBe(false)
    expect(needsStrongConfirm(10, false)).toBe(true)
    expect(needsStrongConfirm(2, true)).toBe(true)
  })
  it('validates typed count', () => {
    expect(isConfirmInputValid('47', 47)).toBe(true)
    expect(isConfirmInputValid(' 47 ', 47)).toBe(true)
    expect(isConfirmInputValid('46', 47)).toBe(false)
    expect(isConfirmInputValid('', 47)).toBe(false)
  })
})

describe('confirmDeletion (normal, small count)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('resolves true when confirm clicked', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const btn = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    expect(btn.disabled).toBe(false) // small count: enabled immediately
    btn.click()
    expect(await p).toBe(true)
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull() // cleaned up
  })

  it('resolves false when cancel clicked', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    expect(await p).toBe(false)
  })
})

describe('confirmDeletion (strong, type-to-confirm)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('keeps confirm disabled until typed count matches', async () => {
    const p = confirmDeletion({ count: 12, isSelectAll: false, t })
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    const input = document.querySelector<HTMLInputElement>('[data-nlk="confirm-input"]')!
    expect(ok.disabled).toBe(true)
    input.value = '11'; input.dispatchEvent(new Event('input'))
    expect(ok.disabled).toBe(true)
    input.value = '12'; input.dispatchEvent(new Event('input'))
    expect(ok.disabled).toBe(false)
    ok.click()
    expect(await p).toBe(true)
  })

  it('ignores a dispatched click on the confirm button when the typed count does not match', () => {
    confirmDeletion({ count: 12, isSelectAll: false, t })
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    // bypass the disabled attribute the way a rogue script could
    ok.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    // guard should prevent resolution: overlay is still present, not cleaned up
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()
    // 後片付け: pending の confirmDeletion を解決し、document キャプチャの
    // keydown リスナーを残さない（以降のテストへのリーク防止）。
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })
})

describe('confirmDeletion (a11y: labelling)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('dialog box has aria-labelledby and aria-describedby pointing at existing elements', () => {
    confirmDeletion({ count: 3, isSelectAll: false, t })
    const box = document.querySelector<HTMLElement>('.nlk-dialog')!
    const labelledBy = box.getAttribute('aria-labelledby')
    const describedBy = box.getAttribute('aria-describedby')
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(labelledBy!)).not.toBeNull()
    expect(document.getElementById(describedBy!)).not.toBeNull()
  })
})

describe('confirmDeletion (a11y: escape / backdrop)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('cancels on Escape keydown', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(await p).toBe(false)
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })

  it('cancels on overlay backdrop click, but not on inner dialog box click', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const overlay = document.querySelector<HTMLElement>('[data-nlk="confirm-dialog"]')!
    const box = overlay.querySelector<HTMLElement>('.nlk-dialog')!

    // clicking the inner dialog box must NOT cancel
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()

    // clicking the overlay backdrop itself cancels
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(await p).toBe(false)
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })
})

describe('confirmDeletion (a11y: Enter to confirm)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('Enter confirms a normal (small-count) dialog when focus is not on Cancel', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(await p).toBe(true)
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })

  it('Enter cancels (does not confirm) while the Cancel button has focus', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    // 通常ダイアログの初期フォーカスは Cancel
    expect(document.activeElement).toBe(document.querySelector('[data-nlk="confirm-cancel"]'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(await p).toBe(false)
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })

  it('Enter does not confirm a strong dialog while the typed count does not match', async () => {
    const p = confirmDeletion({ count: 12, isSelectAll: false, t })
    const input = document.querySelector<HTMLInputElement>('[data-nlk="confirm-input"]')!

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()

    input.value = '12'
    input.dispatchEvent(new Event('input'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(await p).toBe(true)
  })
})

describe('confirmDeletion (keys do not leak to the page behind the modal)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('stops Enter from bubbling past the dialog (normal dialog)', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const box = document.querySelector<HTMLElement>('.nlk-dialog')!
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.focus()

    let bodyHeard = false
    document.body.addEventListener('keydown', () => { bodyHeard = true })

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(await p).toBe(true)
    expect(bodyHeard).toBe(false)
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })

  it('stops Enter from bubbling past the dialog even when strong-confirm validation blocks the confirm', async () => {
    const p = confirmDeletion({ count: 12, isSelectAll: false, t })
    const input = document.querySelector<HTMLInputElement>('[data-nlk="confirm-input"]')!

    let bodyHeard = false
    document.body.addEventListener('keydown', () => { bodyHeard = true })

    // typed count does not match -> Enter must not confirm...
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()
    // ...but it still must not leak through to the page.
    expect(bodyHeard).toBe(false)

    input.value = '12'
    input.dispatchEvent(new Event('input'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(await p).toBe(true)
  })

  it('stops Escape from bubbling past the dialog', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const box = document.querySelector<HTMLElement>('.nlk-dialog')!

    let bodyHeard = false
    document.body.addEventListener('keydown', () => { bodyHeard = true })

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))

    expect(await p).toBe(false)
    expect(bodyHeard).toBe(false)
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })
})

describe('confirmDeletion (focus trap: Tab stays inside the dialog)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  const tab = (shift = false) =>
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true,
    }))

  it('cycles Tab through cancel -> ok -> cancel in a normal dialog', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const cancel = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    expect(document.activeElement).toBe(cancel) // 初期フォーカス
    tab(); expect(document.activeElement).toBe(ok)
    tab(); expect(document.activeElement).toBe(cancel) // 末尾から先頭へ循環
    cancel.click()
    expect(await p).toBe(false)
  })

  it('cycles Shift+Tab backwards (wraps from first to last)', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const cancel = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    tab(true); expect(document.activeElement).toBe(ok) // cancel（先頭）から逆方向 → 末尾へ
    tab(true); expect(document.activeElement).toBe(cancel)
    cancel.click()
    expect(await p).toBe(false)
  })

  it('skips the disabled confirm button in a strong dialog, includes it once input is valid', async () => {
    const p = confirmDeletion({ count: 12, isSelectAll: false, t })
    const input = document.querySelector<HTMLInputElement>('[data-nlk="confirm-input"]')!
    const cancel = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!
    const ok = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!
    // DOM 順のフォーカス候補は input, cancel, ok（ok は disabled の間は候補外）
    expect(document.activeElement).toBe(input) // strong は input が初期フォーカス
    tab(); expect(document.activeElement).toBe(cancel)
    tab(); expect(document.activeElement).toBe(input) // ok は disabled → スキップして循環
    input.value = '12'
    input.dispatchEvent(new Event('input')) // ok が有効になる
    tab(); expect(document.activeElement).toBe(cancel)
    tab(); expect(document.activeElement).toBe(ok) // 有効化後は循環に含まれる
    cancel.click()
    expect(await p).toBe(false)
  })

  it('pulls focus back into the dialog when focus escaped outside', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    outside.focus() // フォーカスがダイアログ外へ逃げた状態を再現
    expect(document.activeElement).toBe(outside)
    tab()
    expect(document.activeElement)
      .toBe(document.querySelector('[data-nlk="confirm-cancel"]')) // 先頭へ引き戻す
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    expect(await p).toBe(false)
  })

  it('stops Tab from bubbling past the dialog', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const box = document.querySelector<HTMLElement>('.nlk-dialog')!
    let bodyHeard = false
    document.body.addEventListener('keydown', () => { bodyHeard = true })
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(bodyHeard).toBe(false)
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    expect(await p).toBe(false)
  })

  it('pulls focus back to the first element (not the delete button) on Shift+Tab from outside', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    outside.focus()
    tab(true)
    // 逆方向でも末尾（削除実行ボタン）ではなく先頭へ着地する
    expect(document.activeElement)
      .toBe(document.querySelector('[data-nlk="confirm-cancel"]'))
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!.click()
    expect(await p).toBe(false)
  })

  it('lets modifier-key Tab combos pass through without moving focus', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    const cancel = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-cancel"]')!
    expect(document.activeElement).toBe(cancel)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(cancel) // 横取りせず循環もしない
    cancel.click()
    expect(await p).toBe(false)
  })
})

describe('confirmDeletion (IME composition keys are ignored)', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('does not confirm on Enter during IME composition', () => {
    confirmDeletion({ count: 3, isSelectAll: false, t })
    document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')!.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }))
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()
    // 後片付け: リスナーを残さない
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })

  it('does not close on Escape during IME composition', () => {
    confirmDeletion({ count: 12, isSelectAll: false, t })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }))
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).not.toBeNull()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('[data-nlk="confirm-dialog"]')).toBeNull()
  })
})
