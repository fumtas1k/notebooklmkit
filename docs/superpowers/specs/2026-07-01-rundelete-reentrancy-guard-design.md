# 設計: runDelete の再入場ガード

- Issue: [#2](https://github.com/fumtas1k/notebooklmkit/issues/2)
- 日付: 2026-07-01
- 対象: `src/content/main.ts` の `runDelete`

## 背景

PR #1（Phase 1: 一括削除）のレビュー修正時に判明したフォローアップ。`runDelete` に再入場ガードが無いため、確認ダイアログ表示中に削除ボタンを二度押しすると `runDelete` が並走し得る。

## 問題

`runDelete` は先頭で `confirmDeletion` を `await` するが、その間 `bar.setBusy(true)` はまだ呼ばれておらず、削除ボタンが有効なまま。そのため確認ダイアログ表示中に削除ボタンを再度押すと、2つ目の確認ダイアログ → 2つの `runDelete` が並走し得る。

Phase 1 のレビュー修正で入れた「削除中は再走査 MutationObserver を一時停止（`finally` で再開）」により、2つ目の実行の `finally` が1つ目の実行中に observer を再開してしまう等、並走の影響がわずかに顕在化し得る（データ破壊ではないが挙動が乱れる）。

## 設計判断

issue の対応案には「`currentAbort` 非 null 判定」も挙げられていたが、コードでは `currentAbort = ac` が `confirmDeletion` の await より**後**で代入される。よって脆弱な区間（確認ダイアログ表示中）ではまだ `currentAbort === null` であり、この判定ではガードにならない。

**結論**: 専用の `deleting` フラグを、`confirmDeletion` の await より**前**（`runDelete` の先頭）で立てる。

## 実装

`init()` クロージャ内に `let deleting = false` を追加し、`runDelete` を二重の try/finally 構造にする。

```ts
async function runDelete(): Promise<void> {
  if (deleting) return          // 再入場ガード（confirm await 前に立てる）
  deleting = true
  try {
    const targets = buildTargets(store, root)
    if (targets.length === 0) return       // 早期 return でも…
    const totalRows = getNotebookRows(root).length
    const isSelectAll = targets.length === totalRows
    const ok = await confirmDeletion({ count: targets.length, isSelectAll, t })
    if (!ok) return                        // …外側 finally が deleting を戻す
    // …既存の削除処理（内側 try/finally で busy/observer を管理）…
  } finally {
    deleting = false
  }
}
```

- **外側** try/finally: `deleting` フラグ管理のみ。早期 return（対象0件・確認キャンセル）でも確実にリセットする。
- **内側** try/finally: 既存の `setBusy` / observer 再接続 / `injectRowCheckboxes` はそのまま維持する。

## テスト

`tests/main-wiring.test.ts` に追加:

- 削除ボタン押下 → 確認ダイアログ表示中に**再度**削除ボタンを押下 → 確認ダイアログ (`[data-nlk="confirm-dialog"]`) が**1つだけ**であること（2つ目の `runDelete` が無視された）を検証する。

## スコープ外（YAGNI）

- 削除ボタン自体を確認前から `disabled` にする等の UI 変更は行わない。フラグによるガードで並走は防げるため。
