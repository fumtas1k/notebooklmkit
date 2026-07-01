import type { createT } from './i18n'

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

  return new Promise<boolean>((resolve) => {
    const overlay = document.createElement('div')
    overlay.setAttribute('data-nlk', 'confirm-dialog')
    overlay.className = 'nlk-overlay'

    const box = document.createElement('div')
    box.className = 'nlk-dialog'

    const title = document.createElement('h2')
    title.textContent = t('confirmTitle', { count })

    const body = document.createElement('p')
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

    const cleanup = (result: boolean) => {
      overlay.remove()
      resolve(result)
    }
    ok.addEventListener('click', () => {
      if (strong && !isConfirmInputValid(input!.value, count)) return
      cleanup(true)
    })
    cancel.addEventListener('click', () => cleanup(false))

    box.append(cancel, ok)
    overlay.appendChild(box)
    root.appendChild(overlay)
    input?.focus()
  })
}
