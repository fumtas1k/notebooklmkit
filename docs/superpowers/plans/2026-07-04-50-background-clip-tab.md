# #50 バックグラウンドで新規ノートブックタブを開く Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ツールバーアイコンからの新規ノートブック作成タブを `active: false` でバックグラウンドに開き、元タブをアクティブのまま保つ。

**Architecture:** `background/main.ts` の `handleClipClick` が `chrome.tabs.create` に渡す `active` を `true` → `false` にするだけ。バッジ（'…'→'✓'/'!'）は #47 で元タブ X にスコープ済みのため、元タブがアクティブのままでそのまま見える。

**Tech Stack:** TypeScript / Manifest V3 / Vitest（jsdom）

## Global Constraints

- 権限最小化を維持（`host_permissions: notebooklm.google.com` のみ、`tabs` は既存用途のみ）。外部ネットワーク送信ゼロ。
- 静的チェックのゲートは `npm run typecheck`（strict、未使用ローカル/引数はエラー）。
- テストは `npm test`（vitest run, jsdom）。

---

### Task 1: createTab をバックグラウンド起動に変更

**Files:**
- Modify: `src/background/main.ts:78`（`handleClipClick` 内の `createTab` 呼び出し）と `:62`（コメント）
- Test: `tests/background-clip.test.ts:40`

**Interfaces:**
- Consumes: 既存 `ClipDeps.createTab(props: { url: string; active: boolean }): Promise<unknown>`
- Produces: 振る舞い変更のみ。シグネチャ変更なし。

- [ ] **Step 1: テスト期待値を active:false に更新（失敗させる）**

`tests/background-clip.test.ts` の 40 行目を次のように変更する:

```typescript
    expect(d.created).toEqual([{ url: 'https://notebooklm.google.com/', active: false }])
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/background-clip.test.ts -t "stores pendingCreate"`
Expected: FAIL（`created` が `active: true` のままなので期待値と不一致）

- [ ] **Step 3: createTab を active:false に変更**

`src/background/main.ts` の `handleClipClick` 内、現状:

```typescript
    d.setBadge('…', tabId)
    await d.createTab({ url: NOTEBOOK_HOME, active: true })
```

を次に変更する:

```typescript
    d.setBadge('…', tabId)
    await d.createTab({ url: NOTEBOOK_HOME, active: false })
```

あわせて関数直上のコメント（`:61-63` 付近）を更新する。現状:

```typescript
// ツールバーアイコンのクリック本体。現ページ URL を pendingCreate に置き、
// NotebookLM ホームをフォアグラウンドで開く（content script が新規作成を実行）。
// tabId はクリック元タブ。バッジはすべてこのタブにスコープする（元タブ X に統一）。
```

を次に変更する:

```typescript
// ツールバーアイコンのクリック本体。現ページ URL を pendingCreate に置き、
// NotebookLM ホームを active:false でバックグラウンドに開く（content script が
// 新規作成を実行）。元タブをアクティブのまま保つため（#50）。バッジは元タブ X に
// スコープするので（#47）、元タブがアクティブのまま '…'→'✓'/'!' がそのまま見える。
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `npx vitest run tests/background-clip.test.ts`
Expected: PASS（全ケース）

- [ ] **Step 5: 型チェックと全テスト**

Run: `npm run typecheck && npm test`
Expected: どちらも成功

- [ ] **Step 6: E2E チェックリストに項目を追記**

`docs/e2e-checklist-phase2.md` の F2-2 セクション（§2.5 付近）に、次の趣旨の確認項目を1行追記する:

```markdown
- [ ] #50: クリップアイコン押下後、NotebookLM タブがバックグラウンドで開き、元タブがアクティブのまま。バックグラウンドタブでも作成フローが完走し、元タブに '…'→'✓' が出る（スロットリングでタイムアウト '!' にならないか観察。落ちる場合は waitFor タイムアウトの調整を検討）。
```

（該当セクションの見出し・記法は実ファイルに合わせる。無ければ末尾に「### #50 バックグラウンド起動」小節を作って追記する。）

- [ ] **Step 7: Commit**

```bash
git add src/background/main.ts tests/background-clip.test.ts docs/e2e-checklist-phase2.md
git commit -m "#50: 新規ノートブックタブをバックグラウンドで開く（元タブをアクティブのまま）"
```

---

## Self-Review

- **Spec coverage:** PR-A の全項目（`active:false`・コメント更新・テスト更新・E2E 追記・タイムアウトは先回りで変えない）を Task 1 で網羅。
- **Placeholder scan:** なし。
- **Type consistency:** シグネチャ変更なし。`createTab` の型は既存のまま。
