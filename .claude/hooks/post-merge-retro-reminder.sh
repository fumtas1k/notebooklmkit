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

# "gh pr merge" を含むコマンドのみ対象。
case "$command_str" in
    *"gh pr merge"*) ;;
    *) exit 0 ;;
esac

# 成功判定。booleanフィールドは `//` だと false 自体がフォールバックを
# 誘発してしまう（jq では false/null のみ falsy）ため、明示的な比較で真偽値化する。
interrupted="$(printf '%s' "$input" | jq -r '((.tool_response.interrupted == true) or (.toolResponse.interrupted == true))' 2>/dev/null)"
if [ "$interrupted" != "false" ]; then
    # true、または判定不能（jq エラー等で空文字）なら安全側で無出力にする。
    exit 0
fi

stderr_out="$(printf '%s' "$input" | jq -r '(.tool_response.stderr // .toolResponse.stderr // .tool_response.error // .toolResponse.error // "")' 2>/dev/null)"
if [ -n "$stderr_out" ]; then
    # stderr に何か出ていれば失敗/警告の可能性があるため、成功と断定せず無出力にする。
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
