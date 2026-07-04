export class TimeoutError extends Error {
  constructor(message = 'waitFor timed out') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export class AbortError extends Error {
  constructor(message = 'aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

export function waitFor<T>(
  fn: () => T | null | undefined,
  opts: { timeout?: number; interval?: number; signal?: AbortSignal } = {},
): Promise<T> {
  const { timeout = 5000, interval = 100, signal } = opts
  return new Promise<T>((resolve, reject) => {
    const start = Date.now()
    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AbortError())
    }
    if (signal?.aborted) return reject(new AbortError())
    signal?.addEventListener('abort', onAbort, { once: true })

    const tick = () => {
      if (signal?.aborted) return
      let value: T | null | undefined
      try {
        value = fn()
      } catch (err) {
        signal?.removeEventListener('abort', onAbort)
        return reject(err)
      }
      if (value) {
        signal?.removeEventListener('abort', onAbort)
        return resolve(value)
      }
      if (Date.now() - start >= timeout) {
        signal?.removeEventListener('abort', onAbort)
        return reject(new TimeoutError())
      }
      timer = setTimeout(tick, interval)
    }
    tick()
  })
}

export function safeClick(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  el.click()
  return true
}

// Angular Material の div[role="button"]（音声解説の生成タイル等）は el.click()（合成クリック）では
// ハンドラが発火しないことがある。実ポインタ操作に近いイベント列を座標つきで送る。実 <button> でも
// 最後に click が発火するため安全に使える。2026-07-04 実機確認（docs/requirements.md §8.7）。
export function pointerClick(el: HTMLElement | null | undefined): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  // vitest の jsdom 環境では global `window` が実際の Window インスタンスでない
  // ことがあり、view にそれを渡すと MouseEvent/PointerEvent 構築が例外になる
  // （instanceof Window が false）。実ブラウザでは常に true なので view は
  // そのまま渡り、テスト環境でのみ view を省略（undefined = null 相当）する。
  const view = window instanceof Window ? window : undefined
  const base = {
    bubbles: true, cancelable: true, composed: true, view, button: 0,
    clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2),
  }
  const hasPointer = typeof PointerEvent === 'function'
  if (hasPointer) el.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true }))
  el.dispatchEvent(new MouseEvent('mousedown', base))
  if (hasPointer) el.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true }))
  el.dispatchEvent(new MouseEvent('mouseup', base))
  el.dispatchEvent(new MouseEvent('click', base))
  return true
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError())
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new AbortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// Angular のフォームバインディングは value 代入だけでは反応しないため、
// 代入後に bubbles する input イベントを発火して変更を通知する。
export function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
