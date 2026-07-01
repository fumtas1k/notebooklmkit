#!/usr/bin/env bash
# SessionStart hook: プロジェクトにベンダリングした superpowers の
# using-superpowers スキルを毎回コンテキストへ自動注入する。
#
# プラグイン版（obra/superpowers の hooks/session-start）の挙動を、
# .claude/skills/ に直接置いたスキルを参照する形で再現したもの。
# CLI / Claude Code web（クラウドの Linux）両方で動くよう
# $CLAUDE_PROJECT_DIR 起点でリポジトリ内のファイルを読む。

set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
SKILL_FILE="${PROJECT_DIR}/.claude/skills/using-superpowers/SKILL.md"

using_superpowers_content=$(cat "${SKILL_FILE}" 2>&1 || echo "Error reading using-superpowers skill")

# bash パラメータ展開による JSON 文字列エスケープ（jq 非依存）
escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

using_superpowers_escaped=$(escape_for_json "$using_superpowers_content")
session_context="<EXTREMELY_IMPORTANT>\nYou have superpowers.\n\n**Below is the full content of your 'superpowers:using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**\n\n${using_superpowers_escaped}\n</EXTREMELY_IMPORTANT>"

# Claude Code は hookSpecificOutput.additionalContext を読む
printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$session_context"

exit 0
