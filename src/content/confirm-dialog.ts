import type { createT } from './i18n'
import './ui/confirm-dialog.css'

export const STRONG_CONFIRM_THRESHOLD = 10

// ダイアログ内でフォーカス循環の対象にする要素。Tab はダイアログ表示中
// document 全体で preventDefault されるため、ここに載らない要素はキーボードで
// 到達不能になる。ダイアログに新しい操作要素を足すときは必ずここを確認する。
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

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
      // IME 変換中の Enter / Escape（変換確定・変換キャンセル）はダイアログ
      // 操作として扱わない（keyCode 229 は Chrome の IME 経由キー）。Tab には
      // 適用しない —— 変換中でもトラップを維持し、フォーカス脱出を防ぐ。
      const composing = ev.isComposing || ev.keyCode === 229
      if (ev.key === 'Escape') {
        if (composing) return
        ev.preventDefault()
        ev.stopPropagation()
        cleanup(false)
        return
      }
      if (ev.key === 'Tab') {
        // 修飾キー付き（Ctrl/Alt/Meta+Tab）はフォーカス移動ではなく
        // ブラウザ / OS 側のショートカットのため素通しする。
        if (ev.ctrlKey || ev.altKey || ev.metaKey) return
        // フォーカストラップ: aria-modal だけでは Tab は塞げないため、
        // ダイアログ内のフォーカス可能要素の間で手動循環させる。背後の
        // チェックボックス等へ到達して選択を変更されるのを防ぐ（issue #13）。
        ev.preventDefault()
        ev.stopPropagation()
        const els = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
        if (els.length === 0) return // 全要素 disabled 化など将来変更への保険
        const idx = els.indexOf(document.activeElement as HTMLElement)
        const next = idx === -1
          ? els[0] // ダイアログ外からの引き戻しは方向に関係なく安全な先頭（input / cancel）へ
          : ev.shiftKey
            ? els[(idx === 0 ? els.length : idx) - 1]
            : els[(idx + 1) % els.length]
        next.focus()
        return
      }
      if (ev.key === 'Enter') {
        if (composing) return
        // ダイアログ表示中の Enter は、バブリング経路とこのリスナーより後に
        // 登録されたリスナーへは漏らさない（先行登録の document / window
        // キャプチャには届き得る）。フォーカス中のボタンの意図を尊重し、
        // Cancel フォーカス時はキャンセルとして扱う。
        ev.preventDefault()
        ev.stopPropagation()
        const active = document.activeElement
        if (active === cancel) {
          cleanup(false)
          return
        }
        // フォーカスがダイアログ外へ逃げている間の Enter は確定にしない
        // （取り消し不可の削除のため安全側。Tab で引き戻してから操作する）。
        if (active instanceof HTMLElement && !box.contains(active)) return
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
