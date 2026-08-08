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
  // 「音声解説をカスタマイズ」ダイアログの「生成」ボタン（#84 / §8.12）。
  // 出ない経路（旧 UI 等）では null を返す。
  getAudioGenerateButton(): HTMLElement | null
  click(el: HTMLElement): void
  // 生成が開始したか（Studio に「生成しています」等が出たか）。二重生成防止 ＆ 成功検知に使う。
  isGenerating(): boolean
  waitFor: typeof WaitFor
  // 各クリック後に生成開始を待つ時間（ms）。既定 30s（生成中表示の遅延に対する二重生成防止マージン。issue #60）。
  timeout?: number
  // ダイアログ出現から「生成」クリックまでの待機（#82 と同じ理由）。テストはフェイクを注入する。
  // signal を受けるのは、待機中の中断を取りこぼさないため（codex P2）。他の待機（waitFor）は
  // 既に signal を見ているので、ここだけ見ないと中断後に生成を開始してしまう。
  delay?(ms: number, signal?: AbortSignal): Promise<void>
  settleMs?: number
}

// カスタマイズダイアログの出現を待つ時間（ms）。開かない UI もあるため短めにし、
// 出なければ素通りして従来どおり生成開始を待つ。
const DIALOG_WAIT_MS = 5000
// ダイアログ出現直後のクリックは効かないことがある（#82 と同型）。実機では 400ms で足りた。
const DIALOG_SETTLE_MS = 400

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
  // 既定の待機も中断可能にする（注入されなかった場合の挙動を deps.delay と揃える）。
  const sleep =
    deps.delay ??
    ((ms: number, sig?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (sig?.aborted) return reject(new Error('aborted'))
        const onAbort = () => { clearTimeout(timer); reject(new Error('aborted')) }
        const timer = setTimeout(() => { sig?.removeEventListener('abort', onAbort); resolve() }, ms)
        sig?.addEventListener('abort', onAbort, { once: true })
      }))
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
      // W1封じ（#60）: プリチェックから enabled タイル待ちの間に生成が始まっていたら押さない。
      if (deps.isGenerating()) return true
      deps.click(btn)
      // 2026-08 の UI 刷新で、タイルは即生成せず「音声解説をカスタマイズ」ダイアログを開く
      // （§8.12 / #84）。開いたらその「生成」を押す。ダイアログが出ない経路（旧 UI / 将来の
      // 変更）でも壊れないよう、出現しなければ素通りして従来どおり生成開始を待つ。
      const genBtn = await deps
        .waitFor(() => deps.getAudioGenerateButton(), { timeout: DIALOG_WAIT_MS, signal })
        .catch(() => null)
      if (genBtn) {
        // W1封じと同様、待っている間に生成が始まっていたら押さない（二重生成防止）。
        if (deps.isGenerating()) return true
        // #82 と同型: 出現直後は押しても効かないことがあるため落ち着かせてから押す。
        await sleep(deps.settleMs ?? DIALOG_SETTLE_MS, signal)
        // 待機中に中断された場合は押さない。生成は取り消せないので、中断は
        // 「押す直前」まで効かせる（codex P2）。sleep 自体が中断を投げない
        // 実装を注入されても取りこぼさないよう、ここでも確認する。
        if (signal?.aborted) return false
        deps.click(genBtn)
      }
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
