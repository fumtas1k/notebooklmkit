import { PENDING_TTL_MS, type PendingImport } from '../types'

export interface PendingEnv {
  storageGet(key: string): Promise<Record<string, unknown>>
  storageRemove(key: string): Promise<void>
  now(): number
}

// pendingImport を評価し、自分のノートブック宛かつ期限内なら storage から取り出して
// run(url) を実行し、結果を report(ok) で返す。
// - 他ノートブック宛: 無視（別タブが拾うため storage は残す）。
// - 期限切れ: 掃除して無視。
// - 実行前にクリアして二重実行を防ぐ（mount 契機と run-pending 契機の競合対策）。
export async function handlePending(
  notebookId: string | null,
  env: PendingEnv,
  run: (url: string) => Promise<boolean>,
  report: (ok: boolean) => void,
): Promise<void> {
  if (!notebookId) return
  const got = await env.storageGet('pendingImport')
  const pending = got.pendingImport as PendingImport | undefined
  if (!pending) return
  if (pending.notebookId !== notebookId) return
  if (env.now() - pending.ts > PENDING_TTL_MS) {
    await env.storageRemove('pendingImport')
    return
  }
  await env.storageRemove('pendingImport')
  const ok = await run(pending.url)
  report(ok)
}
