# Phase 2 セレクタ堅牢化（issue #37）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ソース追加フローの暫定セレクタを 2026-07-03 の実機 DOM 調査結果に基づいて堅牢化し、誤マッチ源（裸 `button` / 死んだ `button[type="submit"]` フォールバック）を除去する。

**Architecture:** マッチングの主軸はテキスト / aria-label のまま維持し、候補集合を安定クラス（`add-source-button` / `drop-zone-icon-button`）・属性（`formcontrolname="urls"`）で絞る。変更は `src/content/selectors.ts` とそのテスト `tests/selectors-source.test.ts`、およびドキュメントに限定し、importer / import-panel など呼び出し側のシグネチャは一切変えない。

**Tech Stack:** TypeScript（strict）、Vitest + jsdom、Manifest V3 content script。

## Global Constraints

- セレクタは `src/content/selectors.ts`（`SELECTORS` / `SOURCE_TEXT` と各 getter）に集約する。UI 変更時はこのファイルのみ修正。
- `mdc-*` / `mat-*`（Angular Material）は比較的安定。`ng-tns-*` / `_ngcontent-*`（動的生成）には依存しない。
- 注入した DOM の検索・除外は `data-nlk` 属性で行う（getter は `data-nlk` 配下を対象外にする既存挙動を維持）。
- 静的チェックゲート: `npm run typecheck`（strict, noUnusedLocals/Parameters）。全テスト: `npm test`（= `vitest run`）。
- getter のシグネチャ（引数・戻り値の型）は変更しない。呼び出し側（importer.ts / main.ts）に波及させない。

---

## File Structure

- Modify: `src/content/selectors.ts` — `SELECTORS.sourceChipCandidates` を絞り、`SELECTORS.sourceSubmit` を撤去。`getAddSourceButton` / `getSourceUrlInput` / `getSourceSubmitButton` を堅牢化。冒頭コメントを「実機調査済み」に更新。
- Modify: `tests/selectors-source.test.ts` — 実 DOM 構造に合わせたフィクスチャと誤マッチ回帰テスト。
- Modify: `docs/requirements.md` — §8.6（新規）にソース追加フローの実 DOM を記録、§10 のチェックボックスを更新。
- Modify: `docs/e2e-checklist-phase2.md` — §0 を「検証済み」＋実セレクタ反映に更新。
- 別 issue 作成（`gh`）— 複数 URL 一括投入の検討。

---

### Task 1: `getWebsiteChip` の候補を `drop-zone-icon-button` に限定

実 DOM ではソース種別チップは `button.drop-zone-icon-button`（4種別共通クラス）で、裸 `button` を候補にすると同ダイアログ内の無関係ボタンに誤マッチし得る（#37 の主指摘）。候補集合を絞ってこれを消す。`getWebsiteChip` のロジック自体は不変で、`SELECTORS.sourceChipCandidates` 定数のみ変更する。

**Files:**
- Modify: `src/content/selectors.ts:17`（`sourceChipCandidates`）
- Test: `tests/selectors-source.test.ts`

**Interfaces:**
- Consumes: なし（既存 `getWebsiteChip(dialog: HTMLElement): HTMLElement | null`）
- Produces: `getWebsiteChip` の挙動 —— `button.drop-zone-icon-button` / `mat-chip` / `.mdc-evolution-chip` / `[role="option"]` のうちテキストが `/ウェブサイト|website/i` の要素のみ返す。裸 `button`（クラスなし）は候補外。

- [ ] **Step 1: 失敗するテストを書く**

`tests/selectors-source.test.ts` の `getWebsiteChip matches a chip by ja/en text`（現在38〜46行）を残しつつ、その直後に以下を追加する。

```ts
  it('getWebsiteChip matches the real-DOM website drop-zone button', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `
      <button class="drop-zone-icon-button"><span>ファイルをアップロード</span></button>
      <button class="drop-zone-icon-button"><span>ウェブサイト</span></button>`
    expect(getWebsiteChip(dialog)?.classList.contains('drop-zone-icon-button')).toBe(true)
    expect(getWebsiteChip(dialog)?.textContent).toContain('ウェブサイト')
  })

  it('getWebsiteChip ignores bare buttons even if they contain website text', () => {
    const dialog = document.createElement('div')
    // 種別チップでない裸 button（例: ヘルプリンク）は候補外。旧候補（裸 button）では
    // 誤マッチしていたケースの回帰テスト。
    dialog.innerHTML = `<button class="help-link">Learn more about website sources</button>`
    expect(getWebsiteChip(dialog)).toBeNull()
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/selectors-source.test.ts`
Expected: FAIL —— `ignores bare buttons ...` が「裸 button を拾って null にならない」ため失敗（`Learn more about website sources` を返す）。

- [ ] **Step 3: 最小実装**

`src/content/selectors.ts:17` を変更する。

```ts
// Before
  sourceChipCandidates: 'mat-chip, .mdc-evolution-chip, [role="option"], button',
// After
  sourceChipCandidates: 'mat-chip, .mdc-evolution-chip, [role="option"], button.drop-zone-icon-button',
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/selectors-source.test.ts`
Expected: PASS（新規2件＋既存 `getWebsiteChip matches a chip by ja/en text` が緑。`[role="option"]` / `mat-chip` ケースは候補に残っているため引き続き通る）

- [ ] **Step 5: コミット**

```bash
git add src/content/selectors.ts tests/selectors-source.test.ts
git commit -m "fix(#37): ソース種別チップ候補を drop-zone-icon-button に限定

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `getSourceSubmitButton` の `button[type="submit"]` フォールバック撤去

実 DOM の挿入ボタンは `button[type="button"]`（`type="submit"` ではない）。死んだフォールバックは無関係な submit ボタンを誤クリックする破壊的リスク源（ソース追加は取り消し操作が要る）なので撤去し、テキストマッチ一本にする。見つからなければ呼び出し側 importer の `waitFor` がタイムアウトし安全停止する。

**Files:**
- Modify: `src/content/selectors.ts:16-19`（`SELECTORS.sourceSubmit` 撤去）, `src/content/selectors.ts:103-109`（`getSourceSubmitButton`）
- Test: `tests/selectors-source.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `getSourceSubmitButton(dialog: HTMLElement): HTMLElement | null` —— ダイアログ内でテキストが `/挿入|insert/i` の `button` のみ返す。該当なしは `null`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/selectors-source.test.ts` の `getSourceSubmitButton matches 挿入/Insert text, then submit type`（現在58〜66行）を、以下で**置き換える**。

```ts
  it('getSourceSubmitButton matches 挿入/Insert text only (no submit-type fallback)', () => {
    const dialog = document.createElement('div')
    // 実 DOM の挿入ボタンは type="button"。テキストで一致させる。
    dialog.innerHTML = `<button type="button">キャンセル</button><button type="button">挿入</button>`
    expect(getSourceSubmitButton(dialog)?.textContent).toBe('挿入')
    // type="submit" フォールバックは撤去したので、挿入テキストの無い submit ボタンは拾わない。
    dialog.innerHTML = `<button type="submit">Go</button>`
    expect(getSourceSubmitButton(dialog)).toBeNull()
    dialog.innerHTML = `<button>キャンセル</button>`
    expect(getSourceSubmitButton(dialog)).toBeNull()
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/selectors-source.test.ts -t "no submit-type fallback"`
Expected: FAIL —— 現行実装は `<button type="submit">Go</button>` を拾い `Go` を返すため `toBeNull()` が失敗。

- [ ] **Step 3: 最小実装**

`src/content/selectors.ts` の `SELECTORS` から `sourceSubmit` 行を削除する（16〜19行付近）。

```ts
// Before（該当行を削除）
  sourceSubmit: 'button[type="submit"]',
```

続けて `getSourceSubmitButton`（103〜109行）を変更する。

```ts
// Before
export function getSourceSubmitButton(dialog: HTMLElement): HTMLElement | null {
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
  return (
    buttons.find((b) => SOURCE_TEXT.submit.test((b.textContent ?? '').trim())) ??
    dialog.querySelector<HTMLElement>(SELECTORS.sourceSubmit)
  )
}
// After
export function getSourceSubmitButton(dialog: HTMLElement): HTMLElement | null {
  // 実 DOM の挿入ボタンは type="button"。テキスト（ja/en）で一致させる。
  // 死んだ button[type="submit"] フォールバックは撤去（無関係な submit の誤クリック防止）。
  const buttons = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
  return buttons.find((b) => SOURCE_TEXT.submit.test((b.textContent ?? '').trim())) ?? null
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/selectors-source.test.ts` かつ `npm run typecheck`
Expected: 両方 PASS（`sourceSubmit` の未参照化による型エラーが無いこと。`getSourceSubmitButton` からの参照を消したので `SELECTORS.sourceSubmit` を参照する箇所は残らない）

- [ ] **Step 5: コミット**

```bash
git add src/content/selectors.ts tests/selectors-source.test.ts
git commit -m "fix(#37): 挿入ボタンの死んだ submit フォールバックを撤去

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `getAddSourceButton` / `getSourceUrlInput` を安定属性で先行マッチ

実 DOM の安定クラス `add-source-button` と属性 `formcontrolname="urls"` を第一候補にし、従来のテキスト / タイプ探索をフォールバックに残す（テキスト主軸の設計思想を維持しつつ誤マッチ耐性を上げる）。

**Files:**
- Modify: `src/content/selectors.ts:71-81`（`getAddSourceButton`）, `src/content/selectors.ts:94-101`（`getSourceUrlInput`）
- Test: `tests/selectors-source.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `getAddSourceButton(root?): HTMLElement | null` —— `data-nlk` 配下を除外した上で `button.add-source-button` を最優先、無ければ従来の aria-label / テキスト探索。
  - `getSourceUrlInput(dialog): HTMLInputElement | HTMLTextAreaElement | null` —— `textarea[formcontrolname="urls"]` を最優先、無ければ従来の input → textarea フォールバック。

- [ ] **Step 1: 失敗するテストを書く**

`tests/selectors-source.test.ts` に以下2件を追加する（`getAddSourceButton` 系テスト群の末尾と `getSourceUrlInput` テストの直後）。

```ts
  it('getAddSourceButton prefers the stable add-source-button class', () => {
    document.body.innerHTML = `
      <button aria-label="ソースを追加">別ボタン</button>
      <button class="add-source-button" aria-label="ソースを追加"><span>add ソースを追加</span></button>`
    expect(getAddSourceButton()?.classList.contains('add-source-button')).toBe(true)
  })

  it('getSourceUrlInput prefers textarea[formcontrolname="urls"]', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `<input type="url"><textarea formcontrolname="urls"></textarea>`
    const el = getSourceUrlInput(dialog)
    expect(el?.tagName).toBe('TEXTAREA')
    expect(el?.getAttribute('formcontrolname')).toBe('urls')
  })
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run tests/selectors-source.test.ts -t "prefers"`
Expected: FAIL —— `getAddSourceButton` は現状 aria-label 一致の最初の要素（`別ボタン`）を返し、`getSourceUrlInput` は現状 `input[type="url"]` を優先するため両方失敗。

- [ ] **Step 3: 最小実装**

`src/content/selectors.ts` の `getAddSourceButton`（71〜81行）を変更する。

```ts
// After（buttons フィルタは維持し、安定クラスを最優先の find に追加）
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
```

続けて `getSourceUrlInput`（94〜101行）を変更する。

```ts
// After（安定属性 textarea[formcontrolname="urls"] を最優先に）
export function getSourceUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null {
  return (
    dialog.querySelector<HTMLTextAreaElement>('textarea[formcontrolname="urls"]') ??
    dialog.querySelector<HTMLInputElement>('input[type="url"]') ??
    dialog.querySelector<HTMLInputElement>('input[type="text"]') ??
    dialog.querySelector<HTMLInputElement>('input:not([type])') ??
    dialog.querySelector<HTMLTextAreaElement>('textarea')
  )
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run tests/selectors-source.test.ts`
Expected: PASS（新規2件と既存の `data-nlk 除外` / `unrelated 追加` / `input/textarea フォールバック` ケースが全て緑）

- [ ] **Step 5: コミット**

```bash
git add src/content/selectors.ts tests/selectors-source.test.ts
git commit -m "fix(#37): ソース追加ボタン/URL入力を安定属性で先行マッチ

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 暫定コメント解消とドキュメント更新

コード変更に合わせて `selectors.ts` の「暫定」表記を「実機調査済み」に更新し、実 DOM 調査結果を `requirements.md` に記録、`e2e-checklist-phase2.md` §0 を「検証済み」に更新する。

**Files:**
- Modify: `src/content/selectors.ts:13-15`（冒頭コメント）
- Modify: `docs/requirements.md`（§8.6 新規追加、§10 のチェックボックス更新）
- Modify: `docs/e2e-checklist-phase2.md`（§0）

- [ ] **Step 1: `selectors.ts` の冒頭コメントを更新**

`src/content/selectors.ts:13-15` を置き換える。

```ts
// Before
  // ---- 以下 Phase 2（ソース追加フロー）。実 DOM 調査は未実施の暫定セレクタ。----
  // クラス名 churn に強いよう、テキスト / aria-label マッチング（SOURCE_TEXT）を主軸にする。
  // 実機確認は docs/e2e-checklist-phase2.md。ズレたらこのファイルだけを直す。
// After
  // ---- 以下 Phase 2（ソース追加フロー）。2026-07-03 実機調査済み（requirements.md §8.6）。----
  // クラス churn に強いよう、テキスト / aria-label マッチング（SOURCE_TEXT）を主軸にしつつ、
  // 候補集合を安定クラス（drop-zone-icon-button 等）で絞って誤マッチを防ぐ。
  // UI が変わったらこのファイルだけを直す。実機確認手順は docs/e2e-checklist-phase2.md §0。
```

- [ ] **Step 2: `requirements.md` に §8.6 を追加**

`docs/requirements.md` の「## 9. スコープ外（当面）」の直前（現在の §8.5 の末尾）に、以下の節を挿入する。

```markdown
## 8.6 NotebookLM ソース追加フロー DOM 調査結果（2026-07-03 実機確認）

Phase 2（URL / タブ一括インポート）で使うソース追加フローの実 DOM を確認済み。
セレクタは `src/content/selectors.ts` に集約し、テキスト / aria-label マッチを主軸に、
候補集合を下記の安定クラス / 属性で絞る方針。

- **ソース追加ボタン**: `button.add-source-button`（`aria-label="ソースを追加"`）。左ソースパネル内。
- **ダイアログ**: `mat-dialog-container`（削除確認と同じコンテナ要素）。
- **ソース種別ボタン群**: 「ファイルをアップロード / ウェブサイト / ドライブ / コピーしたテキスト」の4つ。
  すべて `button.drop-zone-icon-button`。ウェブサイトは `button.drop-zone-icon-button > span「ウェブサイト」`。
  同ダイアログ内にテキスト「ウェブ」を含む種別ドロップダウンボタン（`drop-zone-icon-button` 非該当）が別に存在する
  ため、種別チップは `button.drop-zone-icon-button` に限定して誤マッチを避ける。
- **URL 入力**: `textarea[formcontrolname="urls"]`（placeholder「リンクを貼り付ける」）。`input` 系は無し。
  ダイアログに「複数の URL はスペース / 改行区切りで1回受付」の記載あり（一括投入は別 issue で検討）。
- **挿入ボタン**: テキスト「挿入」`button[type="button"]`（`mdc-button--unelevated`, `mat-primary`）。
  `type="submit"` ではないため、`button[type="submit"]` フォールバックは使わずテキストマッチに一本化する。
```

- [ ] **Step 3: `requirements.md` §10 のチェックボックスを更新**

`docs/requirements.md` の §10 内、Phase 2 の DOM 調査行（現在163〜165行）を以下に置き換える。

```markdown
- [x] Phase 2（ソース追加フロー）の DOM 調査。→ 「8.6」に記録（2026-07-03）。実装は
  `selectors.ts` に反映済み。実機確認手順は `docs/e2e-checklist-phase2.md` §0。
```

- [ ] **Step 4: `e2e-checklist-phase2.md` §0 を更新**

`docs/e2e-checklist-phase2.md` の冒頭説明（3〜5行）と §0（10〜21行）を以下で置き換える。

冒頭説明（3〜5行）:

```markdown
ソース追加フローの実 DOM は 2026-07-03 に実機確認済み（`docs/requirements.md` §8.6）。
セレクタはテキスト / aria-label マッチを主軸に、候補を安定クラス / 属性で絞っている。
UI が変わったら §0 で再検証し、`src/content/selectors.ts` だけを直す。
```

§0（10〜21行）:

```markdown
## 0. セレクタの実機再検証（UI 変更が疑われるときに実施）

2026-07-03 時点で確認済みの実 DOM。UI 変更が疑われたら DevTools で以下を再確認する:

- [x] ソース追加ボタン: `button.add-source-button`（`aria-label="ソースを追加"`）が左ソースパネルにある
- [x] クリックで `mat-dialog-container` が出る
- [x] 種別ボタン「ウェブサイト」は `button.drop-zone-icon-button`（4種別共通クラス）
- [x] チップクリック後、`textarea[formcontrolname="urls"]`（placeholder「リンクを貼り付ける」）が出る
- [x] 「挿入」ボタンは `button[type="button"]`（テキスト「挿入」/ "Insert"）で URL 入力により有効化される
- [x] 挿入後にダイアログが閉じ、ソース一覧に追加される

ズレがあった場合: `selectors.ts` を修正 → 再ビルド → 本セクションを再確認。
```

- [ ] **Step 5: コミット**

```bash
git add src/content/selectors.ts docs/requirements.md docs/e2e-checklist-phase2.md
git commit -m "docs(#37): ソース追加フローの実 DOM 調査結果を記録し暫定表記を解消

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 複数 URL 一括投入の検討 issue を作成

実 DOM 調査で判明した「NotebookLM の URL 入力 textarea は複数 URL を1回で受付」を別 issue に記録する（#37 スコープ外）。ユーザー補足（まとめたい/別々にしたい両方の要望に応えられる設計が望ましい）を含める。

**Files:** なし（GitHub issue 作成のみ）

- [ ] **Step 1: `priority: low` ラベルの存在確認・無ければ作成**

Run:
```bash
gh label list | grep -i "priority: low" || gh label create "priority: low" --description "低優先度" --color "0e8a16"
```
Expected: 既存ならラベル行が表示され、無ければ作成される（`enhancement` は既存）。

- [ ] **Step 2: issue を作成**

Run:
```bash
gh issue create \
  --title "importer の複数 URL 投入を「一括 / 逐次」で選べるようにする" \
  --label "enhancement" --label "priority: low" \
  --body "$(cat <<'EOF'
## 背景

2026-07-03 の実 DOM 調査（issue #37）で、NotebookLM のソース追加ダイアログの URL 入力欄
（`textarea[formcontrolname="urls"]`）は「複数の URL をスペース / 改行区切りで1回受付」できることが
判明した（ダイアログ内に明記あり）。

現行 `src/content/importer.ts` は 1 URL ずつ「追加 → ウェブサイト → 入力 → 挿入」を逐次実行している。

## 検討事項

- **一括投入**: textarea に全 URL をまとめて入れて1回で挿入 → 大幅な高速化・DOM 往復削減の余地。
- **逐次投入（現行）**: 1件ずつ完了判定できる。途中失敗の切り分けが容易。

## ユーザー要望（#37 ブレインストーミングより）

- 「同じカテゴリとして見たいものを1つのノートブックにまとめたい」ケースでは複数 URL をまとめて入れたい。
- 一方で「別々のソースとして扱いたい」ケースもある。
- → **どちらも選べる設計**（一括 / 逐次を切り替え可能）が望ましい。

## やること（案）

- [ ] 一括投入モードの実装（textarea へ改行区切りで一括入力 → 1回挿入）。
- [ ] UI に「まとめて追加 / 個別に追加」の選択肢を用意。
- [ ] 一括時の完了判定・失敗ハンドリング（部分失敗の扱い）を設計。

## 参照

- `docs/requirements.md` §8.6（実 DOM 調査結果）
- `docs/superpowers/specs/2026-07-03-phase2-selector-hardening-design.md` §5
- `src/content/importer.ts`
EOF
)"
```
Expected: 新しい issue の URL が表示される。

---

### Task 6: 最終検証

全変更を通しで検証する。

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェック**

Run: `npm run typecheck`
Expected: エラー0（未使用変数・引数のエラーが無いこと。特に `SELECTORS.sourceSubmit` の削除に伴う参照残りが無いこと）

- [ ] **Step 2: 全テスト**

Run: `npm test`
Expected: 全テスト PASS（`selectors-source.test.ts` の新規・更新分を含む）

- [ ] **Step 3: ビルド確認**

Run: `npm run build`
Expected: `dist/` が生成され、ビルドエラーが無い

---

## Self-Review

**Spec coverage（spec §7 受け入れ基準との対応）:**
- selectors.ts コメント「実機調査済み」更新 → Task 4 Step 1 ✅
- `sourceChipCandidates` の裸 button 限定 → Task 1 ✅
- `sourceSubmit` フォールバック撤去 → Task 2 ✅
- 各 getter に安定属性の第一候補 → Task 1（chip 候補）/ Task 3（add-source / url-input）/ Task 2（submit はテキスト一本化）✅
- 誤マッチ回帰テスト → Task 1（bare button ignore）/ Task 2（submit-type 非検出）✅
- `npm test` / `npm run typecheck` 緑 → Task 6 ✅
- requirements §8.6 / e2e-checklist §0 更新 → Task 4 ✅
- 複数 URL 一括投入 issue 作成 → Task 5 ✅

**Placeholder scan:** TBD / TODO なし。各コード step に実コードあり。

**Type consistency:** getter シグネチャは全 Task で不変（`getWebsiteChip(dialog): HTMLElement|null`、`getSourceSubmitButton(dialog): HTMLElement|null`、`getAddSourceButton(root?): HTMLElement|null`、`getSourceUrlInput(dialog): HTMLInputElement|HTMLTextAreaElement|null`）。`SELECTORS.sourceSubmit` は Task 2 で削除し、参照箇所（`getSourceSubmitButton` 内のみ）も同 Task で除去 → 参照残りなし。
