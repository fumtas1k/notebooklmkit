# issue #47: '…' 固着ウォッチドッグの `chrome.alarms` 化 ＋ バッジの tabId 別スコープ

- 日付: 2026-07-04
- 対象 issue: #47（PR #46 レビュー由来。medium ＋ low）
- 種別: bug / enhancement（F2-2 の後追い改善）

## 背景

F2-2（現ページから新規ノートブック作成）の PR #46 レビューで挙がった 2 点。

1. **medium**: `src/background/main.ts` の `chrome.action.onClicked` 内で
   `setTimeout(() => resetStuckClip(deps), PENDING_TTL_MS)`（60s）を使ってバッジ
   '…' の固着を解消しているが、**MV3 の service worker はアイドルで ~30s 程度で終了され得るため、
   この 60s タイマーは発火せず失われる**ことがある。しかも「content script が走らない
   （未ログインで accounts へリダイレクト等）」という**ウォッチドッグが最も必要なケースほど
   SW も終了されやすく空振り**する。
2. **low**: `chrome.action.setBadgeText({ text })` を tabId 指定なしで呼ぶため全タブ共通。
   短時間に複数ページを連続クリップすると '…'/'✓'/'!' が相互に上書きされる。

## フロー前提（重要）

tabId 別バッジの設計は、クリップ操作が **2 つのタブにまたがる**ことを踏まえる必要がある。

1. ユーザーがタブ **X**（元ページ）でツールバーアイコンをクリック。
   `chrome.action.onClicked` のコールバックは `tab.id = X`, `tab.url` を持つ。
2. `handleClipClick` がバッジ '…' をセットし、`pendingCreate` を storage に保存、
   新規 NotebookLM ホームタブ **Y** を `active: true`（フォアグラウンド）で開く
   → **タブ Y がアクティブになる**。
3. content script は**タブ Y 上**で走り、作成後に `create-result` を送る
   → `sender.tab.id = Y`（X ではない）。

したがって '…' はタブ X に、結果メッセージはタブ Y から届く。**元タブ X に一貫して
バッジを出す**には、X の tabId を storage（`pendingCreate`）に載せ、content が結果メッセージに
エコーバックして background が X を特定できるようにする。

### 承認済み UX トレードオフ

単発クリップでは作成後にタブ Y がアクティブになるため、元タブ X のバッジは即時には
見えにくい（アクションバッジはアクティブタブのものが表示される）。この不可視性を受け入れる
代わりに、連続クリップ時の相互上書きを解消する。バッジの可視性そのものの再設計や、
タブ Y への表示は行わない（issue の「複数タブ選択 UI 統合時にまとめて」に従い将来対応）。

## 設計

### Part 1 — medium: `chrome.alarms` ウォッチドッグ

- **`manifest.config.ts`**: `permissions` に `'alarms'` を追加（`['tabs', 'storage', 'alarms']`）。
  ストア公開向けの最小権限方針との兼ね合いは、`alarms` が低感度権限であり実害
  （'…' 固着）の確実な解消に必要なため許容する（issue 承認済み）。
- **`src/background/main.ts` 配線部**（`chrome.action?.onClicked` ブロック）:
  - `onClicked` コールバック内の
    `setTimeout(() => void resetStuckClip(deps), PENDING_TTL_MS)` を
    `chrome.alarms.create('nlk-reset-stuck', { delayInMinutes: 1 })` に置換。
  - `chrome.alarms.onAlarm.addListener((alarm) => { ... })` を追加し、
    `alarm.name === 'nlk-reset-stuck'` のとき `void resetStuckClip(deps)` を呼ぶ。
  - アラーム名は定数化（例: `const STUCK_ALARM = 'nlk-reset-stuck'`）して両箇所で共有。
- `chrome.alarms` の最小遅延は 1 分。`PENDING_TTL_MS = 60000`（＝1 分）と整合しており、
  `delayInMinutes: 1` を用いる。`resetStuckClip` のシーケンス（storage 確認 → '!' →
  `pendingCreate` 削除）は tabId 追加（Part 2）を除き不変。

### Part 2 — low: 元タブ X に統一（tabId 伝搬）

- **`src/types.ts`**: `PendingCreate` に `tabId?: number` を追加。
  クリック元タブが不明な場合（`tab.id` 欠落）は `undefined` を許容。
- **`ClipDeps.setBadge`**: 型を `(text: string, tabId?: number) => void` に拡張。
  `tabId` 未指定時は従来どおりグローバルバッジにフォールバック（多層防御）。
- **`handleClipClick(clickedUrl, tabId, d)`**: 第 2 引数に `tabId?: number` を追加。
  - 非 http URL / storage 失敗 / createTab 失敗の各 '!' も `d.setBadge('!', tabId)`。
  - `pendingCreate = { urls: [clickedUrl], ts: d.now(), tabId }` に格納。
  - 成功パスは `d.setBadge('…', tabId)`。
- **`handleCreateResult(ok, tabId, d)`**: 第 2 引数に `tabId?: number` を追加し
  `d.setBadge(ok ? '✓' : '!', tabId)`。
- **`resetStuckClip`**: `pending.tabId` を読み `d.setBadge('!', pending.tabId)`。
- **`src/content/main.ts` `handlePendingCreate`**: 結果メッセージに
  `tabId: pending.tabId` をエコーバック（`{ type: CREATE_RESULT_MESSAGE, ok, tabId }`）。
  content はタブ Y 上で走り `sender.tab.id` が X と異なるため、storage 経由で伝搬した
  X の tabId を返す。
- **`src/background/main.ts` 配線部**:
  - `onClicked.addListener((tab) => { void handleClipClick(tab?.url, tab?.id, deps); chrome.alarms.create(...) })`。
  - 実 `setBadge`: `(text, tabId) => { void chrome.action.setBadgeText(tabId !== undefined ? { text, tabId } : { text }); clearLater(text, tabId) }`。
  - `clearLater(text, tabId)`: 4s 後の '✓'/'!' 消去も同じ tabId スコープで
    `setBadgeText(tabId !== undefined ? { text: '', tabId } : { text: '' })`。
  - `onMessage` の create-result 分岐: `handleCreateResult(!!m.ok, m.tabId, deps)`
    （`m` の型に `tabId?: number` を追加）。

### スコープ外（issue 記載どおり後回し）

- `setBadgeBackgroundColor`（成功=緑 / 失敗=赤）と '!' の「非対応 URL」vs「作成失敗」区別
  → 複数タブ選択 UI 統合時にまとめる。
- `clearLater` の 4s タイマーは cosmetic かつ issue 対象外のため `setTimeout` のまま
  （tabId だけ渡す。SW 終了で消えてもバッジが少し長く残るだけの自己回復挙動）。

## テスト（TDD）

- **`tests/background-clip.test.ts`**:
  - `makeDeps` の `badges: string[]` を `{ text: string; tabId?: number }[]` 記録に変更。
  - `handleClipClick` に tabId を渡し、`pendingCreate` に tabId が入ること、
    '…' が該当 tabId でセットされること、各 '!' パスも tabId 付きであること。
  - `handleCreateResult(ok, tabId, deps)` が該当 tabId でバッジすること。
  - `resetStuckClip` が `pending.tabId` を読んで '!' を該当 tabId でセットすること。
  - `tabId` 未指定（`undefined`）時にグローバルへフォールバックすること。
- **`tests/create-wiring.test.ts`**: `handlePendingCreate` が結果メッセージに
  `pending.tabId` をエコーすること（tabId 有り / 無しの両ケース）。
- alarms / onClicked / 実 `setBadge` の tabId 分岐は**グルー**であり、既存慣習
  （`background.test.ts` は onMessage の LIST_TABS のみを検証）に従い非ユニットテスト。
  `npm run typecheck`（strict）と手動 E2E で担保。
- `docs/e2e-checklist-phase2.md` に、（a）未ログイン等で content が走らないケースで
  1 分後にバッジが '!' へ落ちること、（b）複数タブ連続クリップでバッジが相互上書き
  しないこと、の確認項目を追記。

## 不変条件・非機能

- `resetStuckClip` の「`pendingCreate` が残っている場合のみ '!' に落として掃除、
  正常フローでは content が実行前クリア済みで no-op」という安全側の規約は維持。
- 外部ネットワーク送信ゼロ / 日英 i18n（バッジは記号のみで i18n 不要）を維持。
- DI ＋純粋ロジックのテスト容易性を維持（`handleClipClick` /
  `handleCreateResult` / `resetStuckClip` / `handlePendingCreate` は `document` /
  実 `chrome` に非依存のまま）。
