import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton, getCreateNewButton,
  getAudioOverviewButton,
} from '../src/content/selectors'

describe('source-flow selectors', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('getAddSourceButton finds a button by aria-label', () => {
    document.body.innerHTML = `
      <button>ノートを追加</button>
      <button aria-label="ソースを追加"><span>追加</span></button>`
    expect(getAddSourceButton()?.getAttribute('aria-label')).toBe('ソースを追加')
  })

  it('getAddSourceButton falls back to exact "+ Add"-style text', () => {
    document.body.innerHTML = `<button>Add note</button><button> + Add </button>`
    expect(getAddSourceButton()?.textContent).toContain('+ Add')
  })

  it('getAddSourceButton ignores buttons injected by this extension', () => {
    document.body.innerHTML = `
      <div data-nlk="import-host"><button aria-label="ソースを追加">追加</button></div>`
    expect(getAddSourceButton()).toBeNull()
  })

  it('getAddSourceButton does not match unrelated 追加 buttons', () => {
    document.body.innerHTML = `<button>メモを追加</button>`
    expect(getAddSourceButton()).toBeNull()
  })

  it('getAddSourceButton prefers the stable add-source-button class', () => {
    document.body.innerHTML = `
      <button aria-label="ソースを追加">別ボタン</button>
      <button class="add-source-button" aria-label="ソースを追加"><span>add ソースを追加</span></button>`
    expect(getAddSourceButton()?.classList.contains('add-source-button')).toBe(true)
  })

  it('getSourceDialog returns the mat dialog container', () => {
    document.body.innerHTML = `<mat-dialog-container>x</mat-dialog-container>`
    expect(getSourceDialog()).not.toBeNull()
  })

  it('getWebsiteChip matches a chip by ja/en text', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `
      <mat-chip><span>YouTube</span></mat-chip>
      <mat-chip><span>ウェブサイト</span></mat-chip>`
    expect(getWebsiteChip(dialog)?.textContent).toContain('ウェブサイト')
    dialog.innerHTML = `<button role="option">Website</button>`
    expect(getWebsiteChip(dialog)?.textContent).toContain('Website')
  })

  it('getWebsiteChip matches the real-DOM website drop-zone button', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `
      <button class="drop-zone-icon-button"><span>ファイルをアップロード</span></button>
      <button class="drop-zone-icon-button"><span>ウェブサイト</span></button>`
    expect(getWebsiteChip(dialog)?.classList.contains('drop-zone-icon-button')).toBe(true)
    expect(getWebsiteChip(dialog)?.textContent).toContain('ウェブサイト')
  })

  it('getWebsiteChip ignores bare buttons even if they contain website text', () => {
    const dialog = document.createElement('div')
    // 種別チップでない裸 button（例: ヘルプリンク）は候補外。旧候補（裸 button）では
    // 誤マッチしていたケースの回帰テスト。
    dialog.innerHTML = `<button class="help-link">Learn more about website sources</button>`
    expect(getWebsiteChip(dialog)).toBeNull()
  })

  it('getWebsiteChip returns null when only a non-drop-zone button has website text (ja)', () => {
    const dialog = document.createElement('div')
    // drop-zone-icon-button ではない裸 button が「ウェブサイト」テキストを含む実 DOM 想定
    // フィクスチャ。旧候補（裸 button 込み）なら誤マッチしていたケースの回帰テスト。
    dialog.innerHTML = `<button class="help-link">ウェブサイトのソースについて詳しく</button>`
    expect(getWebsiteChip(dialog)).toBeNull()
  })

  it('getWebsiteChip prefers the drop-zone-icon-button chip over a non-drop-zone button with matching text', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `
      <button class="help-link">ウェブサイトのソースについて詳しく</button>
      <button class="drop-zone-icon-button"><span>ウェブサイト</span></button>`
    const el = getWebsiteChip(dialog)
    expect(el?.classList.contains('drop-zone-icon-button')).toBe(true)
  })

  it('getSourceUrlInput matches textarea[formcontrolname="urls"], else input[type=url]', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `<input type="checkbox"><input type="url">`
    expect((getSourceUrlInput(dialog) as HTMLInputElement).type).toBe('url')
    dialog.innerHTML = `<input type="checkbox">`
    expect(getSourceUrlInput(dialog)).toBeNull()
  })

  it('getSourceUrlInput prefers textarea[formcontrolname="urls"]', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `<input type="url"><textarea formcontrolname="urls"></textarea>`
    const el = getSourceUrlInput(dialog)
    expect(el?.tagName).toBe('TEXTAREA')
    expect(el?.getAttribute('formcontrolname')).toBe('urls')
  })

  it('getSourceUrlInput does NOT grab the discoverSourcesQuery search box', () => {
    // ダイアログ上部の「ウェブで新しいソースを検索」検索欄（discoverSourcesQuery）は
    // 常在する。URL 貼り付け欄が未描画の間に検索欄を誤取得しないこと（実機バグの回帰）。
    const dialog = document.createElement('div')
    dialog.innerHTML = `<textarea formcontrolname="discoverSourcesQuery"></textarea>`
    expect(getSourceUrlInput(dialog)).toBeNull()
    // 貼り付け欄が現れたら、検索欄ではなくそちらを返す
    dialog.innerHTML = `
      <textarea formcontrolname="discoverSourcesQuery"></textarea>
      <textarea formcontrolname="urls"></textarea>`
    expect(getSourceUrlInput(dialog)?.getAttribute('formcontrolname')).toBe('urls')
  })

  it('getSourceSubmitButton matches 挿入/Insert text only (no submit-type fallback)', () => {
    const dialog = document.createElement('div')
    // 実 DOM の挿入ボタンは type="button"。テキストで一致させる。
    dialog.innerHTML = `<button type="button">キャンセル</button><button type="button">挿入</button>`
    expect(getSourceSubmitButton(dialog)?.textContent).toBe('挿入')
    // type="submit" フォールバックは撤去したので、挿入テキストの無い submit ボタンは拾わない。
    dialog.innerHTML = `<button type="submit">Go</button>`
    expect(getSourceSubmitButton(dialog)).toBeNull()
    dialog.innerHTML = `<button>キャンセル</button>`
    expect(getSourceSubmitButton(dialog)).toBeNull()
  })

  it('getCreateNewButton finds the stable create-new-button class', () => {
    document.body.innerHTML = `
      <button>別ボタン</button>
      <button class="create-new-button" aria-label="ノートブックを新規作成"><span>add 新規作成</span></button>`
    expect(getCreateNewButton()?.classList.contains('create-new-button')).toBe(true)
  })

  it('getCreateNewButton falls back to aria-label / text', () => {
    document.body.innerHTML = `<button aria-label="ノートブックを新規作成">作成</button>`
    expect(getCreateNewButton()?.getAttribute('aria-label')).toBe('ノートブックを新規作成')
  })

  it('getCreateNewButton ignores buttons injected by this extension', () => {
    document.body.innerHTML = `<div data-nlk="x"><button class="create-new-button">新規作成</button></div>`
    expect(getCreateNewButton()).toBeNull()
  })

  it('getAudioOverviewButton matches ja「音声解説」text', () => {
    document.body.innerHTML = `
      <button>メモを追加</button>
      <button><span>音声解説を生成</span></button>`
    expect(getAudioOverviewButton()?.textContent).toContain('音声解説')
  })

  it('getAudioOverviewButton matches ja「音声概要」text', () => {
    document.body.innerHTML = `<button><span>音声概要</span></button>`
    expect(getAudioOverviewButton()?.textContent).toContain('音声概要')
  })

  it('getAudioOverviewButton matches en「Audio Overview」text and aria-label', () => {
    document.body.innerHTML = `<button>Generate Audio Overview</button>`
    expect(getAudioOverviewButton()?.textContent).toContain('Audio Overview')
    document.body.innerHTML = `<button aria-label="Audio Overview"><span>▶</span></button>`
    expect(getAudioOverviewButton()?.getAttribute('aria-label')).toBe('Audio Overview')
  })

  it('getAudioOverviewButton ignores buttons injected by this extension', () => {
    document.body.innerHTML = `<div data-nlk="x"><button>音声解説</button></div>`
    expect(getAudioOverviewButton()).toBeNull()
  })

  it('getAudioOverviewButton does not match unrelated buttons', () => {
    document.body.innerHTML = `<button>ノートを追加</button>`
    expect(getAudioOverviewButton()).toBeNull()
  })

  it('getAudioOverviewButton returns a disabled matching button (enabled-check is the caller responsibility)', () => {
    document.body.innerHTML = `<button disabled><span>音声解説を生成</span></button>`
    // セレクタは disabled でも返す。有効化待ちは triggerAudioOverview 側で行う（getSourceSubmitButton と同じ分離）。
    expect(getAudioOverviewButton()).not.toBeNull()
  })

  it('getAudioOverviewButton targets the create-artifact tile (div[role=button]) not the customize chevron', () => {
    // 実 DOM: 生成タイルは div[role=button].create-artifact-button-container、右上に
    // button.edit-button[aria-label="音声解説をカスタマイズ"]。後者を押すとカスタマイズだけ開く。
    document.body.innerHTML = `
      <div role="button" class="create-artifact-button-container" aria-label="音声解説">
        <span class="create-label-container">音声解説</span>
        <button class="edit-button" aria-label="音声解説をカスタマイズ">chevron_forward</button>
      </div>`
    const el = getAudioOverviewButton()
    expect(el?.classList.contains('create-artifact-button-container')).toBe(true)
    expect(el?.getAttribute('aria-label')).toBe('音声解説')
  })

  it('getAudioOverviewButton excludes a standalone 音声解説をカスタマイズ chevron', () => {
    document.body.innerHTML = `<button class="edit-button" aria-label="音声解説をカスタマイズ">chevron_forward</button>`
    expect(getAudioOverviewButton()).toBeNull()
  })

  it('getAudioOverviewButton prefers the create-artifact tile over an unrelated button match', () => {
    document.body.innerHTML = `
      <button aria-label="音声解説をカスタマイズ">chevron_forward</button>
      <div role="button" class="create-artifact-button-container" aria-label="音声解説"><span>音声解説</span></div>`
    expect(getAudioOverviewButton()?.classList.contains('create-artifact-button-container')).toBe(true)
  })
})
