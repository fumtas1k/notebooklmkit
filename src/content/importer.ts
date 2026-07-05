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
// ⑤ の挿入クリックが「コミット点」。ここで onCommit を発火し、呼び出し側が
// 「コミット前失敗（安全にフォールバック可）」と「コミット後失敗（追加済みか不明・
// 重複回避のため停止）」を区別できるようにする。
// ⑥ の完了待ちだけは signal を渡さない: 挿入クリック後に中断すると、実際には追加
// されたソースを「未処理」と誤記録して再実行時の重複インポートを招くため、
// コミット後は完了まで見届ける（以降の中断はループの URL 境界で効く）。
// url は改行区切りで複数 URL を渡してよい（§8.6: ダイアログは1回で複数受付）。
// タイムアウト既定はページ取得を伴うため削除（5s）より長めの 10s。
async function importOne(
  url: string,
  deps: ImporterDeps,
  signal?: AbortSignal,
  onCommit?: () => void,
): Promise<void> {
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
  // ⑤ 挿入クリック＝コミット点
  deps.click(submit)
  onCommit?.()
  // ⑥ 掴んだダイアログノード自身が DOM から外れるまで待つ = 完了。
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
  const report = (currentUrl?: string, batch?: boolean) =>
    onProgress?.({
      total,
      completed: result.succeeded.length,
      failed: result.failed.length,
      currentUrl,
      batch,
    })

  // 2件以上は1ダイアログへ一括投入を試みる（§8.6: 改行区切りで複数 URL を1回受付）。
  if (urls.length >= 2) {
    if (signal?.aborted) {
      result.aborted = true
      report()
      return result
    }
    report(undefined, true)
    let committed = false
    try {
      await importOne(urls.join('\n'), deps, signal, () => { committed = true })
      result.succeeded.push(...urls)
      report()
      return result
    } catch (err) {
      if (err instanceof AbortError) {
        // コミット前の中断（① 〜 ④）: ソース未追加で停止
        result.aborted = true
        report()
        return result
      }
      if (committed) {
        // コミット後の失敗（⑥ タイムアウト等）: 追加済みか不明。重複回避のため
        // 全 urls を失敗記録して停止（フォールバックしない＝安全側）。
        const reason = err instanceof Error ? err.message : String(err)
        for (const url of urls) result.failed.push({ url, reason })
        report()
        return result
      }
      // コミット前の失敗: 何も追加されていない → 1件ずつフォールバックへ
    }
  }

  // 逐次フォールバック / 単一 URL パス（既存規約: 安全停止・URL 境界中断）
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
