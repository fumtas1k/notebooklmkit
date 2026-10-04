#!/usr/bin/env bash
# src/content/selectors.ts を単体の IIFE にバンドルする（実ページ検証用）。
#
# 出力した JS を実 NotebookLM ページの DevTools コンソール（または Claude in Chrome の
# javascript_tool）に貼ると、グローバル `NLK` から拡張と同一のセレクタ関数を呼べる。
# 拡張を再ビルド・再読込せずに、判定結果を実 DOM で測れる（CLAUDE.md「DOM 自動化の gotcha」）。
#
#   scripts/bundle-selectors.sh            # → .cache/nlk-selectors.js
#   scripts/bundle-selectors.sh out.js     # → out.js
#
# ページ側での点検例:
#   const rows = NLK.getNotebookRows()
#   ({ rows: rows.length,
#      deletable: rows.filter(NLK.isDeletableRow).length,
#      idKeys: rows.filter((r) => NLK.getRowKey(r).startsWith('id:')).length,
#      createBtn: !!NLK.getCreateNewButton() })
set -euo pipefail
cd "$(dirname "$0")/.."

out="${1:-.cache/nlk-selectors.js}"
mkdir -p "$(dirname "$out")"
# --no-install: node_modules が無い worktree で npx がインストール確認のまま固まるのを防ぐ。
npx --no-install esbuild src/content/selectors.ts \
  --bundle --format=iife --global-name=NLK --minify --log-level=warning --outfile="$out"
echo "$out ($(wc -c < "$out" | tr -d ' ') bytes)"
