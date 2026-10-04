#!/usr/bin/env bash
# 破壊的機能（削除など）に触れる PR を、観点を指定して codex にレビューさせる。
#
# 既定の `codex exec review --base main` は観点を渡せず、#91 / #92 では「指摘なし」だった差分から、
# 観点つきでは P1〜P2 が計 6 件出た（CLAUDE.md「PR / マージ」）。このスクリプトは観点つきの定型を
# 1 コマンドにする。レビュー対象のブランチ（worktree）で実行すること。
#
#   scripts/codex-review.sh                       # main との差分を観点つきでレビュー
#   scripts/codex-review.sh "前回指摘と対応: ..."    # 再レビュー。対応内容・追加で見てほしい点を渡す
#   BASE=develop scripts/codex-review.sh          # 比較先を変える
#
# 結果（codex の最終回答）だけを標準出力に出す。全ログは .cache/codex-review-<時刻>.log に残す。
# テストの通過状況はこのスクリプトでは確認しない。レビュー側に伝えたいときは補足引数に書く。
set -euo pipefail
cd "$(dirname "$0")/.."

base="${BASE:-main}"
extra="${1:-}"
mkdir -p .cache
stamp="$(date +%Y%m%d-%H%M%S)-$$"  # PID 付き: 同秒の並行実行でも衝突しない
log=".cache/codex-review-$stamp.log"
answer=".cache/codex-review-$stamp.md"

prompt="NotebookLM（Gemini Notebook）のノートブックを一括削除・一括インポートする Chrome 拡張です。削除は取り消し不可。
このブランチの ${base} との差分（git diff ${base}...HEAD）をレビューしてください。
読み取りのみ・ファイル変更禁止。テストはサンドボックスで実行できないので実行不要。

観点:
(1) 誤削除の経路 —— 選択していないノートブックを消し得る経路、TOCTOU、再試行時の取り違え、確認強度（件数タイプ確認）が漏れる経路。
(2) silent failure —— 失敗が無言で成功扱いになる / 成功が失敗扱いになる / 選択したのに無言で処理されない / 表示と内部状態がずれたまま固定化する経路。
(3) テストが実 DOM や実挙動と乖離していないか（フェイクが前提を固定してしまっていないか）。
(4) コメント / CLAUDE.md / docs/requirements.md とコードの齟齬、古い記述。

指摘ごとに、重要度（P1〜P3）、今回の差分由来か ${base} から残存か、コードで確認した事実と推測の区別を付けて、日本語で簡潔に返してください。
${extra:+
補足（前回指摘と対応・追加で見てほしい点）:
${extra}}"

# < /dev/null: 非対話・バックグラウンドで動かすと、codex は標準入力を待ったまま無言で止まる
# （"Reading additional input from stdin..."。2026-10-04 に 2 本が 2 時間半停止した）。
codex exec --output-last-message "$answer" "$prompt" < /dev/null > "$log" 2>&1 \
  || { echo "codex failed. see $log" >&2; tail -20 "$log" >&2; exit 1; }

# 最終回答が空 = レビューできていない。成功扱いにしない。
if [ ! -s "$answer" ]; then
  echo "codex returned no final message. see $log" >&2
  exit 1
fi
cat "$answer"
echo
echo "(full log: $log)"
