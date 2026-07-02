import type { createT } from './i18n'
import './ui/confirm-dialog.css'

export const STRONG_CONFIRM_THRESHOLD = 10

export function needsStrongConfirm(count: number, isSelectAll: boolean): boolean {
  return isSelectAll || count >= STRONG_CONFIRM_THRESHOLD
}

export function isConfirmInputValid(input: string, count: number): boolean {
  return input.trim() === String(count)
}

export function confirmDeletion(opts: {
  count: number
  isSelectAll: boolean
  t: ReturnType<typeof createT>
  root?: HTMLElement
}): Promise<boolean> {
  const { count, isSelectAll, t, root = document.body } = opts
  const strong = needsStrongConfirm(count, isSelectAll)
  const previouslyFocused = document.activeElement as HTMLElement | null

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div')
    overlay.setAttribute('data-nlk', 'confirm-dialog')
    overlay.className = 'nlk-overlay'

    const box = document.createElement('div')
    box.className = 'nlk-dialog'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    box.setAttribute('aria-labelledby', 'nlk-confirm-title')
    box.setAttribute('aria-describedby', 'nlk-confirm-body')

    const title = document.createElement('h2')
    title.id = 'nlk-confirm-title'
    title.textContent = t('confirmTitle', { count })

    const body = document.createElement('p')
    body.id = 'nlk-confirm-body'
    body.textContent = t('confirmBody')

    box.append(title, body)

    let input: HTMLInputElement | null = null
    const ok = document.createElement('button')
    ok.setAttribute('data-nlk', 'confirm-ok')
    ok.textContent = t('deleteNow')

    if (strong) {
      const label = document.createElement('label')
      label.textContent = t('confirmType', { count })
      input = document.createElement('input')
      input.setAttribute('data-nlk', 'confirm-input')
      input.type = 'text'
      ok.disabled = true
      input.addEventListener('input', () => {
        ok.disabled = !isConfirmInputValid(input!.value, count)
      })
      label.appendChild(input)
      box.appendChild(label)
    }

    const cancel = document.createElement('button')
    cancel.setAttribute('data-nlk', 'confirm-cancel')
    cancel.textContent = t('cancel')

    let settled = false
    const cleanup = (result: boolean) => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKeydown, true)
      overlay.remove()
      previouslyFocused?.focus?.()
      resolve(result)
    }
    const onKeydown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        ev.stopPropagation()
        cleanup(false)
        return
      }
      if (ev.key === 'Tab') {
        // フォーカストラップ: aria-modal だけでは Tab は塞げないため、
        // ダイアログ内のフォーカス可能要素の間で手動循環させる。背後の
        // チェックボックス等へ到達して選択を変更されるのを防ぐ（issue #13）。
        ev.preventDefault()
        ev.stopPropagation()
        const els = Array.from(
          box.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'),
        )
        if (els.length === 0) return
        const idx = els.indexOf(document.activeElement as HTMLElement)
        // idx === -1（フォーカスがダイアログ外）は先頭 / 末尾へ引き戻す
        const next = ev.shiftKey
          ? els[(idx <= 0 ? els.length : idx) - 1]
          : els[(idx + 1) % els.length]
        next.focus()
        return
      }
      if (ev.key === 'Enter') {
        // Swallow Enter unconditionally while the dialog is open, even when
        // the strong-confirm validation guard blocks the actual confirm, so
        // the keystroke never leaks through to NotebookLM's page behind the
        // modal.
        ev.preventDefault()
        ev.stopPropagation()
        if (strong && !isConfirmInputValid(input!.value, count)) return
        cleanup(true)
      }
    }
    document.addEventListener('keydown', onKeydown, true)

    ok.addEventListener('click', () => {
      if (strong && !isConfirmInputValid(input!.value, count)) return
      cleanup(true)
    })
    cancel.addEventListener('click', () => cleanup(false))
    // Clicking the backdrop (the overlay itself, not the dialog box) cancels.
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) cleanup(false)
    })

    box.append(cancel, ok)
    overlay.appendChild(box)
    root.appendChild(overlay)
    ;(input ?? cancel).focus()
  })
}
