import { makeTarget, type RowIdentity } from '../types'

// 実 DOM 調査（requirements.md §8.5〜§8.14。最新の一覧 DOM は §8.14）に基づくセレクタ。
// UI 変更時はこのファイルのみ修正する。
export const SELECTORS = {
  row: 'project-table table.project-table tbody tr[mat-row][role="row"]',
  // 一覧表示のタイトル。2026-10-04 実機で span → a.project-table-title（title 属性つき、
  // 絵文字 span を内包）に変わったため、タグを問わずクラスで取る（§8.14）。
  title: '.project-table-title',
  titleEmoji: '.project-table-emoji',
  titleCell: 'td.title-column',
  // ---- カード（グリッド）表示。2026-07-05 実機調査済み（requirements.md §8.8）。----
  // ページは常に一方のモード（カード=project-button のみ / 一覧=project-table のみ）。
  cardRow: 'project-button.project-button',
  cardTitle: 'span.project-button-title',
  cardCheckboxHost: 'div.project-button-box',
  cardActionButton: 'project-action-button',
  // 3点メニュー。2026-10-04 実機で button.project-button-more →
  // nb-icon-button.project-button-more > button（内側 button は専用クラスなし）に変わった（§8.14）。
  // 旧形も旧 UI が残る環境向けに残す。
  moreButton:
    'project-action-button button.project-button-more, project-action-button .project-button-more button',
  // おすすめ（閲覧者）ノートブックのセクション。表示モードを問わず存在する（§8.14）。
  featuredSection: '.featured-projects-container',
  deleteMenuItem: '.cdk-overlay-container button.mat-mdc-menu-item.delete-button',
  confirmDialog: 'mat-dialog-container',
  // 削除確認ダイアログのボタン。2026-08-08 の UI 刷新で
  // primary-button / tertiary-button → yes-button / no-button に変わった（§8.10）。
  // 2026-10-04 実機では yes-button / no-button も消え、テキスト完全一致側で取れている（§8.14）。
  // 取得は getConfirmDeleteButton（クラス＋テキストの二段構え）を使うこと。
  confirmDeleteButton: 'button.yes-button',
  cancelButton: 'button.no-button',
  // 一覧ページの安定ルート。表示モード切替（カード⇄一覧）で .all-projects-container は
  // 新ノードに置換されるが、この welcome-page は生存する（2026-07-05 実機確認。
  // 記録は docs/superpowers/specs/2026-07-05-view-switch-checkbox-reinject-design.md）。
  // 再スキャン observer をここに張ることで、置換後の新テーブルにも再注入できる。
  listRoot: 'welcome-page',
  // ---- 以下 Phase 2（ソース追加フロー）。2026-07-03 実機調査済み（requirements.md §8.6）。----
  // クラス churn に強いよう、テキスト / aria-label マッチング（SOURCE_TEXT）を主軸にしつつ、
  // 候補集合を安定クラス（source-action-button 等）で絞って誤マッチを防ぐ。
  // UI が変わったらこのファイルだけを直す。実機確認手順は docs/e2e-checklist-phase2.md §0。
  sourceDialog: 'mat-dialog-container',
  // 種別ボタンは 2026-10-04 実機で drop-zone-icon-button → source-action-button に変わった
  // （§8.13）。旧クラスは旧 UI が残る環境向けに候補へ残す。
  sourceChipCandidates:
    'mat-chip, .mdc-evolution-chip, [role="option"], button.source-action-button, button.drop-zone-icon-button',
} as const

// 再スキャン observer を張る安定祖先の候補（表示モード切替で置換される
// .all-projects-container の生存する親）。前ほど狭く堅い。2026-07-05 実機で
// list⇄card 往復を通して生存・単一インスタンスを確認。先頭から順に試し、
// 単一タグ（welcome-page）のリネームで即バグ再発しないよう多段にする。
const LIST_ROOT_SELECTORS = [SELECTORS.listRoot, '.welcome-page-container', '.app-body'] as const

export function getNotebookRows(root: ParentNode = document): HTMLElement[] {
  // テーブル行とカードの和集合（ページは常に一方のモードなので片方は空）。
  return Array.from(root.querySelectorAll<HTMLElement>(`${SELECTORS.row}, ${SELECTORS.cardRow}`))
}

export function getRowIdentity(row: HTMLElement): RowIdentity {
  const titleEl = row.querySelector(SELECTORS.title) ?? row.querySelector(SELECTORS.cardTitle)
  // 一覧表示の a.project-table-title は絵文字 span を内包するため、textContent だと
  // 「📄 タイトル」になりカード表示のタイトルとキーが食い違う。title 属性（絵文字なし）を
  // 優先する。無ければ絵文字 span を除いた textContent にフォールバックする（§8.14）。
  const title = titleEl?.getAttribute('title')?.trim() || textWithoutEmoji(titleEl)
  const id = getNotebookId(titleEl)
  return id ? { title, id } : { title }
}

// タイトル要素からノートブック ID を取る（2026-10-04 実機・§8.14）。
// 一覧: a.project-table-title の href="/notebook/<id>" / カード: span.project-button-title の
// id="project-<id>-title"。どちらも無ければ undefined（呼び出し側はタイトルキーにフォールバック）。
function getNotebookId(titleEl: Element | null): string | undefined {
  if (!titleEl) return undefined
  return (
    titleEl.getAttribute('href')?.match(/\/notebook\/([^/?#]+)/)?.[1] ??
    titleEl.id.match(/^project-(.+)-title$/)?.[1]
  )
}

function textWithoutEmoji(el: Element | null): string {
  if (!el) return ''
  if (!el.querySelector(SELECTORS.titleEmoji)) return el.textContent?.trim() ?? ''
  const clone = el.cloneNode(true) as Element
  clone.querySelectorAll(SELECTORS.titleEmoji).forEach((e) => e.remove())
  return clone.textContent?.trim() ?? ''
}

// 行から選択キーを導出（identity → key を1箇所に集約）。
export function getRowKey(row: HTMLElement): string {
  return makeTarget(getRowIdentity(row)).key
}

export function getMoreButton(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(SELECTORS.moreButton)
}

// 削除可能な行か（= 3点メニュー moreButton を持ち、おすすめセクション外の行）。
// 2026-07-04 時点ではおすすめ（Reader ロール）行に moreButton が無く、その有無だけで判定できた
// （issue #23）が、2026-10-04 実機ではおすすめ行にも moreButton が付いた（メニューに「削除」は無い。
// §8.14）。ロール文字列はロケール依存で脆いので、セクション容器（featured-projects-container）で除外する。
// 取りこぼしても deleter は「削除」項目が出ずタイムアウトで安全停止するが、消せない行に
// チェックボックスを出さないためにここで弾く。
export function isDeletableRow(row: HTMLElement): boolean {
  return getMoreButton(row) != null && row.closest(SELECTORS.featuredSection) == null
}

// 削除対象の行を選択キーで引く（ID があれば ID、無ければタイトル。types.ts の makeTarget）。
// ID で識別した対象を、タイトルが同じだけの別行に取り違えない。検索は削除可能な行に限定する:
// おすすめ行にも 3点メニューが付いた（§8.14）ため、タイトルキーにフォールバックした場合、
// 所有ノートブックと同名のおすすめ行が文書順で先にあると（グリッド表示はおすすめセクションが先）、
// そちらを掴んで「削除」項目の無いメニューを開き、選択した行を消せないまま止まる。
// 対象確定（buildTargets）と同じ集合から引く。
export function findDeletableRowByIdentity(id: RowIdentity, root: ParentNode = document): HTMLElement | null {
  const key = makeTarget(id).key
  return getNotebookRows(root).find((r) => isDeletableRow(r) && getRowKey(r) === key) ?? null
}

// チェックボックスを入れるホストセル（タイトル列）。新しい列を足すと
// ヘッダー行とズレるため、既存のタイトルセル内に注入する。
export function getTitleCell(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(SELECTORS.titleCell)
}

// チェックボックスの注入ホストと挿入位置（before）。モード別に返す。
export interface CheckboxHost {
  host: HTMLElement
  before: Node | null
}

// テーブル行はタイトルセル先頭（新しい列を足すとヘッダーとズレるため）、
// カード行は box 内・3点メニュー（project-action-button）の直前（＝左）に注入する。
export function getCheckboxHost(row: HTMLElement): CheckboxHost | null {
  const titleCell = getTitleCell(row) ?? row.querySelector<HTMLElement>('td')
  if (titleCell) return { host: titleCell, before: titleCell.firstChild }
  const box = row.querySelector<HTMLElement>(SELECTORS.cardCheckboxHost)
  // before は host（box）の直接子に限定する（insertBefore は before が host の直接子でないと
  // NotFoundError を投げるため）。将来 action button がラップされたら before=null → box 末尾に
  // append で graceful degradation（PR #73 レビュー・CLAUDE.md「掴んだノードの寿命/silent failure」方針）。
  if (box) return { host: box, before: box.querySelector(`:scope > ${SELECTORS.cardActionButton}`) }
  return null
}

// 再スキャン observer を張る安定祖先（表示モード切替で置換される .all-projects-container の
// 生存する親）。LIST_ROOT_SELECTORS を先頭（＝より狭く堅い）から順に試し、最初に見つかった
// 要素を返す。単一タグ（welcome-page）がリネームされても、より広い祖先へ多段フォールバック
// することで無言のバグ再発を緩和する。どの候補も見つからなければ null（呼び出し側がフォールバックする）。
export function getListObserveTarget(root: ParentNode = document): HTMLElement | null {
  for (const sel of LIST_ROOT_SELECTORS) {
    const el = root.querySelector<HTMLElement>(sel)
    if (el) return el
  }
  return null
}

export function getDeleteMenuItem(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.deleteMenuItem)
}

export function getConfirmDialog(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.confirmDialog)
}

// 削除確認ダイアログのボタン文言（ja / en）。NotebookLM の UI 言語に依らず動くよう両対応。
// 完全一致で使う（前方一致だと「削除しない」等を拾い得る）。
export const CONFIRM_TEXT = {
  confirmDelete: /^(削除|delete)$/i,
  cancel: /^(キャンセル|cancel)$/i,
} as const

// 削除確認ダイアログの「削除」ボタン。2026-08-08 実機（§8.10）は
// button.yes-button（テキスト「削除」）／取消は button.no-button（「キャンセル」）で、
// 旧 primary-button / tertiary-button は消滅した。旧セレクタのままだと常に null になり、
// deleter の waitFor がタイムアウトして**確認モーダルが開いたまま停止**する（#81）。
//
// 取り違えは事故の質が非対称: 掴み損ねる → 停止（安全・気付ける）、キャンセルを掴む →
// 削除が無言で no-op になり、しかも deleter は行が消えないまま次へ進もうとする。
// そこで「キャンセル系テキストは何があっても返さない」を最上位の不変条件にし、
// 安定クラス → テキスト完全一致（ja/en）の順に探す。前方一致ではなく完全一致にするのは
// 「削除しない」「Delete all」等の別ボタンを拾わないため。該当なしは null（＝安全停止）。
export function getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null {
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button')).filter(
    (b) => !CONFIRM_TEXT.cancel.test((b.textContent ?? '').trim()),
  )
  return (
    buttons.find((b) => b.classList.contains('yes-button')) ??
    buttons.find((b) => CONFIRM_TEXT.confirmDelete.test((b.textContent ?? '').trim())) ??
    null
  )
}

// ソース追加フローのテキストマッチャ（ja / en）。NotebookLM の UI 言語に依らず動くよう両対応。
export const SOURCE_TEXT = {
  addButtonLabel: /ソースを追加|add source/i,
  addButtonExact: /^[+＋]?\s*(追加|add)$/i,
  websiteChip: /ウェブサイト|website/i,
  submit: /挿入|insert/i,
  createNew: /新規作成|ノートブックを新規作成|新しいノートブック|create new|new notebook/i,
  // 作成ボタンの aria-label 完全一致（§8.13）。部分一致より先に試し、同じ語を含むだけの
  // 別ボタン（例: 「新しいノートブック…」という題のノートブック）を掴まないようにする。
  createNewExact: /^(新しいノートブック|ノートブックを新規作成|new notebook|create new notebook)$/i,
  audioOverview: /音声解説|音声概要|audio overview/i,
  // 音声生成中を表す Studio の表示テキスト（生成開始検知 = 再試行停止 ＆ 二重生成防止に使う。issue #60）。
  audioGenerating: /生成しています|生成中|generating/i,
  // 「音声解説をカスタマイズ」ダイアログの確定ボタン（#84 / §8.12）。**完全一致**にする
  // ——「音声解説を生成しています…」等を前方一致で拾うと生成中カードを押しに行くため。
  generate: /^(生成|generate)$/i,
} as const

// ソースパネルの「追加」ボタン。自拡張が注入した UI（data-nlk 配下）は除外する。
export function getAddSourceButton(root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button')).filter(
    (b) => !b.closest('[data-nlk]'),
  )
  return (
    buttons.find((b) => b.classList.contains('add-source-button')) ??
    buttons.find((b) => SOURCE_TEXT.addButtonLabel.test(b.getAttribute('aria-label') ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.addButtonLabel.test(b.textContent ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.addButtonExact.test((b.textContent ?? '').trim())) ??
    null
  )
}

// ホーム/一覧の「新規作成」ボタン。自拡張が注入した UI（data-nlk 配下）は除外する。
// 実 DOM（2026-10-04 実機確認・§8.13）: 専用クラスの無い button（aria-label="新しいノートブック"）。
// 旧 button.create-new-button（aria-label="ノートブックを新規作成"。2026-07-04）は消滅した。
// 専用クラスが無くなったので aria-label 完全一致を主軸にし、旧クラス / 部分一致は保険として残す。
export function getCreateNewButton(root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button')).filter(
    (b) => !b.closest('[data-nlk]'),
  )
  return (
    buttons.find((b) => b.classList.contains('create-new-button')) ??
    buttons.find((b) => SOURCE_TEXT.createNewExact.test((b.getAttribute('aria-label') ?? '').trim())) ??
    buttons.find((b) => SOURCE_TEXT.createNew.test(b.getAttribute('aria-label') ?? '')) ??
    buttons.find((b) => SOURCE_TEXT.createNew.test(b.textContent ?? '')) ??
    null
  )
}

export function getSourceDialog(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(SELECTORS.sourceDialog)
}

// ダイアログ内の「ウェブサイト」チップ。querySelectorAll は document order（親→子）
// なので、テキストを含む最外のクリック可能候補が返る。
export function getWebsiteChip(dialog: HTMLElement): HTMLElement | null {
  const candidates = Array.from(dialog.querySelectorAll<HTMLElement>(SELECTORS.sourceChipCandidates))
  return candidates.find((el) => SOURCE_TEXT.websiteChip.test(el.textContent ?? '')) ?? null
}

// ソース追加ダイアログの URL 貼り付け欄。実 DOM（2026-07-03/-04 確認）では
// textarea[formcontrolname="urls"]。ダイアログ上部には常に「ウェブで新しいソースを検索」の
// 検索欄 textarea[formcontrolname="discoverSourcesQuery"] が存在するため、bare textarea
// フォールバックは使わない（検索欄を誤取得すると URL が貼り付け欄に入らず、挿入ボタンが
// 有効化されずタイムアウトする）。urls 欄が未描画の間は null を返し、呼び出し側の waitFor が待つ。
export function getSourceUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  return (
    dialog.querySelector<HTMLTextAreaElement>('textarea[formcontrolname="urls"]') ??
    dialog.querySelector<HTMLInputElement>('input[type="url"]')
  )
}

export function getSourceSubmitButton(dialog: HTMLElement): HTMLElement | null {
  // 実 DOM の挿入ボタンは type="button"。テキスト（ja/en）で一致させる。
  // 死んだ button[type="submit"] フォールバックは撤去（無関係な submit の誤クリック防止）。
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
  return buttons.find((b) => SOURCE_TEXT.submit.test((b.textContent ?? '').trim())) ?? null
}

// Studio パネルの「音声解説」生成タイル。実 DOM（2026-07-04 実機確認・§8.7）は
// div[role="button"].create-artifact-button-container（aria-label="音声解説"）で <button> ではない。
// 1回クリックで即・音声生成が始まる（カスタマイズダイアログは開かない）。同じ「音声解説」語を含む
// 「音声解説をカスタマイズ」chevron（button.edit-button）を取り違えると設定ダイアログが開くだけで
// 生成されないため、aria-label に「カスタマイズ / customize」を含むものは除外する。安定クラス
// create-artifact-button-container を優先し、無ければ button / [role="button"] のテキスト一致に
// フォールバック。自拡張 UI（[data-nlk]）は除外。disabled 判定は triggerAudioOverview の責務。
export function getAudioOverviewButton(root: ParentNode = document): HTMLElement | null {
  const isAudio = (el: Element): boolean => {
    const aria = el.getAttribute('aria-label') ?? ''
    if (/カスタマイズ|customize/i.test(aria)) return false
    return SOURCE_TEXT.audioOverview.test(aria) || SOURCE_TEXT.audioOverview.test(el.textContent ?? '')
  }
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('.create-artifact-button-container, button, [role="button"]'),
  ).filter((el) => !el.closest('[data-nlk]'))
  return (
    candidates.find((el) => el.classList.contains('create-artifact-button-container') && isAudio(el)) ??
    candidates.find(isAudio) ??
    null
  )
}

// 生成カード要素が実際にレンダリング上可視か。isGenerating のテキスト側（document.body.innerText、
// 非表示テキストを除外）と意味論を揃え「要素側 ⊆ テキスト側」を保つことで、非表示/at-rest の
// プレースホルダ文言による false positive（初回クリック抑止で音声が生成されない silent failure）を
// 防ぐ（#60 PR #63 レビュー指摘1）。display:none / visibility:hidden / hidden 属性を祖先まで辿る。
// offsetParent は jsdom で常に null になり使えないため getComputedStyle で判定する。
function isRenderedVisible(el: HTMLElement): boolean {
  const view = el.ownerDocument.defaultView
  if (!view) return true
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hasAttribute('hidden')) return false
    const s = view.getComputedStyle(node)
    if (s.display === 'none' || s.visibility === 'hidden') return false
  }
  return true
}

// 「音声解説をカスタマイズ」ダイアログの「生成」ボタン。2026-08 の UI 刷新で、Studio の
// 音声解説タイルは1クリックで即生成せず、このダイアログを開くようになった（§8.12 / #84）。
// 実 DOM（2026-08-08 実測）の確定ボタンは
// `button.mdc-button--unelevated.button-color--primary`（テキスト「生成」）だが、
// 同ダイアログには close(×) / 長さトグル（短め・デフォルト）/「N 件のソース」も同居する。
//
// 安全策として、まず**ダイアログが音声解説のものであること**を本文テキストで確認する
// （削除確認など無関係なダイアログの主ボタンを押すと破壊的になり得る）。そのうえで
// テキスト完全一致で引く（前方一致は「音声解説を生成しています…」を拾う）。
// クラスに依存しないのは、確定ボタン専用の安定クラスが無く汎用 Material クラスしか
// 持たないため（削除ダイアログの yes-button のような手掛かりが無い）。
// 自拡張 UI（[data-nlk]）は除外。該当なしは null（呼び出し側は素通りしてよい）。
export function getAudioGenerateButton(root: ParentNode = document): HTMLElement | null {
  const dialog = root.querySelector<HTMLElement>(SELECTORS.sourceDialog)
  if (!dialog) return null
  if (!SOURCE_TEXT.audioOverview.test(dialog.textContent ?? '')) return null
  return (
    Array.from(dialog.querySelectorAll<HTMLElement>('button'))
      .filter((b) => !b.closest('[data-nlk]'))
      .find((b) => SOURCE_TEXT.generate.test((b.textContent ?? '').trim())) ?? null
  )
}

// Studio の「音声解説を生成しています…」生成中カード（スピナー付きコンテナ）の要素を返す。
// #60: 生成開始を表示テキスト（body.innerText 一致）より早く・確実に検知するための即時シグナル。
// main.ts の isGenerating で「テキスト一致 OR この要素の出現」の OR に使う（strictly more sensitive）。
// 実 DOM の安定セレクタは未確定（実機確認待ち・§8.7）。best-effort: 生成中を表しうる安定クラス候補に
// 絞り、その中で生成中テキストを含む要素を返す。該当なしは null（呼び出し側がテキスト判定にフォールバック）。
// 汎用セレクタ（role=status 等）は生成中でない要素にも当たる false positive を招くため外し、
// 音声/生成固有クラスに絞る（#60 最終レビュー指摘）。候補は可視要素に限定し、非表示 at-rest テキスト
// による false positive を防ぐ（要素側 ⊆ テキスト側。#60 PR #63 レビュー指摘1）。
// 自拡張 UI（[data-nlk]）は除外。querySelectorAll + フィルタのみで throw しない。
export function getAudioGenerationCard(root: ParentNode = document): HTMLElement | null {
  const candidates = Array.from(
    root.querySelectorAll<HTMLElement>('.audio-overview-container, [class*="generating"]'),
  ).filter((el) => !el.closest('[data-nlk]'))
  // 安価なテキスト判定を先に評価し、一致した候補にだけ isRenderedVisible（getComputedStyle）を回す
  // （無駄な style 計算を減らす。PR #63 再レビューの任意提案）。要素側 ⊆ テキスト側の不変条件は不変。
  return candidates.find(
    (el) => SOURCE_TEXT.audioGenerating.test(el.textContent ?? '') && isRenderedVisible(el),
  ) ?? null
}
