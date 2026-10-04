#!/usr/bin/env bash
# 変異検証: 実装をわざと壊し、テストが検出するかを一覧で返す（CLAUDE.md「PR / マージ」）。
#
# リポジトリ外の一時ディレクトリにコピーして壊すので、作業ツリーには触れない。
# 変異は「ラベル ::: ファイル ::: perl の置換式」を 1 行 1 件で標準入力から渡す。
# 残りの引数は vitest にそのまま渡す（対象テストファイルの絞り込み等）。
#
#   scripts/mutation-check.sh tests/main-routing.test.ts <<'EOF'
#   失敗分岐を外す ::: src/content/main.ts ::: s/else if \(result\.failed\.length > 0\)/else if (false)/
#   EOF
#
# 置換式は `perl -0pi -e` で適用する（ファイル全体が 1 つの文字列。複数行にまたがる一致が書ける）。
# 各変異について、当たった箇所の差分（行番号つき）と結果を出す:
#   検出     = テストが失敗した（テストがその壊れ方を捕まえている）
#   未検出   = テストが通った（テストの穴か、結果が変わらない等価な変異）
#   未適用   = 置換式がどこにも一致しなかった
# **差分の行番号を必ず見る。** `s///` は最初の一致だけを書き換えるので、同じ行を持つ別の関数
# （例: runDelete と runImport の `if (result.aborted) {`）に当たると、狙った箇所は壊れておらず
# 「未検出」と誤って出る。未検出が 1 件でもあれば終了コード 1。
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules ]; then
  echo "node_modules がありません。先に npm ci を実行してください。" >&2
  exit 2
fi

repo="$PWD"
work="$(mktemp -d "${TMPDIR:-/tmp}/nlk-mutation.XXXXXX")"
trap 'rm -rf "$work"' EXIT

# 追跡中＋未追跡（ignore 対象を除く）をコピーする。未コミットの変更もそのまま検証対象になる。
git ls-files -co --exclude-standard -z | tar cf - --null -T - 2>/dev/null | tar xf - -C "$work"
ln -s "$repo/node_modules" "$work/node_modules"

# --no-install: npx がインストール確認のまま固まるのを防ぐ。
run_tests() { (cd "$work" && npx --no-install vitest run "$@" >"$work/.mutation-out" 2>&1); }
summary() { grep -E '^[[:space:]]*Tests ' "$work/.mutation-out" | tr -s ' ' | sed 's/^ //' || true; }

if ! run_tests "$@"; then
  echo "変異なしの時点でテストが失敗しています。先にテストを通してください。" >&2
  tail -n 30 "$work/.mutation-out" >&2
  exit 2
fi
echo "[変異なし] $(summary)"

undetected=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  label="${line%% ::: *}"
  rest="${line#* ::: }"
  file="${rest%% ::: *}"
  expr="${rest#* ::: }"
  if [ "$rest" = "$line" ] || [ "$expr" = "$rest" ]; then
    echo "[書式エラー] $line" >&2
    exit 2
  fi
  if [ ! -f "$work/$file" ]; then
    echo "[$label] 未適用（$file が無い）"
    undetected=$((undetected + 1))
    continue
  fi

  cp "$work/$file" "$work/.mutation-orig"
  perl -0pi -e "$expr" "$work/$file"
  if cmp -s "$work/$file" "$work/.mutation-orig"; then
    echo "[$label] 未適用（置換式がどこにも一致しない）"
    undetected=$((undetected + 1))
  else
    # 当たった箇所（行番号つき）。狙った関数かどうかはここで確認する。
    diff -U0 "$work/.mutation-orig" "$work/$file" | grep -E '^(@@|[-+][^-+])' | cut -c1-160 | sed "s|^|    |" || true
    if run_tests "$@"; then
      echo "[$label] 未検出 — $(summary)"
      undetected=$((undetected + 1))
    else
      echo "[$label] 検出 — $(summary)"
    fi
  fi
  cp "$work/.mutation-orig" "$work/$file"
done

[ "$undetected" -eq 0 ]
