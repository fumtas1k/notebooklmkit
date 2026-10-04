import type { DeleteProgress, DeleteResult, NotebookTarget } from '../types'
import type { waitFor as WaitFor } from './dom-utils'

export interface DeleterDeps {
  findRow(t: NotebookTarget): HTMLElement | null
  getMoreButton(row: HTMLElement): HTMLElement | null
  // 押したトリガー（3点メニューボタン）が開いたメニューの「削除」項目。他の行のメニューの項目を
  // 返さないこと（#94）。
  getDeleteMenuItem(trigger: HTMLElement): HTMLElement | null
  getConfirmDialog(): HTMLElement | null
  getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null
  click(el: HTMLElement): void
  // 「削除」項目が出ずに停止するとき、開いた3点メニューを閉じる（#88）。best-effort。
  closeMenu?(): void
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

  // ① 対象行を確定する。
  // **この対象に対して一度でもクリックした後は引き直さない。** 再試行のたびにキーで引き直すと、
  // キーがタイトルにフォールバックしている場合（一意でない。types.ts）、1回目の削除が遅れて成立
  // した隙に同名の別行を掴み、選択していないノートブックを消し得る（TOCTOU / #82 codex P1）。
  // キーの種類に依らず、最初に押したノードだけを操作し続ける。
  let row: HTMLElement
  // ID キーの 1 回目で既に押した3点メニュー（下の openFirstMenu）。ループの 1 回目はこれを使う。
  let opened: HTMLElement | null = null
  if (target.id) {
    // ID キーの 1 回目は、行の特定と ② のクリックを分けない（#113）。行を先に掴んでから確認
    // ダイアログの消滅を待つと、待機（最長 timeout。直前の件の削除直後＝一覧の再描画と重なる）の
    // 間に、掴んだノードが別のノートブックへ再利用されても気付かずにそのメニューを押す。
    // そこで「確認ダイアログが無い」「その ID の行がいま引ける」を確かめた**同じ同期ブロック**で
    // メニューを押す（下の関数は同期。await を足さないこと）。条件が揃わない間は何も押さずに
    // ポーリングを続け、毎回 ID で引き直す —— まだ何も押していないので、掴み直しても #82 の
    // 不変条件は崩れない（ID は一意）。再描画中の一時的な null でも偽の失敗にならない。
    // 揃わないまま timeout したら、何も押さずに失敗として停止する。
    let dialogOpen = false
    const openFirstMenu = (): { row: HTMLElement; more: HTMLElement } | null => {
      dialogOpen = deps.getConfirmDialog() != null
      if (dialogOpen) return null
      const found = deps.findRow(target)
      if (!found) return null
      const more = deps.getMoreButton(found)
      if (!more) throw new Error('more button not found')
      deps.click(more)
      return { row: found, more }
    }
    const first = await w(openFirstMenu, { timeout }).catch((err) => {
      // 最後まで確認ダイアログが残っていたなら、由来不明のダイアログとして報告する（#94）。
      if (dialogOpen) throw new Error('a confirm dialog is already open (unknown origin)')
      throw err
    })
    row = first.row
    opened = first.more
  } else {
    // タイトルキーは一意でないので、同一性の確認も掴み直しもしない。一度だけ引く。
    // **既知の残存リスク（#113）**: このあとループ内で確認ダイアログの消滅を待ってから押すので、
    // 待機中に掴んだノードが別のノートブックへ再利用されても気付かずにそのメニューを押す。
    // タイトルでは「いまもこのノードか」を確かめる手段が無い（引き直すと同名の別行を拾い得る）。
    // ID を取れない DOM でだけ起きる（2026-10-04 時点は全行から ID を取得できる。§8.14）。
    row = await w(() => deps.findRow(target), { timeout })
  }

  let lastError: Error | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let more: HTMLElement
    if (opened) {
      // ID キーの 1 回目: ② は上で済んでいる。
      more = opened
      opened = null
    } else {
      // 前の試行が遅れて成立していれば完了。二度押ししない。
      // 「タイムアウト = 拒否」ではないため、各試行の入口で必ず確認する。
      if (!row.isConnected) return
      // 確認ダイアログは本文に対象のタイトルも ID も出さない（§8.14）ので、内容からは誰のものか
      // 判別できない。「開始時点で確認ダイアログが無い」ことを確かめ、以降に現れたものを自分が
      // 開いたものとして扱う（#94）。既に開いているなら由来が分からないので押さずに止まる。
      // 直前の件のダイアログが閉じ切っていないだけのこともある（行が先に消える）ので、消えるのは待つ。
      await w(() => (deps.getConfirmDialog() ? null : true), { timeout }).catch(() => {
        throw new Error('a confirm dialog is already open (unknown origin)')
      })
      // 掴んだノードが生きていても、Angular が別のノートブックへ再利用していれば isConnected は
      // true のまま（#87）。ID キーは一意なので、再試行では「その ID の行が今もこのノードか」を
      // 確認し、そう言い切れなければ押さずに止まる。引き直したノードは操作しない（確認だけ）ので、
      // ① の方針と両立する。1 回目と違って掴み直さないのは、既にこのノードを押しており、結果が
      // 分からないから。タイトルキーは同名の先頭行が返り得るため適用しない。
      // 確認は上の待機の**後**に置く: 待機は最長 timeout まで伸び、その間にノードが再利用され得る
      // （#110）。ここから ② のクリックまでは同期（間に await を足さないこと）。
      // findRow の null は「削除された」とは限らない（ID 一致に加えて削除可能行であることも条件で、
      // 再描画中は一時的に引けない）。成功扱いにすると未削除のまま次の対象へ進むため、別ノードの
      // 場合と同じく結果不明として停止する（前の試行が実は成立していても失敗として報告される。
      // 安全側の誤報）。
      if (attempt > 1 && target.id && deps.findRow(target) !== row) {
        throw new Error('target row could not be re-identified on retry (outcome unknown)')
      }
      // ② 操作メニューを開く
      const btn = deps.getMoreButton(row)
      if (!btn) throw new Error('more button not found')
      deps.click(btn)
      more = btn
    }
    // ③ メニューの「削除」
    let del: HTMLElement
    try {
      del = await w(() => deps.getDeleteMenuItem(more), { timeout })
    } catch (err) {
      // 「削除」項目の無いメニュー（削除権限の無い行など）を開いたまま止まらない（#88）。
      // 閉じ損ねても停止理由は元のタイムアウトのまま返す。
      try { deps.closeMenu?.() } catch { /* best-effort */ }
      throw err
    }
    deps.click(del)
    // ④ 確認ダイアログの Delete ボタン。
    // mat-dialog-container は先に描画され、中の Delete ボタンは少し遅れて現れるため、
    // ダイアログ容器ではなく「ボタン自体」の出現を待つ（同期取得だと null になる）。
    // 最初に見えたダイアログのノードに束縛する。ボタンを掴む前にそのダイアログが消えたり別の
    // ノードに替わったりしたら、後から在るものは自分が開いたものではないので止まる（#94）。
    let boundDialog: HTMLElement | null = null
    const confirm = await w(() => {
      const dialog = deps.getConfirmDialog()
      if (dialog !== boundDialog && boundDialog) throw new Error('confirm dialog was closed or replaced')
      if (!dialog) return null
      boundDialog = dialog
      return deps.getConfirmDeleteButton(dialog)
    }, { timeout })
    // ④' 出現＝操作可能ではない。ここで待たずに押すと、ダイアログは閉じるのに
    // 削除は実行されない（§8.11 / #82）。待つべき DOM シグナルが無いため固定待機。
    await sleep(settleMs)
    // 行動時点で再確認する: 待機中にダイアログが閉じられていたら、掴んだボタンはもう押すべきものでは
    // ない（その後に別のダイアログが開いていても、それは自分が開いたものではない。#94）。
    // 押さなかった場合もそのまま ⑤ へ進む: 利用者が自分で確定していれば行は消えるので完了、
    // 消えなければ通常どおり再試行 / 失敗になる。
    if (confirm.isConnected) deps.click(confirm)
    // ⑤ 削除した行ノード自身が DOM から外れるまで待つ。
    // title で再検索すると同名の別行を拾い続けて誤タイムアウトするため、掴んだ行を見る。
    try {
      await w(() => (row.isConnected ? null : true), { timeout })
      return
    } catch (err) {
      lastError = err as Error
      // 消滅待ちはタイムアウトしたが、その後に反映が届いていれば削除は成立している。
      // 「タイムアウト = 拒否」と決めつけない（#82 codex P1）。
      if (!row.isConnected) return
      // ここに来る = 掴んだノードがまだ接続されている。現行 DOM では削除で行ノードが外れるので、
      // ④' の待機でも足りず「閉じただけ」だった可能性が高い。ただしノードが別ノートブックに
      // 再利用される DOM ではそう言い切れないため、ID キーなら次の試行でメニューを押す直前に
      // 同一性を確認し、再特定できなければ押さずに止まる（#87 / #110）。
      if (attempt >= maxAttempts) break
      // 次の試行で ② の3点メニューを押せるよう、ダイアログが引くのを待つ。
      // 閉じきらなかった場合は、次の試行の入口（確認ダイアログが無いことの確認）で停止する。
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
