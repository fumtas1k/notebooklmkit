# 設計: 確認ダイアログのフォーカストラップと confirm 後の targets 再検証

- Issue: [#13](https://github.com/fumtas1k/notebooklmkit/issues/13)
- 日付: 2026-07-02
- 対象: `src/content/confirm-dialog.ts`, `src/content/main.ts`, `src/content/i18n.ts`

## 背景

PR #12（Issue #2: `runDelete` 再入場ガード）のレビューで挙がったフォローアップ。再入場ガードは「削除ボタン再押下」の 1 経路のみを塞いでおり、confirm 表示中の割り込み一般はまだ開いている。

## 問題

`runDelete` は `targets` を `await confirmDeletion` の**前**にスナップショットし、confirm 後に再計算しない。一方、確認ダイアログにはフォーカストラップが無い（`aria-modal` は意味論のみ）。document キャプチャの keydown は Enter / Escape のみを横取りし、**Tab と Space は素通し**。overlay の CSS はマウス操作は塞ぐが Tab によるフォーカス移動は塞げない。

結果、確認ダイアログ表示中にキーボードで背後のチェックボックスや「すべて選択 / 解除」ボタンに到達し Space で選択を変更でき、その状態で confirm すると**画面上の選択と食い違う古いスナップショットが削除される**（削除は取り消し不可）。

## 検討した案

1. **フォーカストラップのみ** — 報告されたキーボード経路は塞がるが、confirm 中に一覧側が変化する他の要因（NotebookLM の再描画、別タブでの削除・リネーム等）でスナップショットが古くなるケースは残る。
2. **confirm 後の再検証のみ** — キー多重集合レベルの食い違いを削除直前に検出できるが（同名タイトルの置換は検出できない —— タイトル識別の既知の制約）、モーダル表示中に背後を操作できるという壊れたモーダル意味論（a11y 問題）が残る。
3. **両方**（採用） — フォーカストラップが報告経路の根本対策、再検証が取り消し不可操作に対するキー多重集合レベルの安全網。どちらも実装が小さく、防御の層が独立している。

## 設計

### 1. フォーカストラップ（`confirm-dialog.ts`）

既存の document キャプチャ `onKeydown` に Tab 処理を追加する。Tab は常に `preventDefault` + `stopPropagation` し、ダイアログ内のフォーカス可能要素の間で手動で循環させる:

```ts
if (ev.key === 'Tab') {
  // 修飾キー付き（Ctrl/Alt/Meta+Tab）はフォーカス移動ではなく
  // ブラウザ / OS 側のショートカットのため素通しする。
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return
  // フォーカストラップ: aria-modal だけでは Tab は塞げないため、
  // ダイアログ内のフォーカス可能要素の間で手動循環させる。背後の
  // チェックボックス等へ到達して選択を変更されるのを防ぐ（issue #13）。
  ev.preventDefault()
  ev.stopPropagation()
  const els = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
  if (els.length === 0) return // 全要素 disabled 化など将来変更への保険
  const idx = els.indexOf(document.activeElement as HTMLElement)
  const next = idx === -1
    ? els[0] // ダイアログ外からの引き戻しは方向に関係なく安全な先頭（input / cancel）へ
    : ev.shiftKey
      ? els[(idx === 0 ? els.length : idx) - 1]
      : els[(idx + 1) % els.length]
  next.focus()
  return
}
```

- フォーカス可能要素は都度クエリする。strong confirm で `ok` が `disabled` の間は候補から自動的に外れ、入力が妥当になれば戻る。
- `document.activeElement` がダイアログ外にある場合（`idx === -1`）は、Shift の有無に関係なく先頭（input / cancel）へ引き戻す。引き戻しは復帰動作であって循環ではなく、末尾要素は削除実行ボタンのため着地先として不適切。
- 修飾キー付き Tab（Ctrl/Alt/Meta）はブラウザ / OS のショートカットのため横取りしない。
- IME 変換中（`isComposing` / `keyCode === 229`）の Enter / Escape はダイアログ操作として扱わない（変換確定の Enter が削除確定になる事故の防止）。Tab にはこのガードを適用せず、変換中もトラップを維持する。
- Enter はフォーカス中のボタンの意図を尊重し、Cancel にフォーカスがある場合はキャンセルする（issue #18）。
- フォーカスがダイアログ外にある間の Enter は確定しない（取り消し不可操作のため安全側）。
- Space の横取りは不要 — フォーカスがダイアログ内に閉じ込められれば、Space が背後の要素に届くことはない。

### 2. confirm 後の targets 再検証（`main.ts`）

`runDelete` で confirm 通過後に `buildTargets` を再計算し、スナップショットとキー集合が一致しない場合は**削除せず中止**する（再確認ループは行わない。ユーザーが改めて削除ボタンを押せばよい）:

```ts
const ok = await confirmDeletion({ count: targets.length, isSelectAll, t })
if (!ok) return
// confirm 中に選択・一覧が変化していれば中止（削除は取り消し不可のため安全側）
const recheck = buildTargets(store, root)
if (!sameTargetKeys(targets, recheck)) {
  bar.setProgress(t('selectionChanged'))
  return
}
```

比較は `sameTargetKeys(a, b)` を `main.ts` から export する純関数として実装し、**キーの多重集合（multiset）** として比較する。同名タイトル（例: 複数の「無題のノートブック」）は同一キーになるため、単純な Set 比較では「k1 が 2 行 / k1 と k2 が 1 行ずつ」を区別できない（`docs/requirements.md` §8.5 の既知エッジケース）:

```ts
export function sameTargetKeys(a: NotebookTarget[], b: NotebookTarget[]): boolean {
  if (a.length !== b.length) return false
  const counts = new Map<string, number>()
  for (const t of a) counts.set(t.key, (counts.get(t.key) ?? 0) + 1)
  for (const t of b) {
    const n = counts.get(t.key)
    if (!n) return false
    counts.set(t.key, n - 1)
  }
  return true
}
```

順序は比較しない（削除順が変わるだけで対象集合は同じため）。

### 3. i18n（`i18n.ts`）

中止メッセージ用のキー `selectionChanged` を追加:

- en: `Cancelled: the selection changed while the confirmation dialog was open`
- ja: `確認ダイアログ表示中に選択が変更されたため中止しました`

## テスト

`tests/confirm-dialog.test.ts` に追加:

- 通常ダイアログ: Tab で cancel → ok → cancel と循環する。Shift+Tab で逆順。
- strong ダイアログ: `ok` が disabled の間は input → cancel の循環（ok を飛ばす）。妥当な件数を入力後は ok も循環に含まれる。
- フォーカスがダイアログ外（body 上のボタン等）にある状態で Tab → フォーカスがダイアログ内へ引き戻される。
- Tab がダイアログの背後（body のリスナー）へ漏れない（既存の Enter / Escape 漏れテストと同型）。

`tests/main-wiring.test.ts` に追加:

- `sameTargetKeys` の単体テスト: 同一集合（順序違い含む）/ 件数違い / 内容違い / 重複キーの多重集合ケース。
- 配線テスト: confirm ダイアログ表示中にチェックボックスの選択を変更 → confirm-ok クリック → `deleteNotebooks` が**呼ばれず**、progress に selectionChanged の文言が出る。
- 選択を変えずに confirm した場合に削除へ進むことは既存テスト（abortedSummary / error recovery）が引き続きカバーする。

## スコープ外（YAGNI）

- ダイアログの件数表示のライブ更新（再検証で古い件数のまま削除される事故は防げる）。
- 差分検出時の「再確認して続行」フロー（中止のみ。必要になれば後続 issue で）。
- `focusin` 監視などトラップの多重化（Tab 循環で十分。マウスは overlay CSS が既に塞いでいる）。
