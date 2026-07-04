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
// 注: opts.signal は deleter/importer と同じ中断規約の布石。現状クリップ経路
// （defaultCreateRunner）は fire-and-forget で signal を渡さないため未配線（reserved）。
// 将来 start() の dispose ライフサイクルと結ぶ際に配線する。
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

export interface AudioOverviewDeps {
  getAudioOverviewButton(): HTMLElement | null
  click(el: HTMLElement): void
  // 生成が開始したか（Studio に「生成しています」等が出たか）。二重生成防止 ＆ 成功検知に使う。
  isGenerating(): boolean
  waitFor: typeof WaitFor
  // 各クリック後に生成開始を待つ時間（ms）。既定 30s（生成中表示の遅延に対する二重生成防止マージン。issue #60）。
  timeout?: number
}

// タイルが present かつ enabled になるまで待つ内部タイムアウト（ms）。
const TILE_WAIT_MS = 15000
// 生成開始を確認できるまでの最大クリック回数。ソース解析完了前の「早すぎクリック」は空振りするため、
// 間隔を空けて再試行する（各回 timeout だけ生成開始を待つ）。5 回 × 30s ≒ 150s を上限に解析完了を待つ。
const MAX_ATTEMPTS = 5

// #51: ノートブック作成後に音声解説（Audio Overview）の生成を開始する。
// 生成タイル（div[role=button]）はソース解析が終わるまで押しても空振りする（実機確認・§8.7）。
// そこで「タイルが present+enabled → クリック → 生成開始を待つ」を、生成開始を検知できるまで
// 最大 MAX_ATTEMPTS 回再試行する。各クリック前に isGenerating を確認し、既に生成中なら再クリックしない
// （二重生成防止）。クリックは主ワールド経由（deps.click = requestMainWorldClick）。
// best-effort: 失敗（要素不在 / 生成開始せず / 中断）は例外を投げず false を返し console.warn する。
export async function triggerAudioOverview(
  deps: AudioOverviewDeps,
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const { signal } = opts
  const clickInterval = deps.timeout ?? 30000
  const enabledTile = () => {
    const b = deps.getAudioOverviewButton()
    if (!b) return null
    // タイルは div[role="button"]。無効化は native disabled か aria-disabled="true" で表現される。
    const disabled = (b as HTMLButtonElement).disabled === true || b.getAttribute('aria-disabled') === 'true'
    return disabled ? null : b
  }
  try {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      // 既に生成中（前回クリックが効いた）なら二重クリックしない
      if (deps.isGenerating()) return true
      const btn = await deps.waitFor(enabledTile, { timeout: TILE_WAIT_MS, signal })
      deps.click(btn)
      // クリック後、生成開始を clickInterval だけ待つ。開始すれば成功、しなければ（早すぎクリック）再試行。
      try {
        await deps.waitFor(() => (deps.isGenerating() ? true : null), { timeout: clickInterval, signal })
        return true
      } catch {
        // 生成が始まらない → ループ先頭へ戻り、解析完了を待って再クリック
      }
    }
    console.warn('notebooklmkit: audio overview did not start generating after retries')
    return false
  } catch {
    // タイルが見つからない / 無効のまま / 中断。生成開始の唯一の観測点として必ずログを残す。
    console.warn('notebooklmkit: audio overview trigger did not fire (tile not found or stayed disabled)')
    return false
  }
}
