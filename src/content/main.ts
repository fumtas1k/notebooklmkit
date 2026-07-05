import {
  getNotebookRows, getRowIdentity, findRowByIdentity, getRowKey,
  getMoreButton, getDeleteMenuItem, getConfirmDialog, getConfirmDeleteButton,
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton, getCreateNewButton, getAudioOverviewButton,
  getAudioGenerationCard, SOURCE_TEXT, isDeletableRow, getListObserveTarget,
} from './selectors'
import {
  makeTarget, type NotebookTarget, CREATE_RESULT_MESSAGE, PENDING_TTL_MS, type PendingCreate,
  MAIN_WORLD_CLICK_MESSAGE, CLICK_TARGET_ATTR,
} from '../types'
import { SelectionStore } from './selection'
import { detectLang, createT } from './i18n'
import { injectRowCheckboxes, CHECKBOX_ATTR } from './ui/row-checkbox'
import { mountActionBar } from './ui/action-bar'
import { mountImportPanel } from './ui/import-panel'
import { confirmDeletion } from './confirm-dialog'
import { deleteNotebooks, type DeleterDeps } from './deleter'
import { importUrls, type ImporterDeps } from './importer'
import { createNotebookWithUrls, triggerAudioOverview } from './notebook-creator'
import { listOpenTabs } from './tabs-bridge'
import { waitFor, safeClick, setInputValue } from './dom-utils'

export const VERSION = '0.1.0'

// 一覧再スキャン observer の監視オプション（init 時と削除完了後 finally の
// 再接続で共用。2箇所のオプションが乖離しないよう1箇所に集約する）。
// characterData は Angular のインターポレーション更新（{{title}} は既存テキスト
// ノードの nodeValue を書き換えるだけで childList レコードを出さない）に
// リネームフロー等で追従するため（issue #28）。churn 増のうち属性書き込みは
// row-checkbox.ts の「キー変化時のみ書き込み」ガード（PR #27）が抑制する
// （読み取りスキャン＋ checked 代入は毎発火走るが O(行数) で有界）。
const LIST_OBSERVE_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
}

export function buildTargets(store: SelectionStore, root: ParentNode = document): NotebookTarget[] {
  const selected = new Set(store.keys())
  return getNotebookRows(root)
    // 削除不可行（moreButton 無し = おすすめ/Reader 行）は対象から除外する（防御。issue #23）。
    // 通常経路ではチェックボックスが注入されないため選択され得ないが、明示除外で意図を固定する。
    .filter(isDeletableRow)
    .map((row) => makeTarget(getRowIdentity(row)))
    .filter((tgt) => selected.has(tgt.key))
}

// confirm 表示中に選択・一覧が変化していないかの検証に使う（issue #13）。
// キーはタイトル由来で重複し得る（同名ノートブック）ため、多重集合として比較する。
// 順序は比較しない（削除順が変わるだけで対象集合は同じ）。
export function sameTargetKeys(a: NotebookTarget[], b: NotebookTarget[]): boolean {
  if (a.length !== b.length) return false
  const counts = new Map<string, number>()
  for (const t of a) counts.set(t.key, (counts.get(t.key) ?? 0) + 1)
  for (const t of b) {
    const n = counts.get(t.key)
    if (!n) return false
    counts.set(t.key, n - 1)
  }
  return true
}

export function init(root: ParentNode = document): () => void {
  const store = new SelectionStore()
  const t = createT(detectLang())

  injectRowCheckboxes(store, root)

  let currentAbort: AbortController | null = null
  let deleting = false
  // 削除処理が pending の間に disposer が呼ばれた（＝ SPA 遷移などで teardown された）
  // ことを内側 finally から判定するためのフラグ（issue #16）。
  let disposed = false

  const bar = mountActionBar({
    store,
    t,
    count: () => buildTargets(store, root).length,
    handlers: {
      onSelectAll: () => {
        // 削除不可行（moreButton 無し = おすすめ/Reader 行）は選択に含めない（issue #23）。
        store.replaceAll(getNotebookRows(root).filter(isDeletableRow).map((r) => getRowKey(r)))
        syncCheckboxes(store, root)
      },
      onClearAll: () => { store.clear(); syncCheckboxes(store, root) },
      onDelete: () => { void runDelete() },
      onStop: () => { currentAbort?.abort() },
    },
  })

  // 一覧が再描画されたらチェックボックスを注入し直す。
  // アクションバー/進捗表示は document.body 側にあるため、再スキャン対象は
  // 一覧ページのルートに絞り、setProgress 等のテキスト更新で無駄な再スキャンが
  // 走らないようにする。監視対象は getListObserveTarget が返す安定祖先候補
  // （welcome-page → .welcome-page-container → .app-body の順に試す）にする ——
  // 表示モード切替（カード⇄一覧）で NotebookLM は .all-projects-container を
  // 新ノードに丸ごと置換するため、置換されるコンテナ自体を掴むと以後の再描画で
  // observer が発火せずチェックボックスが再注入されない（2026-07-05 実機確認）。
  // いずれの安定祖先候補も切替を生き延びる（実機確認済み）。多段フォールバックに
  // より、いずれか単体がリネームされてもすぐには再発しない。どの候補も無い環境
  // （テスト等）は .all-projects-container → body/root にフォールバックする。
  // 行の再注入に加え、アクションバー件数（選択×可視 = buildTargets 相当）も再同期する。
  // リネーム/削除で行が消えると残留選択キー（幽霊選択）が生じるが、件数は可視選択のみを
  // 数えるため、再描画のたびに refresh して表示ズレを防ぐ（issue #31）。
  const observer = new MutationObserver(() => {
    injectRowCheckboxes(store, root)
    bar.refresh()
  })
  // container 名は削除完了後 finally の再接続 observer.observe(container, …) が参照するため維持する。
  const container =
    getListObserveTarget(root) ??
    root.querySelector('.all-projects-container') ??
    (root instanceof Document ? root.body : (root as Element)) ??
    document.body
  observer.observe(container, LIST_OBSERVE_OPTIONS)

  async function runDelete(): Promise<void> {
    if (deleting) return
    deleting = true
    try {
      const targets = buildTargets(store, root)
      if (targets.length === 0) return
      // 分母は削除可能行のみ（buildTargets / onSelectAll と揃える）。削除不可行
      // （Reader）を数えると、混在リストで削除可能行を全選択しても isSelectAll が
      // false に希薄化し、件数タイプ確認（strong confirm）が漏れる（issue #23 レビュー指摘1）。
      const totalRows = getNotebookRows(root).filter(isDeletableRow).length
      const isSelectAll = targets.length === totalRows
      const ok = await confirmDeletion({ count: targets.length, isSelectAll, t })
      // confirm 待機中に teardown された場合は、たとえ確定されても進めない。
      // currentAbort は confirm 後にしか代入されないため待機中の dispose は
      // no-op になり、確認ダイアログも init 管理外の document.body に残って
      // teardown を生き延びる。ここで再チェックしないと、dispose 後に確定
      // されたときに新品の AbortController で破壊的削除一式が始まってしまう
      // （issue #16 と同じハザード / レビュー第2ラウンド finding B）。
      if (!ok || disposed) return
      // confirm 表示中に選択・一覧が変化していれば中止する（issue #13）。
      // 削除は取り消し不可のため、古いスナップショットのまま進めない。
      // フォーカストラップ（confirm-dialog.ts）が主経路を塞ぎ、こちらはキー
      // 多重集合レベルの安全網（同名タイトルの置換までは検出できない ——
      // タイトル識別の既知の制約。types.ts 参照）。検証通過後は確認時の順序を
      // 保つため targets をそのまま使う。
      if (!sameTargetKeys(targets, buildTargets(store, root))) {
        bar.setProgress(t('selectionChanged'))
        return
      }

      const ac = new AbortController()
      currentAbort = ac
      // 削除中は自分たちで行を書き換える（＝一覧を大量に mutate する）ため、
      // 再スキャン observer を止めて O(n^2) の無駄な再注入を避ける。
      observer.disconnect()
      bar.setBusy(true)
      try {
        const deps: DeleterDeps = {
          findRow: (tgt) => findRowByIdentity(tgt, root),
          getMoreButton,
          getDeleteMenuItem: () => getDeleteMenuItem(),
          getConfirmDialog: () => getConfirmDialog(),
          getConfirmDeleteButton,
          click: (el) => { safeClick(el) },
          waitFor,
        }
        const result = await deleteNotebooks(targets, deps, {
          signal: ac.signal,
          onProgress: (p) => bar.setProgress(t('progress', { done: p.completed, total: p.total })),
        })
        if (result.aborted) {
          const rest = targets.length - result.succeeded.length - result.failed.length
          bar.setProgress(t('abortedSummary', { ok: result.succeeded.length, rest }))
        } else {
          bar.setProgress(t('doneSummary', { ok: result.succeeded.length, ng: result.failed.length }))
        }
        // 成功分のみ選択解除。1回の emit に畳む（1件ずつ store.set すると emit ごとに
        // action-bar の件数再計算 buildTargets（O(行数)）が走り、解除件数分の重複スキャン
        // になるため。残す = 現在の選択キーから成功分を除いた集合。幽霊選択キーは保持される
        // （成功していないため。残留キー方針と整合。issue #31）。
        const succeededKeys = new Set(result.succeeded)
        store.replaceAll(store.keys().filter((k) => !succeededKeys.has(k)))
        syncCheckboxes(store, root)
      } catch (err) {
        console.error('notebooklmkit: unexpected error during delete', err)
        bar.setProgress(t('domError'))
      } finally {
        bar.setBusy(false)
        currentAbort = null
        // dispose 済み（disposer が呼ばれた）なら observer を復活させない。
        // そうしないと、削除 pending 中に teardown された破棄済み observer が
        // ここで再度 observe されて再注入を続けてしまう（issue #16）。
        if (!disposed) {
          // 再スキャンを再開し、削除実行中に変化した行を一度だけ同期し直す。
          observer.observe(container, LIST_OBSERVE_OPTIONS)
          injectRowCheckboxes(store, root)
        }
      }
    } finally {
      deleting = false
    }
  }

  return () => {
    disposed = true
    // 進行中の削除ループも停止させる。abort しないと deleter は残りの確定ターゲット
    // 全件へ破壊的クリックを teardown 後も打ち続け、しかも bar.destroy() で Stop
    // ボタンごと消えるため中断手段が無くなる（取り消し不可の操作 / issue #16）。
    currentAbort?.abort()
    observer.disconnect()
    bar.destroy()
  }
}

// ノートブックページ（/notebook/<id>）側の配線。インポートパネルを載せる。
// ノートブックページの DOM 構造には依存しない（パネルは body 固定配置、
// ソース追加フローの要素は importer が waitFor で都度探す）。
export function initImport(root: ParentNode = document): () => void {
  const t = createT(detectLang())
  let currentAbort: AbortController | null = null
  let importing = false

  const panel = mountImportPanel({
    t,
    handlers: {
      onLoadTabs: () => listOpenTabs(),
      onStop: () => { currentAbort?.abort() },
      onImport: (urls) => { void runImport(urls) },
    },
  })

  async function runImport(urls: string[]): Promise<void> {
    if (importing || urls.length === 0) return
    importing = true
    const ac = new AbortController()
    currentAbort = ac
    panel.setBusy(true)
    try {
      const deps: ImporterDeps = {
        getAddSourceButton: () => getAddSourceButton(root),
        getSourceDialog: () => getSourceDialog(),
        getWebsiteChip,
        getUrlInput: getSourceUrlInput,
        getSubmitButton: getSourceSubmitButton,
        setInputValue,
        click: (el) => { safeClick(el) },
        waitFor,
      }
      const result = await importUrls(urls, deps, {
        signal: ac.signal,
        onProgress: (p) => panel.setProgress(t('importProgress', { done: p.completed, total: p.total })),
      })
      const rest = urls.length - result.succeeded.length - result.failed.length
      if (result.aborted) {
        panel.setProgress(t('importAborted', { ok: result.succeeded.length, rest }))
      } else if (result.failed.length > 0) {
        panel.setProgress(
          t('importFailedSummary', { ok: result.succeeded.length, ng: result.failed.length, rest }),
        )
      } else {
        panel.setProgress(t('importDone', { ok: result.succeeded.length, ng: 0 }))
      }
      // 成功した URL は textarea から取り除く（失敗・未処理分が残りリトライしやすい）
      panel.removeUrls(result.succeeded)
    } catch (err) {
      console.error('notebooklmkit: unexpected error during import', err)
      panel.setProgress(t('domError'))
    } finally {
      panel.setBusy(false)
      currentAbort = null
      importing = false
    }
  }

  return () => {
    // SPA 遷移等で teardown されたら進行中のインポートも止める（issue #16 と同じ規約）
    currentAbort?.abort()
    panel.destroy()
  }
}

function syncCheckboxes(store: SelectionStore, root: ParentNode): void {
  for (const row of getNotebookRows(root)) {
    const key = getRowKey(row)
    const box = row.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    if (box) box.checked = store.has(key)
  }
}

type PageKind = 'list' | 'notebook' | 'none'

export function isNotebookPath(pathname: string): boolean {
  return pathname.startsWith('/notebook/')
}

function detectPage(root: ParentNode, pathname: string): PageKind {
  if (isNotebookPath(pathname)) return 'notebook'
  if (root.querySelector('.all-projects-container')) return 'list'
  return 'none'
}

export interface CreateEnv {
  storageGet(key: string): Promise<Record<string, unknown>>
  storageRemove(key: string): Promise<void>
  now(): number
  sendMessage(message: unknown): void
}

// pendingCreate を評価し、TTL 内なら storage から消して run(urls) を実行、結果を
// CREATE_RESULT_MESSAGE で background に返す。実行前クリアで二重実行を防ぐ。
export async function handlePendingCreate(
  env: CreateEnv,
  run: (urls: string[]) => Promise<boolean>,
): Promise<void> {
  const got = await env.storageGet('pendingCreate')
  const pending = got.pendingCreate as PendingCreate | undefined
  if (!pending) return
  if (env.now() - pending.ts > PENDING_TTL_MS) {
    await env.storageRemove('pendingCreate')
    return
  }
  await env.storageRemove('pendingCreate')
  // M-3: run が同期/非同期どちらで throw しても unhandled rejection にせず、
  // 結果メッセージを必ず送る（storage は実行前に既にクリア済みなので二重実行は起きない）。
  let ok: boolean
  try {
    ok = await run(pending.urls)
  } catch (err) {
    console.error('notebooklmkit: unexpected error during pending create', err)
    ok = false
  }
  // 元タブ X（クリック元）でバッジを更新できるよう、pendingCreate に載っていた
  // tabId をそのまま background に返す（content はタブ Y 上で走るため sender.tab.id は使えない）。
  env.sendMessage({ type: CREATE_RESULT_MESSAGE, ok, tabId: pending.tabId })
}

// 実 chrome / storage への既定配線。chrome が無い環境（jsdom）でも安全に no-op になる。
function defaultCreateEnv(): CreateEnv {
  const c = (globalThis as { chrome?: any }).chrome
  return {
    storageGet: (k) => c?.storage?.local?.get(k) ?? Promise.resolve({}),
    storageRemove: (k) => c?.storage?.local?.remove(k) ?? Promise.resolve(),
    now: () => Date.now(),
    sendMessage: (m) => { void c?.runtime?.sendMessage?.(m) },
  }
}

// 音声解説タイルのクリックを background 経由で主ワールドに依頼する。対象要素を一時マーカー属性で
// 指し、background が chrome.scripting.executeScript({ world:'MAIN' }) でページ主ワールドから実クリック
// する（隔離ワールドの合成イベントは Angular Material タイルに効かない。CSP 免除の executeScript を使う。§8.7）。
function requestMainWorldClick(el: HTMLElement | null | undefined): void {
  if (!el) return
  el.setAttribute(CLICK_TARGET_ATTR, '1')
  const c = (globalThis as { chrome?: { runtime?: { sendMessage?: (m: unknown) => void } } }).chrome
  c?.runtime?.sendMessage?.({ type: MAIN_WORLD_CLICK_MESSAGE })
}

function defaultCreateRunner(root: ParentNode): (urls: string[]) => Promise<boolean> {
  return async (urls) => {
    const ok = await createNotebookWithUrls(urls, {
      getCreateNewButton: () => getCreateNewButton(root),
      getSourceDialog: () => getSourceDialog(),
      getWebsiteChip,
      getUrlInput: getSourceUrlInput,
      getSubmitButton: getSourceSubmitButton,
      setInputValue,
      click: (el) => { safeClick(el) },
      waitFor,
    })
    // #51: 作成成功時のみ、音声解説の生成トリガーを best-effort で押す。
    // fire-and-forget にして、作成結果の報告（バッジ '✓'）を音声トリガーの待機・再試行から
    // 時間的に切り離す。triggerAudioOverview は失敗を内部で握って false を返し reject しないため、
    // 作成成功 ok には影響しない。クリックは主ワールド（background の executeScript）経由（§8.7）。
    if (ok) {
      void triggerAudioOverview({
        getAudioOverviewButton: () => getAudioOverviewButton(root),
        click: (el) => { requestMainWorldClick(el) },
        // 生成開始の検知（＝再試行停止 ＆ 二重生成防止）。既存のテキスト判定に加え、生成カード要素の
        // 出現も OR で見る（表示テキストの描画遅延より早く検知しうる。strictly more sensitive。#60）。
        isGenerating: () =>
          SOURCE_TEXT.audioGenerating.test(document.body.innerText || '') ||
          getAudioGenerationCard(root) != null,
        waitFor,
      })
    }
    return ok
  }
}

// NotebookLM は pushState 遷移でイベントが取れない Angular SPA のため、
// DOM 変化のたびにページ種別を判定して UI を掛け替える常駐ルーター。
// 判定は pathname の前方一致と querySelector 1回だけで軽量。
// 一覧コンテナが未描画の cold load は 'none' 扱いになり、描画後の mutation で
// 'list' に遷移する（旧 bootstrap observer と同じ振る舞い）。
export function start(
  root: ParentNode = document,
  getPath: () => string = () => location.pathname,
  env: CreateEnv = defaultCreateEnv(),
  run: (urls: string[]) => Promise<boolean> = defaultCreateRunner(root),
): () => void {
  let current: PageKind = 'none'
  let dispose: (() => void) | null = null
  let lastPath: string | null = null

  const apply = () => {
    const path = getPath()
    // 毎 mutation 呼ばれるため軽量化: マウント済み（current !== 'none'）で pathname が
    // 変わっていなければ何もしない（querySelector も走らせない）。SPA 遷移は必ず
    // pathname が変わるので取りこぼさない。副次効果として、一覧コンテナが再描画で
    // 一瞬 detach しても pathname が同じ限り teardown しない（issue #38 のガード）。
    if (path === lastPath && current !== 'none') return
    lastPath = path
    const kind = detectPage(root, path)
    if (kind === current) return
    // 'none' への遷移でも dispose する（SPA 遷移で UI を残さない）
    dispose?.()
    dispose = null
    current = kind
    if (kind === 'list') dispose = init(root)
    else if (kind === 'notebook') dispose = initImport(root)
  }

  apply()
  // F2-2: ツールバー起動でセットされた pendingCreate を、この content script ロード時に一度だけ実行。
  void handlePendingCreate(env, run)
  const target: Element =
    (root instanceof Document ? (root.documentElement ?? root.body) : (root as Element)) ??
    document.documentElement
  const router = new MutationObserver(apply)
  router.observe(target, { childList: true, subtree: true })

  return () => {
    router.disconnect()
    dispose?.()
    dispose = null
  }
}

// content script として読み込まれたときだけ自動起動。
// テスト(jsdom)では location.hostname が notebooklm.google.com にならないため
// import しても副作用は発生しない。
if (
  typeof document !== 'undefined' &&
  typeof location !== 'undefined' &&
  location.hostname === 'notebooklm.google.com'
) {
  start()
}
