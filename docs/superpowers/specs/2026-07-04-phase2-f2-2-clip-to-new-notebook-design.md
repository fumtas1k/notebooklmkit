# 設計書 — F2-2 現在ページから新規ノートブック作成（issue #36・改訂版）

> 対応 issue: #36
> ステータス: 承認済み（2026-07-04）
> **旧設計 `2026-07-03-phase2-f2-2-oneclick-import-design.md`（既存ノートブックへの追記）は破棄。**
> 破棄理由: 実運用では既存ノートブックへの追記需要はほぼ無い（既存ノートを開いているなら
> そこで直接 URL を貼る方が早く、拡張の価値がない）。本来の要件は「現ページ／選択タブから
> **新規ノートブックを作成**」すること。旧実装の PR #43 はマージせずクローズ済み。

## 1. 目的

任意の Web ページ閲覧中にツールバーアイコンをクリックすると、**その現在ページを種にした
新規 NotebookLM ノートブックを作成**する。将来的には「開いている複数タブを選んで新規作成」も
サポートする。既存ノートブックへの追記は F2-1 / F2-3（ノートブックページ内パネル）が担う。

## 2. スコープ

| フェーズ | 内容 | 本設計での扱い |
|---|---|---|
| **MVP** | ツールバークリック → **現在タブ1つ**から新規ノートブック作成 | **実装する** |
| 次 | 開いているタブを**複数選択**して新規作成 | スコープ外（別 issue。UI が必要。§9） |
| — | 既存ノートブックへの追記 | 廃止（F2-1/F2-3 で足りる） |

## 3. 実機調査で判明した作成フロー（2026-07-04）

- ホーム（`https://notebooklm.google.com/`）の「新規作成」ボタン = **`button.create-new-button`**
  （`aria-label="ノートブックを新規作成"`、安定クラス）。
- クリックすると**新規ノートブックが作成され、`/notebook/<uuid>?addSource=true` に遷移して
  ソース追加ダイアログが自動で開く**。
- そのダイアログは **#37 で調査済みのソース追加ダイアログと同一**
  （`button.drop-zone-icon-button` の「ウェブサイト」チップ → `textarea[formcontrolname="urls"]`
  → 「挿入」`button[type="button"]`）。URL 入力欄は**複数 URL（スペース/改行区切り）を1回で受付**。
- NotebookLM は SPA（pushState 遷移）のため、ホーム → 新規ノートブックの遷移で
  **content script インスタンスは生き続ける**（1回の処理で通しで実行できる）。

→ **新規に必要なセレクタは `create-new-button` のみ。**ソース追加部分は #37 の資産を再利用。

## 4. アーキテクチャ（データフロー）

```
[記事タブ] --ツールバークリック--> [background: action.onClicked(tab)]
  1. tab.url（現ページ）取得。http/https 以外は badge '!' で終了。
  2. storage.local に pendingCreate {urls:[tab.url], ts} を保存。badge '…'。
  3. NotebookLM ホームを **フォアグラウンド新規タブ**で開く（active:true）。
[NotebookLM ホーム: content script mount]
  4. pendingCreate を確認（自 TTL 内）。あれば storage から消して実行:
     createNotebookWithUrls(urls):
       a. create-new-button 出現待ち → クリック（新規作成 → ?addSource=true に遷移）
       b. ソース追加ダイアログ + 「ウェブサイト」チップ出現待ち → クリック
       c. URL 入力欄出現待ち → setInputValue(urls を改行連結)
       d. 挿入ボタンが有効化されるのを待つ → クリック
       e. 掴んだダイアログが DOM から外れるまで待つ = 完了
  5. content → background に nlk:create-result {ok} を送信。
  6. background が badge を '✓' / '!' に更新（数秒後クリア）。
```

新規ノートブックは**フォアグラウンドで開く**ため、作成結果がそのまま見える。副次的に、
バックグラウンドタブでの DOM 自動化（旧設計で不安定だった問題）を回避できる。

## 5. コンポーネント設計

### 5.1 `src/content/selectors.ts`（追加）

- `SOURCE_TEXT` に `createNew: /新規作成|ノートブックを新規作成|create new|new notebook/i` を追加。
- `getCreateNewButton(root=document)`: `button.create-new-button`（`data-nlk` 配下は除外）を第一候補、
  無ければ aria-label / テキストが `SOURCE_TEXT.createNew` にマッチする `button`（`data-nlk` 除外）。
  #37 と同じ「安定クラス優先＋テキスト/aria フォールバック」方針。

### 5.2 `src/content/notebook-creator.ts`（新規・DI）

`importer.ts` と同型の DI 構成。`document` に触らない。

```ts
interface CreatorDeps {
  getCreateNewButton(): HTMLElement | null
  getSourceDialog(): HTMLElement | null
  getWebsiteChip(dialog: HTMLElement): HTMLElement | null
  getUrlInput(dialog: HTMLElement): HTMLInputElement | HTMLTextAreaElement | null
  getSubmitButton(dialog: HTMLElement): HTMLElement | null
  setInputValue(el, value): void
  click(el): void
  waitFor: typeof waitFor
  timeout?: number   // 既定 15000ms（作成＋遷移＋フェッチを伴うため長め）
}
createNotebookWithUrls(urls: string[], deps: CreatorDeps, opts?: { signal?: AbortSignal }): Promise<boolean>
```

- 1回の呼び出しで「新規作成 → ウェブサイト → URL（複数可、改行連結）→ 挿入 → ダイアログ消滅待ち」。
- URL 入力欄は複数 URL を1回受付できるので、**複数タブ分も1回の挿入で N ソースの1ノートブック**になる
  （MVP は urls.length===1）。
- 失敗（要素不在 / タイムアウト）→ `false` を返す（呼び出し側が badge '!'）。成功で `true`。
- 中断規約は importer と同様（挿入クリック前は signal で即中断可、以降は完了を待つ）。MVP では
  中断 UI は設けないが signal を受け取れる形にしておく。

### 5.3 `src/background/main.ts`（変更）

- 既存 `nlk:list-tabs` リスナーは無変更。
- **追加**: `chrome.action.onClicked` ハンドラ（`handleClipClick(clickedUrl, deps)`）。
  chrome を注入した純度高めの関数にしてユニットテスト。
  - 非 http(s) → badge '!'。
  - pendingCreate 保存 → badge '…' → ホームをフォアグラウンドで開く。
  - storage/tabs 失敗は try/catch で badge '!' に帰着（旧実装のレビュー教訓）。
- **追加**: `nlk:create-result` 受信で badge を '✓'/'!' に更新。

### 5.4 `src/content/main.ts`（変更）

- `start()`（常駐ルーター）のブートストラップ時に一度、`pendingCreate` を確認して実行する
  `handlePendingCreate(env, run)` を呼ぶ。既存の `init()`（一覧）/ `initImport()`（ノートブック）
  配線は変更しない（クリップ処理は独立して走る）。
- `handlePendingCreate`: `storage.local` の pendingCreate を読み、TTL 内なら storage から消して
  `createNotebookWithUrls(urls)` を実行、結果を `nlk:create-result` で background に返す。
  chrome/location/storage 依存は注入可能にして jsdom でテスト（旧実装の `ImportEnv` と同方針）。

### 5.5 storage / 型（`src/types.ts` 追加）

| キー | area | 内容 |
|---|---|---|
| `pendingCreate` | `local` | `{ urls: string[]; ts: number }`。実行後クリア＋`ts` 古さガード（既定 60s） |

- `PendingCreate` 型、`CREATE_RESULT_MESSAGE='nlk:create-result'`、`PENDING_TTL_MS=60000` を追加。

## 6. 権限・プライバシー

- 追加は **`storage`** のみ、`action: {}`（`default_popup` なし）。`tabs` は既存流用（onClicked の
  tab.url 取得）。`host_permissions` は `notebooklm.google.com` のみ維持。外部送信ゼロ。

## 7. エラー処理・安全性

- 非 http(s) ページ → badge '!'、何もしない。
- 作成/追加フローが想定外 DOM でタイムアウト → `createNotebookWithUrls` が `false` → badge '!'。
  （NotebookLM 上に空ノートブックだけ残る可能性はあるが、ユーザーが手動削除可能。追加の
  クリーンアップ操作はしない = 想定外状態でこれ以上操作しない安全側。）
- `pendingCreate` は実行前にクリア（二重実行防止）＋ `ts` 古さガードで残留を無視。
- storage/tabs 失敗は background 側 try/catch で badge '!' に帰着（'…' 固着を防ぐ）。

## 8. テスト方針（Vitest + jsdom）

| モジュール | テスト内容 |
|---|---|
| `selectors.ts`（`getCreateNewButton`） | `button.create-new-button` にマッチ、aria/テキストフォールバック、`data-nlk` 除外、不在時 null |
| `notebook-creator.ts` | モック deps で全ステップ順次実行（create-new → website → input → submit → close）、複数 URL の改行連結、途中失敗で false、submit 無効中は待つ |
| `background`（`handleClipClick`） | 非 http → badge '!'、pendingCreate 保存＋ホームをフォアグラウンドで開く、storage/tabs 失敗で badge '!'、create-result → badge 更新 |
| `content`（`handlePendingCreate`） | pendingCreate 有 → run 実行＋クリア＋result 送信、TTL 切れは実行せず掃除、無ければ何もしない |

- 実 chrome / `chrome.action` の配線は薄いグルーとして非テスト（手動 E2E）。

## 9. スコープ外（別 issue / フォローアップ）

- **複数タブ選択 → 新規作成**: タブ選択 UI（popup 等）が必要。`listOpenTabs`（F2-1）を再利用し、
  選択 URL 群を `pendingCreate.urls` に流し込む。`createNotebookWithUrls` は複数 URL 対応済みなので
  作成ロジックは追加不要。別 issue で設計。
- 既存ノートブックへの追記（廃止。F2-1/F2-3 で対応済み）。
- 選択テキスト / ページ本文の取り込み（対象は URL のみ）。

## 10. 受け入れ基準

- [ ] 任意の http/https ページでツールバーをクリックすると、そのページを唯一のソースとする
      新規ノートブックがフォアグラウンドで作成される。
- [ ] 非 http(s) ページでは何もせず badge '!'。
- [ ] 想定外 DOM ではクラッシュせず badge '!' で安全停止。
- [ ] 成功/失敗が badge で分かる。
- [ ] 追加権限は `storage` のみ、host 据え置き、外部送信ゼロ。
- [ ] `npm run typecheck` / `npm test` が緑。
