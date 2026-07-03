import type { ImportProgress, ImportResult } from '../types'
import type { waitFor as WaitFor } from './dom-utils'
import { AbortError } from './dom-utils'

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

// ①〜④（挿入クリック前）は signal を渡し、Stop / SPA teardown で即座に中断できる
// ようにする（インポートは非破壊のため、確定クリック前の中断は安全）。
// ⑤ の完了待ちだけは signal を渡さない: 挿入クリック後に中断すると、実際には追加
// されたソースを「未処理」と誤記録して再実行時の重複インポートを招くため、
// コミット後は完了まで見届ける（以降の中断はループの URL 境界で効く）。
// タイムアウト既定はページ取得を伴うため削除（5s）より長めの 10s。
async function importOne(url: string, deps: ImporterDeps, signal?: AbortSignal): Promise<void> {
  const timeout = deps.timeout ?? 10000
  const w = deps.waitFor

  // ① ソース追加ボタン（前件のダイアログが閉じた直後の再描画に備えて出現待ち）
  const add = await w(() => deps.getAddSourceButton(), { timeout, signal })
  deps.click(add)
  // ② ダイアログ内の「ウェブサイト」チップ。チップは容器より遅れて描画されるため、
  // 容器ではなくチップ自体の出現を待つ（deleter の Delete ボタン待ちと同パターン）。
  const opened = await w(() => {
    const dialog = deps.getSourceDialog()
    const chip = dialog ? deps.getWebsiteChip(dialog) : null
    return dialog && chip ? { dialog, chip } : null
  }, { timeout, signal })
  deps.click(opened.chip)
  // ③ URL 入力欄に値を設定（Angular に届くよう input イベント発火込みの setInputValue）
  const input = await w(() => deps.getUrlInput(opened.dialog), { timeout, signal })
  deps.setInputValue(input, url)
  // ④ 挿入ボタンが「存在して有効」になるまで待つ（未入力の間は disabled のため、
  // 存在だけ見て押すと no-op になる）
  const submit = await w(() => {
    const btn = deps.getSubmitButton(opened.dialog)
    if (!btn) return null
    return (btn as HTMLButtonElement).disabled ? null : btn
  }, { timeout, signal })
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
      await importOne(url, deps, signal)
      result.succeeded.push(url)
    } catch (err) {
      if (err instanceof AbortError) {
        // 挿入クリック前の中断: この URL は未処理扱いで停止（失敗には数えない）
        result.aborted = true
        break
      }
      // 想定外 DOM / タイムアウト → 失敗を記録して停止（安全側）
      result.failed.push({ url, reason: err instanceof Error ? err.message : String(err) })
      break
    }
  }
  report()
  return result
}
