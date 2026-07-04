# post-merge-retro ルーチン設計

- 日付: 2026-07-04
- 種別: chore（開発プロセス自動化。プロダクトコードには非依存）

## 目的

PR マージ後に、直前の作業を振り返り、**CLAUDE.md / scripts / skills** に改善余地があれば提案し、
ユーザー承認を得て PR を作成するルーチンを導入する。学びを次セッションに残す運用を、
毎マージで確実に回すことが狙い。

## 方式（承認済み）

- **ハイブリッド発火**: ルーチン本体はプロジェクト skill として定義し、PostToolUse フックが
  セッション内の `gh pr merge` 成功を検知して「skill を実行せよ」と system-reminder を注入する。
- **提案→承認→PR**: 振り返りで候補を提示 → ユーザー承認 → ブランチ→コミット→PR。
  改善点が無ければ PR を作らず終了。

## 構成要素

### 1. プロジェクト skill: `.claude/skills/post-merge-retro/SKILL.md`

ルーチン本体（プロンプト）。以下の手順を持つ:

1. **再帰ガード**: 直前にマージされたブランチ/PR が post-merge-retro 由来（ブランチ名 `post-merge-retro`
   を含む、または PR タイトルが retro 由来）なら、何もせず終了（無限ループ防止）。
2. **振り返り**: 直前にマージした作業（該当 PR / ブランチの diff・このセッションの経緯）を対象に、
   次の 3 カテゴリで改善候補を洗い出す:
   - (a) **CLAUDE.md**: 推測が必要だった/不足していた文脈（例: マージ規約、環境の癖、gotcha）。
   - (b) **scripts**: あれば効率化できた再利用可能なヘルパ（例: 権限付与や定型処理）。
   - (c) **skills**: 新規作成・改善した方がよい skill。`skill-creator` プラグインがあれば活用してよい。
   各候補は「1 行/項目」の簡潔な形（`<パターン/コマンド> - <短い説明>`）でまとめる。
3. **提示と承認**: 候補をユーザーに提示し、どれを採用するか承認を得る。
   **改善点が無ければ「改善なし」と報告して終了**（空 PR を作らない）。
4. **実装と PR**: 承認された変更を適用 →
   ブランチ `chore/post-merge-retro-<topic>` を切る（既に feature ブランチ上なら新規に切り直す）→
   コミット（CLAUDE.md のコミットトレーラ規約に準拠）→ push → `gh pr create`（base main、
   CLAUDE.md「## PR / マージ」の規約に従う。対応 issue があれば `Closes #n`）。

skill の frontmatter `description` は、フックからの system-reminder で確実に起動できるよう、
「PR マージ後の振り返りルーチン」を明示する。

### 2. PostToolUse フック: `.claude/hooks/post-merge-retro-reminder.sh` ＋ `settings.json`

- `settings.json` の `hooks.PostToolUse` に、`matcher: "Bash"` で本スクリプトを配線する
  （既存の `SessionStart` フックと同じ `type: command` 形式）。
- スクリプトは stdin のフック JSON を読み、次を満たすときだけ標準出力に追加コンテキストを出す:
  - ツール名が Bash、`tool_input.command` が `gh pr merge` にマッチ、かつ実行が成功
    （`tool_response` のエラー無し）。
  - 満たすとき: `{"hookSpecificOutput": {"hookEventName": "PostToolUse",
    "additionalContext": "<post-merge-retro skill を実行せよという指示>"}}` を出力（exit 0）。
  - 満たさないとき: 何も出力せず exit 0。
- **不変条件（安全性）**: マージやセッションを絶対にブロック/失敗させない。`jq` 不在・JSON
  パース失敗・想定外入力のいずれでも、エラーを外に出さず無出力 exit 0 にフォールバックする。
- 依存: `jq`（macOS 前提。無い場合も静かに no-op で安全側）。

### 3. CLAUDE.md

「## PR / マージ」節に 1 行追記:
> マージ後は post-merge-retro ルーチンを回す（振り返り→CLAUDE.md/scripts/skills 改善提案→承認で PR）。
> セッション内 `gh pr merge` ならフックが自動リマインドする（GitHub UI マージは対象外なので手動実行）。

## スコープ外

- GitHub UI 等、セッション外でのマージ検知（フックはセッション内 Bash のみ）。
- 振り返り内容の自動適用（必ずユーザー承認を挟む）。
- プロダクトコード（`src/`）への変更・テスト。本ルーチンは開発プロセス資産のみを対象とする。

## テスト / 検証

- **フック**: シェルレベルで確認する。サンプルフック JSON を stdin に流し、
  (1) `gh pr merge ... --squash` 成功 → additionalContext を含む JSON を出力、
  (2) 非マージコマンド（例 `git status`）→ 無出力、
  (3) マージ失敗（tool_response にエラー）→ 無出力、
  (4) 不正 JSON → 無出力・非ゼロ終了しない、
  をそれぞれ確認する。
- **skill**: プロンプト文書のため、手順の網羅性・再帰ガード・空 PR 回避の記述を目視レビュー。
- プロダクトの `npm test` / `npm run typecheck` には影響しない（`src/` 非変更）が、
  ブランチ全体でグリーンを維持することは確認する。

## 導入方法

本機能自体を `chore/post-merge-retro-routine` ブランチで実装し、ブランチ→PR で main に入れる
（CLAUDE.md の PR/マージ規約どおり）。あわせて、本セッションで `/plugin` により追加された
`settings.json` の `enabledPlugins`（claude-md-management / context7 / sentry）も同じコミットに含める。
