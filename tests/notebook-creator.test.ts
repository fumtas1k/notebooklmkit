import { describe, it, expect, vi } from 'vitest'
import {
  createNotebookWithUrls, triggerAudioOverview,
  type CreatorDeps, type AudioOverviewDeps,
} from '../src/content/notebook-creator'

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

function makeAudioDeps(over: Partial<AudioOverviewDeps> = {}): AudioOverviewDeps & { clicks: HTMLElement[] } {
  const btn = document.createElement('div')
  btn.setAttribute('role', 'button')
  btn.setAttribute('aria-label', '音声解説')
  const clicks: HTMLElement[] = []
  return {
    clicks,
    getAudioOverviewButton: () => btn,
    click: (el) => { clicks.push(el) },
    isGenerating: () => false,
    waitFor: fakeWaitFor,
    ...over,
  }
}

describe('triggerAudioOverview', () => {
  it('clicks and succeeds once generation starts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 再チェック導入後、クリック前に isGenerating は 2 回（ループ先頭プリチェック＋クリック直前）呼ばれる。
    // 生成中になるのは post-click 待ちの 3 回目 → クリックは 1 回実行される。
    let calls = 0
    const d = makeAudioDeps({ isGenerating: () => { calls++; return calls >= 3 } })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toHaveLength(1)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not click when generation starts between pre-check and click (W1)', async () => {
    // ループ先頭プリチェックでは false、クリック直前の再チェックで true → クリックせず成功。
    let n = 0
    const d = makeAudioDeps({ isGenerating: () => { n++; return n >= 2 } })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toEqual([])
  })

  it('does not click when generation is already in progress', async () => {
    const d = makeAudioDeps({ isGenerating: () => true })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toEqual([])
  })

  it('retries and gives up (warns) when generation never starts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = makeAudioDeps({ isGenerating: () => false })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(false)
    expect(d.clicks.length).toBeGreaterThanOrEqual(2)  // MAX_ATTEMPTS 回リトライして諦める
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns false and warns when the tile never appears', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = makeAudioDeps({ getAudioOverviewButton: () => null })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(false)
    expect(d.clicks).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('does not click while the tile stays aria-disabled', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const disabled = document.createElement('div')
    disabled.setAttribute('role', 'button')
    disabled.setAttribute('aria-label', '音声解説')
    disabled.setAttribute('aria-disabled', 'true')
    const d = makeAudioDeps({ getAudioOverviewButton: () => disabled })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(false)
    expect(d.clicks).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
