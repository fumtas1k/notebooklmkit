# F2-2 クリップ経路の拡張: バックグラウンド起動 ＋ 音声解説の自動押下

- 対象 issue: #50, #51
- 日付: 2026-07-04
- 方針: **別々の PR** として #50 → #51 の順に実装（squash マージ）

## 背景

ツールバーアイコンからの「現ページで新規ノートブック作成」（F2-2 クリップ経路）を 2 点拡張する。
どちらも同じ経路（`background/main.ts` の `handleClipClick` → `content/main.ts` の
`handlePendingCreate` → `notebook-creator.ts` の `createNotebookWithUrls`）に載るが、
規模とリスクが異なるため PR を分割する。

- **#50**: 新規 NotebookLM タブを**バックグラウンド**で開き、元タブをアクティブのままにする（実質 1 行）。
- **#51**: ノートブック作成後に**音声解説（Audio Overview）の生成ボタンまで自動押下**する（新ロジック＋DOM 調査）。

バッジ（'…'→'✓'/'!'）は #47 で元タブ X にスコープ済み。

---

## PR-A: #50 バックグラウンドで開く

### 変更

- `src/background/main.ts` `handleClipClick`: `d.createTab({ url: NOTEBOOK_HOME, active: true })`
  を `active: false` に変更。コメントを「バックグラウンドで開く（元タブをアクティブのまま。
  #47 の元タブバッジ設計と一貫）」へ更新。
- `tests/background-clip.test.ts`: `createTab` に渡る期待値を `active: false` に更新。

### 判断とトレードオフ

- **バックグラウンドタブのタイマースロットリング**（Chrome は非アクティブタブの `setTimeout` を
  最小 ~1s に間引く）で、`waitFor` ポーリングや Angular SPA のレンダリングが遅延し、
  作成フローが**タイムアウト → 安全停止（バッジ '!'）**になる恐れがある。
- **`waitFor` のタイムアウトは先回りで変更しない。** まず現状値でバックグラウンド作成が完走するかを
  実機 E2E で確認し、落ちる場合にのみ調整する（過剰なタイムアウト延長を避ける）。
- #47 の設計意図（元タブ X にバッジ統一）と整合。元タブがアクティブのままなので
  '…'→'✓'/'!' がそのまま見える。

### E2E

- `docs/e2e-checklist-phase2.md` §2.5（F2-2）に沿ってバックグラウンド完走を確認する項目を追記。

---

## PR-B: #51 音声解説の自動押下（作成成功と切り離す best-effort）

### 決定事項

- **常にトリガー**（デフォルト実行。将来のトグルは今回スコープ外）。
- **作成成功と切り離す（best-effort）**: 音声解説ボタンの押下に失敗しても、ノートブックが
  作成できていればバッジは '✓'。失敗は `console.warn` のみ。既存バッジ意味論
  （'✓' ＝ ノートブック作成済み）と整合させる。
- セレクタは**テキスト一致ヒューリスティック**で暫定実装し、**実機 E2E で堅牢化**（§8.6 と同じ二段階）。

### アーキテクチャ

音声解説押下を `createNotebookWithUrls` の内部に混ぜず、**独立関数に分離**する
（単一責務・decouple 決定に整合・独立テスト可能）。

- `src/content/notebook-creator.ts` に `triggerAudioOverview(deps, opts?)` を新設。
  - DI・DOM 非依存の純ロジック。`AudioOverviewDeps { getAudioOverviewButton, click, waitFor, timeout? }`。
  - 処理: 「ボタンが present かつ enabled（`disabled` でない）になるまで `waitFor` → click」。
  - 専用タイムアウト既定 **30000ms**（ソース解析中はボタンが無効の可能性があるため
    `createNotebookWithUrls` の 15s より長め。E2E で調整）。
  - 戻り値は boolean（`createNotebookWithUrls` と同じく**内部で try/catch し例外を投げない**）。
    失敗（要素不在 / 無効のまま / タイムアウト / 中断）は false を返す。
- `src/content/main.ts` `defaultCreateRunner`:
  ```
  const ok = await createNotebookWithUrls(urls, {...})
  if (ok) {
    // best-effort。triggerAudioOverview は例外を投げないが、防御的に try/catch する
    try { await triggerAudioOverview({...}) } catch { /* console.warn */ }
  }
  return ok
  ```
  音声解説の成否は戻り値に影響させない。

### セレクタ（`src/content/selectors.ts` に集約）

- `SOURCE_TEXT.audioOverview = /音声解説|音声概要|Audio Overview/i` を追加。
- `getAudioOverviewButton(root: ParentNode = document): HTMLElement | null`:
  - `button` 群から自拡張 UI（`[data-nlk]` 配下）を除外。
  - text / aria-label が `audioOverview` に一致するものを、可能なら Studio パネルの安定クラス
    （`mat-*` / `mdc-*`）で絞って返す。`ng-tns-*` / `_ngcontent-*` には依存しない。
  - **暫定セレクタ**（実機未確認）である旨をコメントに明記。
- `docs/requirements.md` §8 に音声解説ボタンの調査欄を「暫定・実機未確認」マーク付きで追記。

### 未確定点（実機 E2E で確定 → 堅牢化）

1. **ボタンが有効化されるタイミング**: ソース挿入直後はソース処理中でボタンが無効/未表示の可能性。
   専用タイムアウト（30s）内に present+enabled にならなければ best-effort で諦める。
2. **生成前のカスタマイズ/確認ダイアログ**: 長さ・言語等の UI が挟まる場合がある。
   今回は「生成ボタン1押下」までをスコープとし、追加ダイアログの操作は E2E 判明後に別対応（スコープ外）。
3. **バックグラウンドスロットリング**（#50 とのコンボ）: バックグラウンドタブでは音声解説ボタンの
   有効化がさらに遅延し得る。E2E で 30s の妥当性を確認。

### テスト

- `tests/notebook-creator.test.ts`: `triggerAudioOverview` の DI テスト
  （成功でクリック / ボタン不在でタイムアウト失敗 / 無効のまま失敗 / 中断）。
- `tests/selectors-source.test.ts`: `getAudioOverviewButton` の jsdom テスト
  （ja「音声解説」「音声概要」/ en「Audio Overview」テキスト一致、aria-label 一致、
  `[data-nlk]` 除外、`disabled` ボタンの扱い）。

### E2E

- `docs/e2e-checklist-phase2.md` に「作成後に音声解説生成がトリガーされること」の確認項目を追記。
- 実機確認でセレクタ / タイムアウト / ダイアログ有無を確定し、必要ならセレクタを堅牢化する
  フォロー作業（§8.6 → PR #41 と同じ流れ）。

---

## スコープ外（YAGNI）

- 音声解説の生成**完了**待ち（数分かかるため。トリガーまで）。
- 音声解説を有効/無効にするトグル UI・設定・修飾キー。
- カスタマイズダイアログ（長さ・言語・プロンプト）の自動操作。
- `chrome.notifications` によるバックグラウンド完了通知。
