# MutationObserver の characterData 監視追加 設計（issue #28）

日付: 2026-07-02
ステータス: 承認済み
対象 issue: #28

## 背景 / 問題

`src/content/main.ts` の一覧再スキャン observer は `{ childList: true, subtree: true }` のみを監視している（init 時と、削除完了後の finally での再接続の2箇所）。Angular のインターポレーション更新（`{{title}}`）は既存テキストノードの `nodeValue` を書き換えるだけで childList レコードを発生させないため、**タイトルだけがその場で変わるケースでは #25 の再同期（`injectRowCheckboxes` の既存チェックボックス同期）が一度も走らない**。

特に**リネームフロー**が該当する: リネームのメニュー / ダイアログは `.cdk-overlay-container`（監視対象コンテナの外）に出るため、監視対象内に残る変化がタイトルテキストの characterData 更新だけになり得る。その場合、チェックボックスのキー（`data-nlk-checkbox`）/ `aria-label` / `checked` が stale なまま残る。

### 補足の問題（issue #28 の「補足」）

行挿入とタイトル span 充填の間に observer が発火すると、`getRowIdentity` が `''` を返し、`aria-label=""` / キー `title:` を書き込む（`makeTarget` に空文字ガードなし）。通常は後続の childList 変化で自己修復するが、stale が固定化し得る。

## 決定事項

observer の `observe` オプションに `characterData: true` を追加する。あわせて `injectRowCheckboxes` に空タイトルガードを追加し、タイトル未充填（identity が空文字）の行は注入・同期ともにスキップする。

### 検討した代替案

- **MutationRecord のフィルタリング**（タイトル span 配下の変化のときだけ再注入）— churn は最小になるが、observer コールバックがセレクタ構造（`span.project-table-title`）と結合し複雑化する。PR #27 で導入済みの「キー変化時のみ属性書き込み」ガードにより、無条件再スキャンのコストは既に十分低い（キー不変なら読み取り＋比較のみ）。不採用（YAGNI）。
- **observer コールバックの debounce** — 同期の遅延と時序の複雑さ（テスト含む）を持ち込む。MutationObserver は元々レコードをバッチで届けるため、追加のバッチングは不要。不採用。

## 設計

変更ファイル: `src/content/main.ts`、`src/content/ui/row-checkbox.ts`（＋テスト、e2e チェックリスト）。

### 1. `main.ts`: observe オプションの共通化と characterData 追加

```ts
// 一覧再スキャン observer の監視オプション。characterData は Angular の
// インターポレーション更新（{{title}} が既存テキストノードの nodeValue を
// 書き換えるだけで childList レコードを出さない）に追従するため（issue #28）。
const LIST_OBSERVE_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
}
```

- `init()` 内の `observer.observe(container, ...)`（2箇所: 初期接続・削除後 finally の再接続）を、この共有定数を使うように変更する。2箇所のオプションが乖離しないようにするのが目的。
- `start()` の bootstrapObserver は**変更しない**（`.all-projects-container` の出現待ちであり、childList だけで十分。characterData を足すと起動待ちの churn が増えるだけ）。

### 2. `row-checkbox.ts`: 空タイトルガード

`injectRowCheckboxes` のループ先頭で、identity のタイトルが空文字の行はスキップする（注入も既存チェックボックスの同期も行わない）:

- 空キー `title:` / `aria-label=""` の書き込みが起こらなくなる。
- スキップしても、タイトル充填時に characterData（既存テキストノードの書き換え）または childList（テキストノード追加）レコードが発火して再同期されるため、注入漏れは固定化しない（characterData 監視の追加が、この自己修復の成立条件でもある）。

### 3. churn への影響

`characterData: true` により無関係なテキスト変化（日付セルの更新など）でもコールバックが増えるが、#27 のガード（キー不変なら属性書き込みなし）により、各発火のコストは行数ぶんの `querySelector` ＋文字列比較に収まる。`checked` の代入は毎回行われるが、DOM プロパティ代入のみでレイアウトへの影響はない。

### 4. 既知の制約（変更しない挙動）

- リネーム後、旧キーは `SelectionStore` に残留する（title ベース選択の既知トレードオフ。CLAUDE.md / issue #31, #32 参照）。本件は「チェックボックスの表示・属性が現在の行の identity と一致すること」を保証するもので、ストアの prune は行わない。
- リネームで実際に characterData のみの変化になるかは実機でしか確認できないため、e2e チェックリストに手動確認項目を追加する。

## テスト

`tests/main-wiring.test.ts` に追加:

1. **リネーム追従**: `init()` 後、タイトル span のテキストノードの `nodeValue` をその場で書き換える（childList を発生させない）→ microtask フラッシュ後、チェックボックスの `data-nlk-checkbox` キーと `aria-label` が新タイトルに更新され、`checked` が新キーの store 状態を反映すること。
2. **削除後の再接続でも characterData を監視すること**（finally 経路の再接続が同じオプションを使うこと）。`MutationObserver.prototype.observe` のスパイでオプション引数を検証する。

`tests/row-checkbox.test.ts` に追加:

3. **空タイトルガード（新規注入）**: タイトル span が空の行にはチェックボックスを注入しないこと。タイトルが充填された後の再実行で注入されること。
4. **空タイトルガード（既存同期）**: 既存チェックボックスのある行のタイトルが一時的に空になっても、キー `title:` / `aria-label=""` を書き込まないこと。

既存テストは全て変更なしで通ること。

## ドキュメント

- `docs/e2e-checklist-phase1.md` に手動確認項目を追加: ノートブックをリネームし、チェックボックスの `aria-label` / 選択キーが新タイトルへ追従すること（characterData のみの変化になるケースの実機確認。issue #28 の「発火条件」確認事項）。
