#!/usr/bin/env bash
# PostToolUse フック: セッション内で `gh pr merge` が成功した直後に、
# post-merge-retro skill（振り返り→CLAUDE.md/scripts/skills 改善提案→承認で PR）
# を実行するよう system-reminder を注入する。
#
# 設計: docs/superpowers/specs/2026-07-04-post-merge-retro-routine-design.md
#
# 不変条件（安全性）: このフックはマージやセッションを絶対にブロック/失敗させない。
# jq 不在・JSON パース失敗・想定外の入力構造・成功判定に迷うケースは、
# すべて「何も出力せず exit 0」にフォールバックする（誤リマインドより取りこぼしを許容）。
# そのため set -euo pipefail は使わない。

# 実機確認済みの stdin JSON 構造（例）:
# {"tool_name":"Bash","tool_input":{"command":"..."},
#  "tool_response":{"stdout":"...","stderr":"...","interrupted":false, ...}}
# ただし将来 / 他環境での構造揺れに備え、camelCase 系のフィールド名も
# フォールバックとして拾う。

input="$(cat 2>/dev/null)"

if [ -z "$input" ]; then
    exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
    exit 0
fi

# JSON として妥当かをまず確認する。不正なら黙って終了。
if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
    exit 0
fi

tool_name="$(printf '%s' "$input" | jq -r '(.tool_name // .toolName // "") ' 2>/dev/null)"
if [ "$tool_name" != "Bash" ]; then
    exit 0
fi

command_str="$(printf '%s' "$input" | jq -r '(.tool_input.command // .toolInput.command // "")' 2>/dev/null)"
if [ -z "$command_str" ]; then
    exit 0
fi

# コマンド文字列を代表的な区切り（; && || | 改行）で分割し、各セグメントの
# 先頭が `gh pr merge`（sudo 経由も許容）であるものだけを対象にする。
# 単純な部分文字列一致だと、コミットメッセージのヒアドキュメント本文などに
# 説明文として "gh pr merge" という語句が混ざっただけで誤反応してしまうため
# （実際に、このフックの実装コミット自体のメッセージ文中の記述で誤検知した）。
normalized="$(printf '%s' "$command_str" | sed -E 's/&&|\|\||;|\|/\n/g')"

matched=0
while IFS= read -r seg; do
    trimmed="$(printf '%s' "$seg" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    if printf '%s' "$trimmed" | grep -Eiq '^(sudo[[:space:]]+)?gh[[:space:]]+pr[[:space:]]+merge([[:space:]]|$)'; then
        matched=1
        break
    fi
done <<EOF
$normalized
EOF

if [ "$matched" -ne 1 ]; then
    exit 0
fi

# 成功判定。
#
# 前提（このリポジトリの実測）: PostToolUse は Bash が非ゼロ終了した場合そもそも
# 発火しない。よってフックに到達した時点で概ね成功と見なせる。以下のシグナルは
# defense-in-depth の任意チェックで、明示的に「失敗」と分かる場合のみ無出力にし、
# 判定不能・シグナル不在なら成功とみなして出力する。
#
# 重要: stderr の内容は成功/失敗の判定に使わない。`gh` CLI は成功時も人間向けの
# メッセージ（例 `✓ Squashed and merged pull request #49 ...`）を stderr に書くため、
# 「stderr が非空なら失敗」とみなすと正常な成功マージのたびにリマインドを抑制して
# しまう（この機能が事実上まったく発火しなくなる）。

# (1) ユーザー中断でないこと。boolean は `//` だと false 自体がフォールバックを
# 誘発する（jq では false/null のみ falsy）ため、明示的な比較で真偽値化する。
interrupted="$(printf '%s' "$input" | jq -r '((.tool_response.interrupted == true) or (.toolResponse.interrupted == true))' 2>/dev/null)"
if [ "$interrupted" != "false" ]; then
    # true、または判定不能（jq エラー等で空文字）なら安全側で無出力にする。
    exit 0
fi

# (2) 明示的な成功/失敗シグナルが「存在する場合のみ」見る。環境により名称が
# 異なり得るため複数候補を防御的に確認する。フィールドが存在しなければ
# （null なら）成功とみなす —— 存在しないフィールドを「失敗」に倒さない。
#
# 注意: 複数候補の集約に `//` は使えない。jq では `false // X` が X に化ける
# （false は falsy 扱い）ため、`success:false` のような明示失敗を取りこぼす。
# 各候補を配列にまとめ any(...) で「いずれかが失敗値か」を判定する。
failed="$(printf '%s' "$input" | jq -r '
    ([.tool_response.exit_code, .toolResponse.exitCode, .tool_response.exitCode, .toolResponse.exit_code]
        | any(. != null and . != 0))
    or ([.tool_response.success, .toolResponse.success]
        | any(. == false))
    or ([.tool_response.is_error, .toolResponse.isError, .tool_response.isError, .toolResponse.is_error]
        | any(. == true))
' 2>/dev/null)"
if [ "$failed" != "false" ]; then
    # 明確に失敗、または判定不能（jq エラー等で空文字）なら無出力にする。
    exit 0
fi

message='PR がマージされました。post-merge-retro ルーチン（振り返り→CLAUDE.md/scripts/skills 改善提案→承認で PR）を実行してください。'

jq -n --arg msg "$message" '{
    hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: $msg
    }
}' 2>/dev/null

exit 0
