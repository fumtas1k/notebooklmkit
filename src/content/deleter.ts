import type { DeleteProgress, DeleteResult, NotebookTarget } from '../types'
import type { waitFor as WaitFor } from './dom-utils'

export interface DeleterDeps {
  findRow(t: NotebookTarget): HTMLElement | null
  getMoreButton(row: HTMLElement): HTMLElement | null
  getDeleteMenuItem(): HTMLElement | null
  getConfirmDialog(): HTMLElement | null
  getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null
  click(el: HTMLElement): void
  waitFor: typeof WaitFor
  timeout?: number
  // 確認ダイアログの「削除」ボタンを見つけてから押すまでの待機（§8.11 / #82）。
  // テストは実時間を待たないようフェイクを注入する。
  delay?(ms: number): Promise<void>
  settleMs?: number
  maxAttempts?: number
}

// 確認ダイアログ出現直後のクリックは、ダイアログを閉じるだけで削除が実行されない
// （2026-08-08 実機確認・§8.11）。DOM / CSS 上はボタン出現時点で既に opacity:1 の
// 完成状態に見え、待つべきシグナルが観測できないため固定待機で凌ぐ。
const DEFAULT_SETTLE_MS = 400
// settle 待機だけでは環境差（マシン速度・一覧の重さ）で取りこぼし得るため、
// 「行がまだ在る＝削除されていない」ことを確認した上でフローごとやり直す。
const DEFAULT_MAX_ATTEMPTS = 3

// 1件の削除は最後まで完了させる（中断は「処理中の1件完了後」に効かせる方針のため、
// ここでは signal を渡さない。要素待ちは timeout で守る）。
async function deleteOne(target: NotebookTarget, deps: DeleterDeps): Promise<void> {
  const timeout = deps.timeout ?? 5000
  const settleMs = deps.settleMs ?? DEFAULT_SETTLE_MS
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const w = deps.waitFor
  const sleep = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ① 対象行を（再描画後も）確定
    const row = await w(() => deps.findRow(target), { timeout })
    // ② 操作メニューを開く
    const more = deps.getMoreButton(row)
    if (!more) throw new Error('more button not found')
    deps.click(more)
    // ③ メニューの「削除」
    const del = await w(() => deps.getDeleteMenuItem(), { timeout })
    deps.click(del)
    // ④ 確認ダイアログの Delete ボタン。
    // mat-dialog-container は先に描画され、中の Delete ボタンは少し遅れて現れるため、
    // ダイアログ容器ではなく「ボタン自体」の出現を待つ（同期取得だと null になる）。
    const confirm = await w(() => {
      const dialog = deps.getConfirmDialog()
      return dialog ? deps.getConfirmDeleteButton(dialog) : null
    }, { timeout })
    // ④' 出現＝操作可能ではない。ここで待たずに押すと、ダイアログは閉じるのに
    // 削除は実行されない（§8.11 / #82）。待つべき DOM シグナルが無いため固定待機。
    await sleep(settleMs)
    deps.click(confirm)
    // ⑤ 削除した行ノード自身が DOM から外れるまで待つ。
    // title で再検索すると同名の別行を拾い続けて誤タイムアウトするため、掴んだ行を見る。
    try {
      await w(() => (row.isConnected ? null : true), { timeout })
      return
    } catch (err) {
      lastError = err as Error
      // 行が消えているのに待機が失敗した場合は、状況が読めないので再試行しない
      // （成功済みかもしれないものを押し直すと、同名の別行を巻き込み得る）。
      if (!row.isConnected) throw lastError
      // ここに来る = ④' の待機でも足りず「閉じただけ」だった。行が残っている
      // ＝ 未削除が確定しているので、フローごとやり直しても二重削除にならない。
      if (attempt >= maxAttempts) break
      // 次の試行で ② の3点メニューを押せるよう、ダイアログが引くのを待つ。
      // 閉じきらなくても続行はするので失敗は握りつぶす。
      await w(() => (deps.getConfirmDialog() ? null : true), { timeout }).catch(() => {})
    }
  }
  throw lastError ?? new Error('delete failed')
}

export async function deleteNotebooks(
  targets: NotebookTarget[],
  deps: DeleterDeps,
  opts: { onProgress?: (p: DeleteProgress) => void; signal?: AbortSignal } = {},
): Promise<DeleteResult> {
  const { onProgress, signal } = opts
  const result: DeleteResult = { succeeded: [], failed: [], aborted: false }
  const total = targets.length
  const report = (currentTitle?: string) =>
    onProgress?.({ total, completed: result.succeeded.length, failed: result.failed.length, currentTitle })

  for (const target of targets) {
    // 中断は各アイテムの境界でのみ判定（処理中の1件は完了させる）
    if (signal?.aborted) {
      result.aborted = true
      break
    }
    report(target.title)
    try {
      await deleteOne(target, deps)
      result.succeeded.push(target.key)
    } catch (err) {
      // 想定外 DOM / タイムアウト → 失敗を記録して停止（安全側）
      result.failed.push({ key: target.key, reason: (err as Error).message })
      break
    }
  }
  report()
  return result
}
