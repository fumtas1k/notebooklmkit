import { describe, it, expect } from 'vitest'
import { createNotebookWithUrls, type CreatorDeps } from '../src/content/notebook-creator'

// waitFor の代役: fn() が truthy ならそれを返し、falsy なら「タイムアウト」で投げる。
const fakeWaitFor = (async (fn: () => unknown) => {
  const v = fn()
  if (v) return v
  throw new Error('timeout')
}) as unknown as CreatorDeps['waitFor']

function makeDeps(over: Partial<CreatorDeps> = {}): CreatorDeps & {
  clicks: HTMLElement[]; inputs: [unknown, string][]
} {
  const createBtn = { name: 'create' } as unknown as HTMLElement
  // 完了判定 ⑤ は dialog.isConnected===false を待つので、テストでは最初から false にして即完了させる。
  const dialog = { isConnected: false } as unknown as HTMLElement
  const chip = { name: 'chip' } as unknown as HTMLElement
  const input = {} as HTMLInputElement
  const submit = { disabled: false } as unknown as HTMLElement
  const clicks: HTMLElement[] = []
  const inputs: [unknown, string][] = []
  return {
    clicks, inputs,
    getCreateNewButton: () => createBtn,
    getSourceDialog: () => dialog,
    getWebsiteChip: () => chip,
    getUrlInput: () => input,
    getSubmitButton: () => submit,
    setInputValue: (el, v) => { inputs.push([el, v]) },
    click: (el) => { clicks.push(el) },
    waitFor: fakeWaitFor,
    ...over,
  }
}

describe('createNotebookWithUrls', () => {
  it('clicks create-new → website → submit in order and inserts the joined urls', async () => {
    const d = makeDeps()
    const ok = await createNotebookWithUrls(['https://a/', 'https://b/'], d)
    expect(ok).toBe(true)
    // クリック順: 新規作成ボタン, ウェブサイトチップ, 挿入ボタン
    expect(d.clicks.map((c) => (c as unknown as { name?: string }).name)).toEqual(['create', 'chip', undefined])
    // URL は改行連結で1回入力
    expect(d.inputs).toEqual([[expect.anything(), 'https://a/\nhttps://b/']])
  })

  it('returns false without inserting when urls is empty', async () => {
    const d = makeDeps()
    const ok = await createNotebookWithUrls([], d)
    expect(ok).toBe(false)
    expect(d.clicks).toEqual([])
  })

  it('returns false when the create-new button never appears', async () => {
    const d = makeDeps({ getCreateNewButton: () => null })
    const ok = await createNotebookWithUrls(['https://a/'], d)
    expect(ok).toBe(false)
  })

  it('waits for the submit button to become enabled', async () => {
    const disabled = { disabled: true } as unknown as HTMLElement
    const d = makeDeps({ getSubmitButton: () => disabled })
    const ok = await createNotebookWithUrls(['https://a/'], d)
    // disabled のままなら submit 待ちがタイムアウト → false
    expect(ok).toBe(false)
  })
})
