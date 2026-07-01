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
}

// 1件の削除は最後まで完了させる（中断は「処理中の1件完了後」に効かせる方針のため、
// ここでは signal を渡さない。要素待ちは timeout で守る）。
async function deleteOne(target: NotebookTarget, deps: DeleterDeps): Promise<void> {
  const timeout = deps.timeout ?? 5000
  const w = deps.waitFor

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
  deps.click(confirm)
  // ⑤ 削除した行ノード自身が DOM から外れるまで待つ。
  // title で再検索すると同名の別行を拾い続けて誤タイムアウトするため、掴んだ行を見る。
  await w(() => (row.isConnected ? null : true), { timeout })
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
