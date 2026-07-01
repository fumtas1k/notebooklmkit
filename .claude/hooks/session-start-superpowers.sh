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

# スキル本文を読む。欠損/読み取り失敗は stderr に出し（注入本文には混ぜない）、
# 明確なセンチネル文言に置き換える。セッション自体は正常起動させる（exit 0）。
if ! using_superpowers_content=$(cat "${SKILL_FILE}" 2>/dev/null); then
    echo "session-start-superpowers: could not read ${SKILL_FILE}" >&2
    using_superpowers_content="[superpowers auto-injection disabled: ${SKILL_FILE} not found]"
fi

session_context="<EXTREMELY_IMPORTANT>
You have superpowers.

**Below is the full content of your 'superpowers:using-superpowers' skill - your introduction to using skills. For all other skills, use the 'Skill' tool:**

${using_superpowers_content}
</EXTREMELY_IMPORTANT>"

# JSON 生成。python3 があれば全制御文字（U+0000–U+001F 等）を正しくエスケープできる
# ため優先。無い環境では bash パラメータ展開でフォールバック（jq 非依存を維持）。
# フォールバックは \ " 改行 復帰 タブ のみ処理する前提 —— 対象の SKILL.md は
# これら以外の制御文字を含まない平文である想定。
if command -v python3 >/dev/null 2>&1; then
    CONTEXT="$session_context" python3 -c '
import json, os
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": os.environ["CONTEXT"],
    }
}))'
else
    escape_for_json() {
        local s="$1"
        s="${s//\\/\\\\}"
        s="${s//\"/\\\"}"
        s="${s//$'\n'/\\n}"
        s="${s//$'\r'/\\r}"
        s="${s//$'\t'/\\t}"
        printf '%s' "$s"
    }
    escaped=$(escape_for_json "$session_context")
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$escaped"
fi

exit 0
