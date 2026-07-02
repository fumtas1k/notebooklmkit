import type { ImportProgress, ImportResult } from '../types'
import type { waitFor as WaitFor } from './dom-utils'

export interface ImporterDeps {
  getAddSourceButton(): HTMLElement | null
  getSourceDialog(): HTMLElement | null
  getWebsiteChip(dialog: HTMLElement): HTMLElement | null
  getUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null
  getSubmitButton(dialog: HTMLElement): HTMLElement | null
  setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void
  click(el: HTMLElement): void
  waitFor: typeof WaitFor
  timeout?: number
}

// 1件のインポートは最後まで完了させる（中断は URL 境界でのみ判定。deleter と同じ規約のため、
// ここでは signal を渡さない。要素待ちは timeout で守る）。
// タイムアウト既定はページ取得を伴うため削除（5s）より長めの 10s。
async function importOne(url: string, deps: ImporterDeps): Promise<void> {
  const timeout = deps.timeout ?? 10000
  const w = deps.waitFor

  // ① ソース追加ボタン（前件のダイアログが閉じた直後の再描画に備えて出現待ち）
  const add = await w(() => deps.getAddSourceButton(), { timeout })
  deps.click(add)
  // ② ダイアログ内の「ウェブサイト」チップ。チップは容器より遅れて描画されるため、
  // 容器ではなくチップ自体の出現を待つ（deleter の Delete ボタン待ちと同パターン）。
  const opened = await w(() => {
    const dialog = deps.getSourceDialog()
    const chip = dialog ? deps.getWebsiteChip(dialog) : null
    return dialog && chip ? { dialog, chip } : null
  }, { timeout })
  deps.click(opened.chip)
  // ③ URL 入力欄に値を設定（Angular に届くよう input イベント発火込みの setInputValue）
  const input = await w(() => deps.getUrlInput(opened.dialog), { timeout })
  deps.setInputValue(input, url)
  // ④ 挿入ボタンが「存在して有効」になるまで待つ（未入力の間は disabled のため、
  // 存在だけ見て押すと no-op になる）
  const submit = await w(() => {
    const btn = deps.getSubmitButton(opened.dialog)
    if (!btn) return null
    return (btn as HTMLButtonElement).disabled ? null : btn
  }, { timeout })
  deps.click(submit)
  // ⑤ 掴んだダイアログノード自身が DOM から外れるまで待つ = 1件完了。
  // 再検索すると次の件のダイアログを拾い得るため、掴んだノードを見る。
  await w(() => (opened.dialog.isConnected ? null : true), { timeout })
}

export async function importUrls(
  urls: string[],
  deps: ImporterDeps,
  opts: { onProgress?: (p: ImportProgress) => void; signal?: AbortSignal } = {},
): Promise<ImportResult> {
  const { onProgress, signal } = opts
  const result: ImportResult = { succeeded: [], failed: [], aborted: false }
  const total = urls.length
  const report = (currentUrl?: string) =>
    onProgress?.({ total, completed: result.succeeded.length, failed: result.failed.length, currentUrl })

  for (const url of urls) {
    // 中断は各 URL の境界でのみ判定（処理中の1件は完了させる）
    if (signal?.aborted) {
      result.aborted = true
      break
    }
    report(url)
    try {
      await importOne(url, deps)
      result.succeeded.push(url)
    } catch (err) {
      // 想定外 DOM / タイムアウト → 失敗を記録して停止（安全側）
      result.failed.push({ url, reason: err instanceof Error ? err.message : String(err) })
      break
    }
  }
  report()
  return result
}
