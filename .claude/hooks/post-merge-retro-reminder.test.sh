#!/usr/bin/env bash
# post-merge-retro-reminder.sh の簡易シェルテスト。
#
# 各ケースでサンプルの PostToolUse フック JSON を stdin に流し、
# フックの stdout に `additionalContext` が含まれるか/含まれないかを
# grep で判定する。失敗があれば非ゼロ終了し、全て通れば `ALL PASS` を出す。
#
# 実行: ./.claude/hooks/post-merge-retro-reminder.test.sh
# 前提: macOS 標準の /usr/bin/sed・bash で通ること（GNU 拡張に依存しない）。

set -u

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
hook="$script_dir/post-merge-retro-reminder.sh"

fail_count=0

# 引数: name, input_json, expect ("present" | "absent")
run_case() {
    local name="$1"
    local input="$2"
    local expect="$3"

    local output
    output="$(printf '%s' "$input" | "$hook" 2>/dev/null)"
    local exit_code=$?

    if [ "$exit_code" -ne 0 ]; then
        echo "FAIL: $name — hook exited non-zero ($exit_code)"
        fail_count=$((fail_count + 1))
        return
    fi

    if printf '%s' "$output" | grep -q 'additionalContext'; then
        local has="present"
    else
        local has="absent"
    fi

    if [ "$has" = "$expect" ]; then
        echo "PASS: $name"
    else
        echo "FAIL: $name — expected additionalContext to be $expect, got $has"
        fail_count=$((fail_count + 1))
    fi
}

# --- 1. 単体 gh pr merge（成功） ---
input1='{
  "tool_name": "Bash",
  "tool_input": {"command": "gh pr merge 52 --squash --delete-branch"},
  "tool_response": {
    "stdout": "",
    "stderr": "✓ Squashed and merged pull request #52 (some title)",
    "interrupted": false
  }
}'
run_case "単体 gh pr merge（成功）" "$input1" "present"

# --- 2. 複合 git fetch && gh pr merge（成功）: 修正1（sed の \n 移植性）の回帰防止 ---
input2='{
  "tool_name": "Bash",
  "tool_input": {"command": "git fetch && gh pr merge 52"},
  "tool_response": {
    "stdout": "",
    "stderr": "✓ Merged pull request #52",
    "interrupted": false
  }
}'
run_case "複合 git fetch && gh pr merge（成功）" "$input2" "present"

# --- 3. git status（非マージ） ---
input3='{
  "tool_name": "Bash",
  "tool_input": {"command": "git status"},
  "tool_response": {"stdout": "", "stderr": "", "interrupted": false}
}'
run_case "git status（非マージ）" "$input3" "absent"

# --- 4. interrupted:true ---
input4='{
  "tool_name": "Bash",
  "tool_input": {"command": "gh pr merge 52"},
  "tool_response": {"stdout": "", "stderr": "", "interrupted": true}
}'
run_case "interrupted:true" "$input4" "absent"

# --- 5. 明示失敗（exit_code / success / is_error） ---
input5a='{
  "tool_name": "Bash",
  "tool_input": {"command": "gh pr merge 52"},
  "tool_response": {"stdout": "", "stderr": "", "interrupted": false, "exit_code": 1}
}'
run_case "明示失敗 exit_code:1" "$input5a" "absent"

input5b='{
  "tool_name": "Bash",
  "tool_input": {"command": "gh pr merge 52"},
  "tool_response": {"stdout": "", "stderr": "", "interrupted": false, "success": false}
}'
run_case "明示失敗 success:false" "$input5b" "absent"

input5c='{
  "tool_name": "Bash",
  "tool_input": {"command": "gh pr merge 52"},
  "tool_response": {"stdout": "", "stderr": "", "interrupted": false, "is_error": true}
}'
run_case "明示失敗 is_error:true" "$input5c" "absent"

# --- 6. 不正 JSON ---
input6='{not valid json at all'
run_case "不正 JSON" "$input6" "absent"

# --- 7. コミットメッセージ本文に語句が混ざるだけ（誤検知しない） ---
input7='{
  "tool_name": "Bash",
  "tool_input": {"command": "git commit -m \"post-merge hook that detects gh pr merge command\""},
  "tool_response": {"stdout": "", "stderr": "", "interrupted": false}
}'
run_case "コミットメッセージ内の語句混入（誤検知しない）" "$input7" "absent"

echo "---"
if [ "$fail_count" -eq 0 ]; then
    echo "ALL PASS"
    exit 0
else
    echo "$fail_count case(s) FAILED"
    exit 1
fi
