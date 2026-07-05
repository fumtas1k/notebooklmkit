import { makeTarget, type RowIdentity } from '../types'

// §8.5 の実 DOM 調査に基づくセレクタ。UI 変更時はこのファイルのみ修正する。
export const SELECTORS = {
  row: 'project-table table.project-table tbody tr[mat-row][role="row"]',
  title: 'span.project-table-title',
  titleCell: 'td.title-column',
  // ---- カード（グリッド）表示。2026-07-05 実機調査済み（requirements.md §8.8）。----
  // ページは常に一方のモード（カード=project-button のみ / 一覧=project-table のみ）。
  cardRow: 'project-button.project-button',
  cardTitle: 'span.project-button-title',
  cardCheckboxHost: 'div.project-button-box',
  cardActionButton: 'project-action-button',
  moreButton: 'project-action-button button.project-button-more',
  deleteMenuItem: '.cdk-overlay-container button.mat-mdc-menu-item.delete-button',
  confirmDialog: 'mat-dialog-container',
  confirmDeleteButton: 'button.primary-button',
  cancelButton: 'button.tertiary-button',
  // 一覧ページの安定ルート。表示モード切替（カード⇄一覧）で .all-projects-container は
  // 新ノードに置換されるが、この welcome-page は生存する（2026-07-05 実機確認。
  // 記録は docs/superpowers/specs/2026-07-05-view-switch-checkbox-reinject-design.md）。
  // 再スキャン observer をここに張ることで、置換後の新テーブルにも再注入できる。
  listRoot: 'welcome-page',
  // ---- 以下 Phase 2（ソース追加フロー）。2026-07-03 実機調査済み（requirements.md §8.6）。----
  // クラス churn に強いよう、テキスト / aria-label マッチング（SOURCE_TEXT）を主軸にしつつ、
  // 候補集合を安定クラス（drop-zone-icon-button 等）で絞って誤マッチを防ぐ。
  // UI が変わったらこのファイルだけを直す。実機確認手順は docs/e2e-checklist-phase2.md §0。
  sourceDialog: 'mat-dialog-container',
  sourceChipCandidates: 'mat-chip, .mdc-evolution-chip, [role="option"], button.drop-zone-icon-button',
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
  const title = titleEl?.textContent?.trim() ?? ''
  return { title }
}

// 行 `jslog` は全行同一で識別子に使えないため、タイトルで一致を取る。
export function findRowByIdentity(id: RowIdentity, root: ParentNode = document): HTMLElement | null {
  return getNotebookRows(root).find((r) => getRowIdentity(r).title === id.title) ?? null
}

// 行から選択キーを導出（identity → key を1箇所に集約）。
export function getRowKey(row: HTMLElement): string {
  return makeTarget(getRowIdentity(row)).key
}

export function getMoreButton(row: HTMLElement): HTMLElement | null {
  return row.querySelector<HTMLElement>(SELECTORS.moreButton)
}

// 削除可能な行か（= 3点メニュー moreButton を持つ行）。おすすめ（Reader ロール）行は
// moreButton が DOM に無いため false（ロール文字列はロケール依存で脆いので moreButton で
// 判定。2026-07-04 実機で「すべて」タブ337行 owner=有/reader=無 の誤分類ゼロを確認。issue #23）。
export function isDeletableRow(row: HTMLElement): boolean {
  return getMoreButton(row) != null
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
  if (box) return { host: box, before: box.querySelector(SELECTORS.cardActionButton) }
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

export function getConfirmDeleteButton(dialog: HTMLElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(SELECTORS.confirmDeleteButton)
}

// ソース追加フローのテキストマッチャ（ja / en）。NotebookLM の UI 言語に依らず動くよう両対応。
export const SOURCE_TEXT = {
  addButtonLabel: /ソースを追加|add source/i,
  addButtonExact: /^[+＋]?\s*(追加|add)$/i,
  websiteChip: /ウェブサイト|website/i,
  submit: /挿入|insert/i,
  createNew: /新規作成|ノートブックを新規作成|create new|new notebook/i,
  audioOverview: /音声解説|音声概要|audio overview/i,
  // 音声生成中を表す Studio の表示テキスト（生成開始検知 = 再試行停止 ＆ 二重生成防止に使う。issue #60）。
  audioGenerating: /生成しています|生成中|generating/i,
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
// 実 DOM: button.create-new-button（aria-label="ノートブックを新規作成"）。2026-07-04 実機確認。
export function getCreateNewButton(root: ParentNode = document): HTMLElement | null {
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button')).filter(
    (b) => !b.closest('[data-nlk]'),
  )
  return (
    buttons.find((b) => b.classList.contains('create-new-button')) ??
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
