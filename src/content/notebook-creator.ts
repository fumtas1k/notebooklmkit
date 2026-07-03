import type { waitFor as WaitFor } from './dom-utils'

export interface CreatorDeps {
  getCreateNewButton(): HTMLElement | null
  getSourceDialog(): HTMLElement | null
  getWebsiteChip(dialog: HTMLElement): HTMLElement | null
  getUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null
  getSubmitButton(dialog: HTMLElement): HTMLElement | null
  setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void
  click(el: HTMLElement): void
  waitFor: typeof WaitFor
  timeout?: number
}

// 「新規作成 → ウェブサイト → URL 挿入」で新規ノートブックを1つ作る。
// 複数 URL は改行連結で1回挿入（NotebookLM の URL 入力欄は複数 URL を1回受付）。
// 失敗（要素不在 / タイムアウト / 中断）は false を返す（呼び出し側が badge '!'）。
export async function createNotebookWithUrls(
  urls: string[],
  deps: CreatorDeps,
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  if (urls.length === 0) return false
  const { signal } = opts
  const timeout = deps.timeout ?? 15000
  const w = deps.waitFor
  try {
    // ① 新規作成ボタン出現待ち → クリック(新規作成 → ?addSource=true に遷移しダイアログ自動オープン）
    const createBtn = await w(() => deps.getCreateNewButton(), { timeout, signal })
    deps.click(createBtn)
    // ② ソース追加ダイアログ + 「ウェブサイト」チップ出現待ち → クリック
    const opened = await w(() => {
      const dialog = deps.getSourceDialog()
      const chip = dialog ? deps.getWebsiteChip(dialog) : null
      return dialog && chip ? { dialog, chip } : null
    }, { timeout, signal })
    deps.click(opened.chip)
    // ③ URL 入力欄出現待ち → 改行連結で設定（Angular に届くよう input イベント発火込み）
    const input = await w(() => deps.getUrlInput(opened.dialog), { timeout, signal })
    deps.setInputValue(input, urls.join('\n'))
    // ④ 挿入ボタンが「存在して有効」になるまで待つ → クリック
    const submit = await w(() => {
      const btn = deps.getSubmitButton(opened.dialog)
      if (!btn) return null
      return (btn as HTMLButtonElement).disabled ? null : btn
    }, { timeout, signal })
    deps.click(submit)
    // ⑤ 掴んだダイアログが DOM から外れる = 完了。挿入クリック後の完了待ちには signal を
    // 渡さない（コミット後に中断すると、実際には作られたノートブックを失敗と誤記録し得るため）。
    await w(() => (opened.dialog.isConnected ? null : true), { timeout })
    return true
  } catch {
    // タイムアウト / 中断（AbortError）/ 想定外 DOM → いずれも失敗（false）として安全側に倒す。
    return false
  }
}
