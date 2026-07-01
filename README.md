# notebooklmkit

Google NotebookLM（コンシューマ版）を便利にする Chrome 拡張機能（Manifest V3）。

NotebookLM の Web UI は大量のノートブックやソースを扱うときの操作コストが高い。本拡張はそうした繰り返し作業を一括化する。NotebookLM には公開 API が無いため、すべて **content script による DOM 自動化**（NotebookLM 自身の UI フローを自動操作）で実現している。

対象は**コンシューマ版**（`https://notebooklm.google.com/`、無料 / Plus）。Enterprise 版は対象外。

## 機能

- **Phase 1（実装済み）** — ノートブック一覧の複数選択・一括削除
  - 各行にチェックボックスを注入し、「すべて選択 / 解除」と「選択した N 件を削除」を提供
  - 削除は NotebookLM 標準フロー（3点メニュー→削除→確認ダイアログ）を1件ずつ自動実行
  - 進捗表示・途中中断・失敗時の安全停止
  - 削除は取り消し不可のため、大量 / 全選択時は件数入力による強い確認を要求
- **Phase 2（計画中）** — 開いているタブ / URL リストの一括インポート

詳細な要件・フェーズ計画は [`docs/requirements.md`](docs/requirements.md) を参照。

## インストール（開発版）

```bash
npm install
npm run build   # dist/ を生成
```

1. Chrome で `chrome://extensions` を開く
2. 「デベロッパー モード」を ON
3. 「パッケージ化されていない拡張機能を読み込む」→ `dist/` を選択
4. `https://notebooklm.google.com/` を開くと、一覧に選択 UI が表示される

## 開発

```bash
npm run dev        # vite dev（HMR）
npm test           # vitest run（全テスト、jsdom）
npm run typecheck  # tsc --noEmit（strict）
```

技術スタックは TypeScript + Vite + [@crxjs/vite-plugin](https://github.com/crxjs/chrome-extension-tools) + Vitest。コード構成・アーキテクチャの詳細は [`CLAUDE.md`](CLAUDE.md) を参照。

## プライバシー

- 権限は `host_permissions: notebooklm.google.com` のみ（最小化）
- 外部ネットワーク送信ゼロ・トラッカー無し（すべて端末内で完結）
- ネットワーク通信は NotebookLM への操作のみ

## 注意事項

- 非公式手段のため、NotebookLM の UI 更新で動作しなくなる可能性がある（セレクタは [`src/content/selectors.ts`](src/content/selectors.ts) に集約）。
- 削除は**取り消し不可**。特に一括削除は対象をよく確認すること。
- 同名タイトルのノートブックは区別できない（既知のエッジケース）。

## ライセンス

[MIT](LICENSE)
