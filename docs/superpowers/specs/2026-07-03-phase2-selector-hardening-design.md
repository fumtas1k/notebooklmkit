# 設計書 — Phase 2 ソース追加フローの暫定セレクタ堅牢化（issue #37）

> 対応 issue: #37「ソース追加フローの暫定セレクタを実機 DOM 確認後に堅牢化する」
> ステータス: 承認済み（2026-07-03）
> 前提設計: `docs/superpowers/specs/2026-07-02-phase2-import-design.md` §3 / §6.6

## 1. 目的

Phase 2（ソース追加フロー）のセレクタは実 DOM 未調査の**暫定実装**だった。
2026-07-03 に実機（`notebooklm.google.com`、UI 言語 = 日本語、Chrome）で
DOM を調査し、その結果に基づいて `selectors.ts` の候補セレクタを絞り込み、
暫定ステータスを解消する。

**方針（設計書 §3 を踏襲）:** マッチングの主軸はテキスト / aria-label のまま維持し、
候補集合を安定クラス（`mdc-*` / `mat-*` / `formcontrolname` 等）で絞ることで
**誤マッチを消す**。クラス churn 耐性を捨てず、最小変更で #37 の指摘に応える。

## 2. 実 DOM 調査結果（2026-07-03）

ノートブックページ（`/notebook/<id>`）でソース追加フローを実機確認した。

| フロー要素 | 実 DOM | 現行セレクタの当たり | 備考 |
|---|---|---|---|
| ソース追加ボタン | `button.add-source-button` + `aria-label="ソースを追加"`、テキスト `add ソースを追加` | ✅ aria-label マッチで当たる | 安定クラス `add-source-button` あり。拡張自身の「選択したタブを追加」ボタンは `data-nlk` 配下で既に除外 |
| ダイアログ | `<mat-dialog-container>`（`role="dialog"` の div も内包） | ✅ 正しい | 変更不要 |
| ソース種別ボタン群 | ファイル / ウェブサイト / ドライブ / コピーしたテキストの4つ。**全て `button.drop-zone-icon-button`**。ウェブサイトは `button.drop-zone-icon-button > span「ウェブサイト」` | ⚠️ 裸 `button` でのみ当たる | 同ダイアログ内にテキスト「ウェブ」を含む種別ドロップダウンボタン（`drop-zone-icon-button` 非該当）が別に存在し、誤マッチ余地がある |
| URL 入力 | `textarea[formcontrolname="urls"]`（placeholder「リンクを貼り付ける」）。`input[type=url/text]` 等は無し | ✅ textarea フォールバックで当たる | 安定属性 `formcontrolname="urls"` あり。ダイアログに「複数 URL はスペース / 改行区切りで1回受付」の記載（→ §5 別 issue） |
| 挿入ボタン | テキスト「挿入」`button[type="button"]`（`mdc-button--unelevated`, `mat-primary`）。**`type="submit"` ではない** | ✅ テキストマッチで当たる | 現行の `button[type="submit"]` フォールバックは実 DOM に存在せず**死んでいる** |

**結論:** #37 の指摘（裸 `button` による誤マッチ源、広すぎる `type="submit"` フォールバック）は
実 DOM で裏付けられた。いずれも安定クラス / 属性で候補を絞ることで解消できる。

## 3. `selectors.ts` の変更

### 3.1 `SELECTORS` 定数

```ts
// Before
sourceChipCandidates: 'mat-chip, .mdc-evolution-chip, [role="option"], button',
sourceSubmit: 'button[type="submit"]',

// After
// 裸 button を drop-zone-icon-button に限定（実 DOM: 種別4ボタン共通クラス）。
// mat-chip / .mdc-evolution-chip / [role="option"] は将来 UI が chip 化した場合の
// 保険として残す（特定要素なので誤マッチしない）。
sourceChipCandidates: 'mat-chip, .mdc-evolution-chip, [role="option"], button.drop-zone-icon-button',
// sourceSubmit は撤去（実 DOM は type="button"。死にフォールバックは誤クリック源）。
```

### 3.2 各 getter（安定属性を第一候補・従来ロジックをフォールバックに）

- **`getAddSourceButton`**: `button.add-source-button`（`data-nlk` 配下は除外、現行同様）を
  第一候補にし、無ければ従来の aria-label / テキスト探索にフォールバック。
- **`getWebsiteChip`**: 候補集合（§3.1）を絞った上で従来のテキストマッチ（ロジック自体は不変）。
- **`getSourceUrlInput`**: `textarea[formcontrolname="urls"]` を第一候補にし、
  無ければ従来の `input[type=url]` → `input[type=text]` → `input:not([type])` → `textarea` フォールバック。
- **`getSourceSubmitButton`**: テキスト「挿入 / insert」マッチ**のみ**にする
  （`button[type="submit"]` フォールバック撤去）。見つからなければ呼び出し側 importer の
  `waitFor` がタイムアウトし、Phase 2 規約どおり**安全に停止**する。

いずれも「安定属性で候補を絞る + 従来のテキスト/属性マッチをフォールバックに残す」形で、
テキスト主軸の設計思想（クラス churn 耐性）を維持する。挿入ボタンのみ、破壊的操作
（ソース追加）の誤クリックを避けるためフォールバックを撤去し、確実なテキストマッチに一本化する。

## 4. テスト（`tests/selectors.test.ts` ソース追加分）

- 既存フィクスチャを実 DOM 構造に合わせて更新:
  - 種別ボタンを `button.drop-zone-icon-button > span` 構造に。
  - URL 入力を `textarea[formcontrolname="urls"]` に。
  - 挿入ボタンを `button[type="button"]` + テキスト「挿入」に（`type="submit"` を外す）。
  - ソース追加ボタンを `button.add-source-button` + `aria-label` に。
- **誤マッチ回帰テストを追加:**
  - 同ダイアログ内にテキスト「ウェブ」を含む別ボタン（種別ドロップダウン相当、
    `drop-zone-icon-button` 非該当）があっても `getWebsiteChip` がそれを拾わないこと。
  - `getSourceSubmitButton` が挿入テキストのないダイアログでは `null` を返すこと
    （フォールバック撤去により `button[type="submit"]` を誤検出しない）。
- 既存の「不在時 null」「data-nlk 除外」ケースは維持。

## 5. スコープ外（別 issue 化）

- **複数 URL の一括投入:** NotebookLM の URL 入力 textarea は「スペース / 改行区切りで
  複数 URL を1回受付」できることが判明した。現行 importer は 1 URL ずつ逐次実行している。
  一括投入に切り替えれば高速化・堅牢化の余地がある一方、ユーザー要望として
  「複数 URL を1つのノートブックにまとめたい」ケースと「別々のソースとして扱いたい」ケースの
  両方があり得るため、**どちらも選べる設計**が望ましい。#37 のスコープ外として
  新規 issue（`enhancement` / `priority: low`）に記録し、別途検討する。

## 6. スコープ外（本 issue で対応しない）

- importer.ts / import-panel.ts のロジック変更（セレクタ getter のシグネチャは不変に保つ）。
- F2-2（issue #36）。
- Phase 3 全機能。

## 7. 受け入れ基準

- [ ] `selectors.ts` のソース追加フロー暫定コメントが「2026-07-03 実機調査済み」に更新される。
- [ ] `sourceChipCandidates` の裸 `button` が `button.drop-zone-icon-button` に限定される。
- [ ] `sourceSubmit`（`button[type="submit"]`）フォールバックが撤去される。
- [ ] 各 getter が安定属性を第一候補・従来ロジックをフォールバックに持つ。
- [ ] 誤マッチ回帰テストを含め `npm test` が緑。
- [ ] `npm run typecheck` が緑。
- [ ] `docs/requirements.md` §8.5 相当に実 DOM 調査結果、`docs/e2e-checklist-phase2.md` §0 が
      「検証済み」に更新される。
- [ ] 複数 URL 一括投入の検討 issue が作成される。
