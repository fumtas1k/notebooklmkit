import { describe, it, expect, beforeEach } from 'vitest'
import {
  getAddSourceButton, getSourceDialog, getWebsiteChip,
  getSourceUrlInput, getSourceSubmitButton,
} from '../src/content/selectors'

describe('source-flow selectors (provisional)', () => {
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

  it('getSourceUrlInput prefers url/text inputs and falls back to textarea', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `<input type="checkbox"><input type="url">`
    expect((getSourceUrlInput(dialog) as HTMLInputElement).type).toBe('url')
    dialog.innerHTML = `<textarea></textarea>`
    expect(getSourceUrlInput(dialog)?.tagName).toBe('TEXTAREA')
    dialog.innerHTML = `<input type="checkbox">`
    expect(getSourceUrlInput(dialog)).toBeNull()
  })

  it('getSourceSubmitButton matches 挿入/Insert text, then submit type', () => {
    const dialog = document.createElement('div')
    dialog.innerHTML = `<button>キャンセル</button><button>挿入</button>`
    expect(getSourceSubmitButton(dialog)?.textContent).toBe('挿入')
    dialog.innerHTML = `<button type="submit">Go</button>`
    expect(getSourceSubmitButton(dialog)?.textContent).toBe('Go')
    dialog.innerHTML = `<button>キャンセル</button>`
    expect(getSourceSubmitButton(dialog)).toBeNull()
  })
})
