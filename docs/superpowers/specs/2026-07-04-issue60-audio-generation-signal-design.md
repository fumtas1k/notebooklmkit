# issue #60: 音声解説の生成開始検知を「テキスト＋要素」の OR にして二重生成を根絶する

- Issue: #60（`enhancement` / `priority: medium`）
- 対象: `src/content/notebook-creator.ts`（`triggerAudioOverview`）、`src/content/main.ts`（`isGenerating` 配線）、`src/content/selectors.ts`（新セレクタ）
- 前提調査: PR #59 レビュー指摘1、`docs/requirements.md` §8.7

## 背景 / 問題

`triggerAudioOverview` の二重生成防止は「クリック後 `clickInterval`（現状 30s）以内に
`isGenerating()` が true になる」ことに依存している。`isGenerating()` は `main.ts` で
`document.body.innerText` に対する**テキスト一致**（`/生成しています|生成中|generating/i`）
だけで判定している。

失敗経路（PLAUSIBLE・実機未確認）:

1. あるクリックが実際に音声生成を開始させる。
2. しかし Studio の「音声解説を生成しています…」**表示テキストの描画が `clickInterval` を超えて遅延**する。
3. クリック後の `waitFor(isGenerating, { timeout: clickInterval })` がタイムアウト → catch → ループ先頭へ。
4. ループ先頭の `isGenerating()` プリチェックがまだ false で、タイルが enabled のまま残っていると
   **再クリックされ、生成が二重に走る**（クォータの無駄）。

PR #59 は暫定緩和で `clickInterval` を 30s に拡大したが、遅延が 30s を超える経路では依然残る。

さらに小さな窓（W1）として、ループ先頭のプリチェックと実際の `deps.click(btn)` の間には
`waitFor(enabledTile)`（最大 `TILE_WAIT_MS`=15s）が挟まる。この待機中に生成開始シグナルが
立った場合も、プリチェックは通過済みのため二重クリックし得る。

## 方針（採用: 要素シグナル＋ラッチ強化）

「クリックが効いたこと」を**表示テキストより早く・確実に**判定できる即時シグナルを併用する。
実機 DOM 調査（生成カードの安定セレクタと出現タイミングの実測）はクォータを消費する音声生成を
実際に走らせる必要があるため、コードは **「現状より厳密に悪化しない（strictly better）」** 形で入れ、
新セレクタの妥当性は後追いで e2e-checklist に沿って実機確認する（#59 と同じ運用）。

### 1. 生成開始シグナルの強化（コア）

`isGenerating()` を **「テキスト一致 OR 生成カード要素の出現」** に拡張する。

- `selectors.ts` に `getAudioGenerationCard(root: ParentNode = document): HTMLElement | null` を新設。
  Studio の「音声解説を生成しています…」を表す生成中カード（スピナー付きコンテナ）の**要素**を返す。
  安定クラス候補で候補集合を絞り、見つからなければ「生成しています / 生成中 / generating」の
  テキスト一致でフォールバック。自拡張 UI（`[data-nlk]`）は除外。実機で確定していないため
  best-effort であることをコメントで明記し、実機確認待ちの旨を記す（§8.7 と同じ扱い）。
- `main.ts` の `isGenerating` を
  `() => textMatch(document.body.innerText) || getAudioGenerationCard(root) != null` に変更。
- **strictly more sensitive**: 新セレクタが 1 つも一致しなくても、既存のテキスト判定は残るので
  現状と同等以上。最良ケースではバナー描画より早く検知し、再クリック窓を縮める。最悪ケース
  （新セレクタが常に空振り）でも現状の挙動に一致するため、この変更単体でリグレッションは起きない。

### 2. W1 窓（プリチェック〜クリック間）を封じる

`triggerAudioOverview` の各反復で、`deps.click(btn)` の**直前にもう一度 `deps.isGenerating()` を確認**し、
true なら即 `return true`（クリックしない）。これによりループ先頭のプリチェックと実クリックの間に
生成が始まった場合の二重クリックを防ぐ。

### 3. リトライ構造・`clickInterval` は維持

早すぎクリックの空振り対策の再試行（`MAX_ATTEMPTS`=5・各 `clickInterval`=30s）はそのまま。
検知が早まる分、30s 窓内で生成開始を捕捉できる確率が上がる。`clickInterval`=30s は
「待つほど再クリックしにくい＝安全側」なので据え置き（実機計測後に見直す余地は §8.7 に残す）。

## コンポーネント / データフロー

```
defaultCreateRunner (main.ts)
  └─ triggerAudioOverview(deps)
       deps.isGenerating = () => textMatch(body.innerText) || getAudioGenerationCard(root) != null
       ループ i in 0..MAX_ATTEMPTS:
         ① if isGenerating() → return true           （プリチェック: 既に生成中なら押さない）
         ② btn = await waitFor(enabledTile, 15s)
         ③ if isGenerating() → return true           （★新: クリック直前の再チェック = W1封じ）
         ④ deps.click(btn)                            （主ワールドクリック）
         ⑤ await waitFor(isGenerating, 30s)
              成功 → return true / タイムアウト → 次の反復（再試行）
       諦め → console.warn → return false
```

`triggerAudioOverview` の DI 署名（`AudioOverviewDeps`）は不変。`isGenerating` の**中身**を
`main.ts` 側で強化し、`getAudioGenerationCard` を注入経路（`main.ts`）で合成するだけなので、
`notebook-creator.ts` の変更は W1 再チェックの 1 箇所に限定される。

## エラーハンドリング

- best-effort 規約は維持: 要素不在 / 生成開始せず / 中断はいずれも例外を投げず `false` を返し
  `console.warn` する（badge '!'）。
- `getAudioGenerationCard` は throw しない（`querySelectorAll` + フィルタのみ）。空なら null。

## テスト（jsdom / DI）

- `tests/notebook-creator.test.ts`
  - **W1 再チェックの回帰**: `waitFor(enabledTile)` 解決後・`deps.click` 直前に `isGenerating()` が
    true になったらクリックしない（`clicks` が空のまま `true` を返す）を追加。
  - 既存テスト（成功 / 既生成中で押さない / 再試行して諦める / タイル不在 / aria-disabled）は維持。
    `isGenerating` 呼び出し回数が増える（プリチェック＋クリック直前）ため、呼び出し回数に依存する
    アサーションがあれば調整する。
- `tests/selectors-source.test.ts`
  - `getAudioGenerationCard`: 生成中カード（スピナー付きコンテナ / テキスト「生成しています」）を
    含むフラグメントで要素を返す。該当なしのフラグメントで null を返す（＝ OR でテキスト判定に
    フォールバックする前提）。`[data-nlk]` 配下は除外。

## ドキュメント更新

- `docs/requirements.md` §8.7: 生成開始検知を「テキスト一致 OR 生成カード要素」に更新した旨と、
  生成カードセレクタが **実機確認待ち**である旨、`clickInterval` の実測見直し余地を追記。
- `docs/e2e-checklist-phase2.md` §2.5: 新シグナルの実機確認手順（クリック→生成カード要素の出現と
  「生成しています」テキストの描画、どちらが先か・遅延はどれくらいかを確認）を追記。

## スコープ外 / 非目標

- ready ゲート（ソース解析完了検知で 1 回だけクリック）方式は今回採らない（別シグナルの実機調査が
  前提になり、誤判定時に音声が生成されない副作用があるため）。将来 §8.7 の実測結果次第で再検討。
- `clickInterval` / `MAX_ATTEMPTS` の値そのものの最適化は実機計測後の別対応。

## 受け入れ基準

- [ ] `npm run typecheck && npm test` が通る。
- [ ] `getAudioGenerationCard` が生成中カードを拾い、非該当で null（OR フォールバック成立）。
- [ ] W1 再チェックにより、クリック直前に生成中になった場合はクリックしない。
- [ ] 新セレクタが空振りしても既存テキスト判定で現状同等に動く（strictly better の担保）。
- [ ] docs（§8.7 / e2e §2.5）に新シグナルと実機確認待ちを記載。
