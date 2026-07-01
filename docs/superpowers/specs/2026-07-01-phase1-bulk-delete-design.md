# Phase 1 設計書 — ノートブック一覧の複数選択・一括削除

> 対応要件: `docs/requirements.md` §4 Phase 1 / §8.5 DOM 調査結果
> ステータス: 承認済み（2026-07-01）

## 1. 目的

NotebookLM ダッシュボード（ノートブック一覧）に複数選択と一括削除を追加する。
NotebookLM 標準には複数選択が無く、削除は各行の3点メニューから1件ずつしかできない。

## 2. 確定した技術方針

| 項目 | 決定 |
|---|---|
| 操作方式 | DOM 自動化（要件 §3.2）。RPC 直接は非採用 |
| ビルド / 言語 | Vite + `@crxjs/vite-plugin` + TypeScript |
| テスト | Vitest + jsdom（ユニット中心）+ 手動E2Eチェックリスト |
| UI | 各行にチェックボックス注入 + **上部スティッキー**アクションバー |
| 強い確認 | 大量/全選択時は削除件数をタイプして一致で有効化 |
| 権限 | `host_permissions: https://notebooklm.google.com/*` のみ。外部送信ゼロ |
| i18n | 日本語 / 英語 |

## 3. ファイル構成

```
notebooklmkit/
├─ manifest.config.ts        # CRXJS manifest 定義
├─ vite.config.ts
├─ package.json
├─ tsconfig.json
├─ src/
│  ├─ content/
│  │  ├─ main.ts             # エントリ: 一覧検知 → UI 注入 → 配線
│  │  ├─ selectors.ts        # ★ DOM セレクタを一箇所に集約 (§8.5)
│  │  ├─ dom-utils.ts        # waitFor / safeClick / 出現待ち（純ロジック）
│  │  ├─ selection.ts        # 選択状態ストア（確定キー = title / 内部ID）
│  │  ├─ deleter.ts          # ★ 削除オーケストレータ（逐次/進捗/中断/失敗）
│  │  ├─ ui/
│  │  │  ├─ action-bar.ts    # 上部スティッキーバー（全選択/件数/削除ボタン）
│  │  │  ├─ row-checkbox.ts  # 各 tr へのチェックボックス注入
│  │  │  └─ confirm-dialog.ts# 通常確認 / 件数タイプ確認
│  │  └─ i18n.ts             # ja/en 文言マップ
│  └─ types.ts
├─ tests/                    # Vitest + jsdom
└─ docs/
   ├─ requirements.md
   └─ superpowers/specs/2026-07-01-phase1-bulk-delete-design.md（本書）
```

**設計原則**: DOM に触れる箇所は `selectors.ts` に集約する。`dom-utils` / `selection` / `deleter` /
`confirm-dialog` は DOM をノード引数として受け取る純粋寄りのモジュールとし、jsdom 上で単体テストできる。

## 4. DOM セレクタ（§8.5 準拠・selectors.ts に集約）

一覧:
- テーブル行: `div.all-projects-container project-table table.project-table tbody tr[mat-row][role="row"]`
- タイトル: 行内 `span.project-table-title`
- 操作メニューボタン: 行内 `project-action-button button.project-button-more`
- 内部ID: 行 `tr` の `jslog` 属性（同名対策の補助キー。機密扱い、ログ出力しない）

削除フロー（1件）:
- メニュー項目「削除」: `.cdk-overlay-container button.mat-mdc-menu-item.delete-button`
- 確認ダイアログ: `mat-dialog-container`
- 確定「Delete」: ダイアログ内 `button.primary-button`
- 取消: ダイアログ内 `button.tertiary-button`

対象は「自分が Owner のノートブック」に限定するのが安全（フィルタタブ「マイ ノートブック」相当）。
※ セレクタの網羅・堅牢化は実装時に実 DOM とテストで確定する。

## 5. データフロー

```
一覧描画検知(MutationObserver)
  → 各 tr にチェックボックス注入 + 上部バー注入
  → ユーザー選択（selection が {key, title, tr参照} を保持）
  → 「選択したN件を削除」
  → confirm-dialog: 通常 or 件数タイプ確認
  → deleter: 対象リストを先に確定（再描画対策 §8.5）
  → 1件ずつ:
       ① 対象 tr を title / 内部ID で再検索
       ② project-button-more クリック → メニュー出現待ち
       ③ delete-button クリック → mat-dialog-container 出現待ち
       ④ primary-button(Delete) クリック → 行が DOM から消えるのを待つ
       ⑤ 進捗更新 (例 3/10)
  → 完了 / 中断で結果表示（成功N / 失敗M）
```

- 主キーは title。取得できれば `jslog` 由来の内部IDを併用し同名を判別。
- テーブルは複数存在しうる（`project-table` ×2）。両テーブルの行を走査する。

## 6. 強い確認（F1-4）

- 閾値: **選択件数が 10 件以上、または全選択**のとき「件数タイプ確認」を表示。
- 通常（10件未満かつ非全選択）: 「N件を削除します」＋[キャンセル][N件を削除]。
- タイプ確認: 「N件を削除します。取り消せません。確認のため N と入力してください」。
  入力値が件数と一致したときだけ [削除] を有効化。
- 文言は取り消し不可であることを明示（要件 R4）。

## 7. エラー処理・中断（受け入れ基準対応）

- すべての要素待ちに **タイムアウト**（既定 5000ms）。超過はその件を「失敗」とし、
  オーケストレータは停止して結果を表示（クラッシュしない）。
- 期待要素（メニュー項目 / ダイアログ / Delete）が見つからない場合は例外を捕捉し、
  「DOM構造が想定と異なるため中断しました」を通知して停止。
- `AbortController` で任意中断可能。中断は処理中の1件が完了した時点で停止。
- 失敗・未処理の対象は選択状態に残し、成功分のみ選択解除。「成功N / 失敗M」を表示。
- ユーザーデータを壊さない: 想定外時は「何もせず止まる」を既定挙動とする。

## 8. 権限・プライバシー・i18n

- `host_permissions`: `["https://notebooklm.google.com/*"]` のみ。
- `permissions`: Phase 1 は content script 完結のため原則空（storage が必要になった時のみ追加）。
- 外部ネットワーク送信ゼロ。分析トラッカー等を入れない。
- 文言は ja / en の2言語。切替はブラウザ UI 言語に追従（`chrome.i18n` または簡易マップ）。

## 9. テスト方針

Vitest + jsdom によるユニットテスト。

| モジュール | テスト内容 |
|---|---|
| `selectors.ts` | jsdom に §8.5 の DOM を再現し、行 / メニューボタン / ダイアログ / Delete を取得できる |
| `dom-utils.ts` | `waitFor` が出現で解決 / タイムアウトで拒否する。`safeClick` の挙動 |
| `selection.ts` | 全選択 / 全解除 / 個別トグル / 件数 / 確定キー生成 |
| `deleter.ts` | モックDOMで「メニュー→削除→Delete」を順次実行。進捗更新。途中失敗で停止。中断で停止 |
| `confirm-dialog.ts` | 閾値で通常 / タイプ確認を出し分け、入力一致でのみ削除有効化 |

実 NotebookLM 上の確認は手動E2Eチェックリスト（別途 `docs/` に記載）で担保する。

## 10. 受け入れ基準（要件 §4 Phase 1）

- [ ] 一覧で任意の複数ノートブックを選択し、一括削除できる。
- [ ] 削除中に DOM 構造が想定外でも、クラッシュせずエラーを通知して停止する。
- [ ] 権限は `host_permissions: notebooklm.google.com` を中心に最小限。
- [ ] 大量 / 全選択時は件数タイプ確認を経ないと削除できない。
- [ ] ユニットテストが上記モジュールを網羅し、緑になる。

## 11. スコープ外（Phase 1 では扱わない）

- インポート機能（Phase 2）。
- popup / options UI（Phase 1 は content script 完結。将来拡張の余地は残す）。
- RPC 直接方式。
- ソースの一括削除（対象はノートブック一覧）。
