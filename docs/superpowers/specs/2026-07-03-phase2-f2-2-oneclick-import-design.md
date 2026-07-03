# 設計書 — F2-2 現在ページのワンクリックインポート（issue #36）

> 対応 issue: #36「F2-2: 現在ページのワンクリックインポート（ツールバーアイコン）の設計・実装」
> 対応要件: `docs/requirements.md` §4 Phase 2 F2-2
> 前提設計: `docs/superpowers/specs/2026-07-02-phase2-import-design.md` §2 / §11
> ステータス: 承認済み（2026-07-03）

## 1. 目的

任意の Web ページを閲覧中に拡張のツールバーアイコンをクリックすると、その**現在ページの
URL を NotebookLM のノートブックにワンクリックでソース追加**する。F2-1 / F2-3
（ノートブックページ内のパネルからの一括インポート）とは異なり、NotebookLM 以外の
ページから起動する点が新しい。ソース追加そのものは既存 `importUrls`（DOM 自動化）を再利用する。

## 2. スコープ判断（確定した設計方針）

| 論点 | 決定 | 理由 |
|---|---|---|
| 対象ノートブックの決定 | **最後に開いたノートブック**（`storage` に記録） | 「ノートブックを開いて関連ページを次々クリップ」という自然な流れに合致。真のワンクリック。既存 `importUrls` をそのまま再利用でき新規 UI が最小 |
| 起動方式 | **`chrome.action.onClicked`**（popup なし） | ワンクリック要件。`default_popup` を置かないことで onClicked が発火する |
| 実行時のタブ/フォーカス | **記事タブに留まりバックグラウンド実行**（不安定ならフォアグラウンドにフォールバック） | 「クリップして読み続ける」クリッパー本来の体験。バックグラウンド DOM 自動化の信頼性は実機で確認する |
| フィードバック | **バッジテキストのみ**（busy / 成功 / 失敗） | 新規権限ゼロ。`notifications` 権限は使わない（将来の任意拡張として §9 に記録） |

## 3. アーキテクチャ（データフロー）

ツールバークリックを background の `chrome.action.onClicked` で受け、対象ノートブックのタブ上の
content script に「この URL を1件インポート」を実行させる。DOM 操作は既存 `importUrls` を再利用。

```
[記事タブ] --ツールバークリック--> [background: action.onClicked(tab)]
  1. tab.url（現在ページ）を取得（tabs 権限、既存）。http/https 以外は無視してバッジ "!"。
  2. storage.local の lastNotebook {id,title} を読む。
     - 無ければ → NotebookLM ホーム（https://notebooklm.google.com/）を新規タブで開き、
       バッジ "!" ＋ タイトル属性で「先にノートブックを開いてください」を示す。処理終了。
  3. storage.local に pendingImport {notebookId, url, ts} を保存。バッジ "…"（busy）。
  4. /notebook/<id> の既存タブを検索:
     - 見つかれば → そのタブに nlk:run-pending メッセージを送る（再マウントしないため）。
     - 無ければ → バックグラウンドで /notebook/<id> の新規タブを開く（active:false）。
  5. content script（initImport）が pendingImport を実行（importUrls([url])）→
     結果を background に nlk:import-result で返信。
  6. background がバッジを ✓（成功）/ !（失敗・中断）に更新し、数秒後にクリア。
```

### 経路の使い分け（既存タブ mount 済み vs 新規タブ mount）

- **既存タブ経路**: 既にマウント済みの content script は再実行の契機が無いため、
  background から `nlk:run-pending` を送って `pendingImport` の実行を促す。
- **新規タブ経路**: content script は mount 時に `pendingImport` を確認し、自分の
  notebook id 宛なら実行する。ready ハンドシェイクを避け、storage 経由で疎結合にする。

## 4. コンポーネント設計

### 4.1 `src/content/notebook-id.ts`（新規・純関数）

```ts
// /notebook/<id> の pathname から notebook id を取り出す。該当しなければ null。
export function parseNotebookId(pathname: string): string | null
```

- `/notebook/abc-123` → `'abc-123'`。`/`、`/notebook`、`/notebook/`、その他 → `null`。
- `main.ts` の `isNotebookPath`（真偽のみ）とは役割が異なるため**別関数として並存**させる。
  routing 用の `isNotebookPath` は安定しているので変更せず、id 抽出は `parseNotebookId` に分離する
  （必要なら `isNotebookPath` を `parseNotebookId(p) !== null` で表現できるが、本 issue では
  既存 routing に手を入れない）。

### 4.2 `src/content/main.ts` の `initImport`（変更）

- **mount 時**: `parseNotebookId(location.pathname)` で id を取得し、`document.title`
  由来のノートブック名とともに `chrome.storage.local.set({ lastNotebook: { id, title } })`。
- **mount 時**: `chrome.storage.local.get('pendingImport')` を確認し、
  `pendingImport.notebookId === 自分の id` **かつ古くない**（`Date.now() - ts <= PENDING_TTL_MS`、
  既定 60000ms）なら実行して storage から消す。他ノートブック宛・期限切れは実行しない
  （期限切れは掃除のため消してよい）。
- **メッセージ受信**: `nlk:run-pending` を受けたら同じく `pendingImport` を確認して実行。
- 実行本体は既存の `runImport(urls)` を1件（`[pendingImport.url]`）で呼ぶ形に薄く再利用。
  実行後、結果を `chrome.runtime.sendMessage({ type: 'nlk:import-result', ok, ... })` で
  background に返す。
- `chrome` 依存は既存の `tabs-bridge.ts` と同様に**引数注入可能**にして jsdom でテストする。

### 4.3 `src/background/main.ts`（変更）

- 既存の `nlk:list-tabs` リスナーは無変更で残す。
- **追加**: `chrome.action.onClicked.addListener((tab) => …)` で §3 のオーケストレーションを行う。
  - タブ検索・作成・メッセージ送信・バッジ更新のロジックを、`chrome` を引数に取る
    純度の高い関数（例 `handleActionClick(deps)`）に切り出してユニットテストする。
- **追加**: `nlk:import-result` 受信でバッジを ✓ / ! に更新するリスナー。

### 4.4 storage スキーマ

| キー | area | 生存 | 内容 |
|---|---|---|---|
| `lastNotebook` | `local` | 永続 | `{ id: string; title: string }`。最後に開いたノートブック |
| `pendingImport` | `local` | 明示クリア＋古さガード | `{ notebookId: string; url: string; ts: number }`。実行後に必ずクリア |

- **`pendingImport` を `session` ではなく `local` にする理由**: `chrome.storage.session` は
  既定でアクセスレベルが `TRUSTED_CONTEXTS`（background 等）のみで、**content script
  （非信頼コンテキスト）から読めない**。`setAccessLevel` で緩められるが、揮発の利点は
  `ts` による古さガード（既定 60s）＋実行後の明示クリアで代替できるため、落とし穴の少ない
  `local` を採用する。SW が途中で落ちて残留しても、次回は期限切れとして無視・掃除される。
- 型は `src/types.ts` に `LastNotebook` / `PendingImport` と、メッセージ種別
  `RUN_PENDING_MESSAGE = 'nlk:run-pending'` / `IMPORT_RESULT_MESSAGE = 'nlk:import-result'`、
  および `PENDING_TTL_MS` を追加。

## 5. ファイル構成（追加・変更分）

```
src/
├─ background/main.ts        # 変更: action.onClicked オーケストレーション＋結果→バッジ
├─ content/
│  ├─ main.ts                # 変更: initImport に lastNotebook 保存 / pendingImport 実行 / run-pending 受信
│  └─ notebook-id.ts         # ★新規: parseNotebookId（純関数）
├─ types.ts                  # 変更: LastNotebook / PendingImport / メッセージ種別追加
manifest.config.ts           # 変更: permissions に 'storage' 追加、action: {} 追加
docs/e2e-checklist-phase2.md # 変更: F2-2 節を追加
tests/                       # notebook-id / background(action) / main(initImport 拡張) のテスト追加
```

## 6. 権限・プライバシー

- 追加権限は **`storage`** のみ。`chrome.action`（manifest に `action: {}`、`default_popup` は置かない）。
- `tabs` は既存流用（現在タブ URL 取得・ノートブックタブ検索/作成）。
- `host_permissions` は `https://notebooklm.google.com/*` のみ維持。
- 外部ネットワーク送信ゼロ維持。`lastNotebook` / `pendingImport` は端末内 storage のみ。
- ストア審査向け justification（`storage`）: 「最後に開いたノートブックと処理中の1件を
  端末内に一時記録し、ワンクリックインポートの対象特定に使う。外部送信なし」。

## 7. エラー処理・安全性

- 現在ページが http/https でない（`chrome://` 等）→ 何もせずバッジ "!"。
- `lastNotebook` 未設定 → NotebookLM ホームを開いてバッジ "!"（対象が無いことを示す）。
- 対象タブでの実行は既存 `importUrls` の規約に帰着（想定外 DOM → 安全停止、失敗記録）。失敗はバッジ "!"。
- `pendingImport` は**実行後に必ずクリア**（二重実行防止）。加えて `ts` の古さガード（既定 60s）で、
  SW が途中で落ちて残留したエントリは次回に無視・掃除する。
- バックグラウンドタブでの DOM 自動化が不安定な場合は、対象タブを一時的にフォアグラウンド化して
  実行するフォールバックを用意（実機確認の結果で採否を決定。E2E チェックリストに検証項目を置く）。
- 重複防止は無し（NotebookLM 側にも無い）。同一ページ2回クリック = 2ソース追加。E2E に明記。

## 8. テスト方針（Vitest + jsdom）

| モジュール | テスト内容 |
|---|---|
| `notebook-id.ts` | `/notebook/<id>` → id、非該当 → null、末尾スラッシュ・クエリ付き等の境界 |
| `background`（action ロジック） | モック chrome で: 非 http URL → no-op+バッジ、lastNotebook 無 → ホーム開く、既存タブ有 → run-pending 送信、既存タブ無 → 新規タブ作成、pendingImport 設定、import-result → バッジ更新 |
| `content/main.ts`（initImport 拡張） | mount 時 lastNotebook 保存、pendingImport 自分宛実行＋クリア、run-pending 受信で実行、他ノートブック宛は実行しない、`ts` 期限切れは実行しない |

- background の `chrome.action.setBadgeText` / `chrome.tabs.*` はロジックを `chrome` 注入の
  薄い関数に切り出してユニットテスト。結線は手動 E2E（`docs/e2e-checklist-phase2.md` F2-2 節）で確認。

## 9. 受け入れ基準

- [ ] 任意の http/https ページでツールバーアイコンをクリックすると、最後に開いた
      ノートブックにその URL がソース追加される。
- [ ] 記事タブにフォーカスが留まる（バックグラウンド実行。不安定時はフォアグラウンド fallback）。
- [ ] `lastNotebook` 未設定時は NotebookLM ホームを開き、バッジで対象不在を示す。
- [ ] http/https 以外のページでは何もせずバッジで示す。
- [ ] 成功/失敗がバッジテキストで分かる。
- [ ] 追加権限は `storage` のみ。`host_permissions` は据え置き。外部送信ゼロ維持。
- [ ] `npm run typecheck` / `npm test` が緑。

## 10. スコープ外（本 issue で対応しない）

- popup UI・ノートブック選択 UI（対象は「最後に開いたノートブック」に固定）。
- `notifications` 権限による OS 通知（将来の任意拡張）。
- 選択テキストやページ本文の取り込み（対象は現在ページ URL のみ）。
- 複数 URL の一括投入切替（#40 で別途検討）。
- ソース追加フローのセレクタ再調査（#37 で実機調査済み。`selectors.ts` を再利用）。
