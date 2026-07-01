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

  it('Enter confirms a normal (small-count) dialog', async () => {
    const p = confirmDeletion({ count: 3, isSelectAll: false, t })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(await p).toBe(true)
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
