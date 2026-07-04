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
