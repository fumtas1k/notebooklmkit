import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createNotebookWithUrls, triggerAudioOverview,
  type CreatorDeps, type AudioOverviewDeps,
} from '../src/content/notebook-creator'
import { waitFor } from '../src/content/dom-utils'

// waitFor の代役: fn() を 1 回だけ評価し、truthy ならそれを返し、falsy なら「タイムアウト」で投げる。
// ポーリングも signal も再現しない（「最初から在る / 最後まで無い」の 2 枝しか作れない）。
// 「途中で状態が変わる」「中断」は下の「with the real waitFor」の describe で、実 waitFor ＋
// フェイクタイマーを使って検証する（#45）。
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

  // 「無効→有効に変わったら押す」側は下の実 waitFor の describe で検証する。
  it('returns false without clicking submit when the submit button stays disabled', async () => {
    const disabled = { disabled: true } as unknown as HTMLElement
    const d = makeDeps({ getSubmitButton: () => disabled })
    const ok = await createNotebookWithUrls(['https://a/'], d)
    // disabled のままなら submit 待ちがタイムアウト → false
    expect(ok).toBe(false)
    expect(d.clicks).not.toContain(disabled)
  })
})

// #45: 実 waitFor ＋フェイクタイマーで、ポーリング（途中で状態が変わる）と中断を再現する。
describe('createNotebookWithUrls with the real waitFor (polling / abort)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const TIMEOUT = 1000

  // 状態をテストから書き換えられるよう、挿入ボタンとダイアログは可変の素オブジェクトにする。
  function makePollingDeps(init: { submitDisabled?: boolean; submitPresent?: boolean } = {}) {
    const state = { submitPresent: init.submitPresent ?? true }
    const submit = { disabled: init.submitDisabled ?? false }
    const dialog = { isConnected: true }
    const submitEl = submit as unknown as HTMLElement
    const d = makeDeps({
      getSourceDialog: () => dialog as unknown as HTMLElement,
      getSubmitButton: () => (state.submitPresent ? submitEl : null),
      waitFor,
      timeout: TIMEOUT,
    })
    return { d, state, submit, dialog, submitEl }
  }

  it('clicks submit only after it turns from disabled to enabled', async () => {
    const { d, submit, dialog, submitEl } = makePollingDeps({ submitDisabled: true })
    const p = createNotebookWithUrls(['https://a/'], d)
    await vi.advanceTimersByTimeAsync(300)
    // ④ まで進んで（URL は入力済み）、無効の間は押さずに待っている
    expect(d.inputs).toHaveLength(1)
    expect(d.clicks).not.toContain(submitEl)

    submit.disabled = false
    await vi.advanceTimersByTimeAsync(100)
    expect(d.clicks[d.clicks.length - 1]).toBe(submitEl)

    dialog.isConnected = false
    await vi.advanceTimersByTimeAsync(100)
    await expect(p).resolves.toBe(true)
  })

  it('clicks submit once it appears late', async () => {
    const { d, state, dialog, submitEl } = makePollingDeps({ submitPresent: false })
    const p = createNotebookWithUrls(['https://a/'], d)
    await vi.advanceTimersByTimeAsync(300)
    expect(d.clicks).not.toContain(submitEl)

    state.submitPresent = true
    dialog.isConnected = false
    await vi.advanceTimersByTimeAsync(100)
    expect(d.clicks[d.clicks.length - 1]).toBe(submitEl)
    await expect(p).resolves.toBe(true)
  })

  it('times out (false) without clicking submit when it never becomes enabled', async () => {
    const { d, submitEl } = makePollingDeps({ submitDisabled: true })
    const p = createNotebookWithUrls(['https://a/'], d)
    await vi.advanceTimersByTimeAsync(TIMEOUT - 100)
    let settled = false
    void p.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)               // タイムアウトまでは待ち続ける
    await vi.advanceTimersByTimeAsync(200)
    await expect(p).resolves.toBe(false)
    expect(d.clicks).not.toContain(submitEl)
  })

  it('waits for the dialog to disconnect after submit, and fails if it never does', async () => {
    const { d, submitEl } = makePollingDeps()
    const p = createNotebookWithUrls(['https://a/'], d)
    await vi.advanceTimersByTimeAsync(TIMEOUT - 100)
    expect(d.clicks[d.clicks.length - 1]).toBe(submitEl)
    let settled = false
    void p.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)               // ダイアログが残っている間は完了にしない
    await vi.advanceTimersByTimeAsync(200)
    await expect(p).resolves.toBe(false)
  })

  it('returns false without clicking anything when the signal is already aborted', async () => {
    const { d } = makePollingDeps()
    const ac = new AbortController()
    ac.abort()
    await expect(createNotebookWithUrls(['https://a/'], d, { signal: ac.signal })).resolves.toBe(false)
    expect(d.clicks).toEqual([])
    expect(d.inputs).toEqual([])
  })

  it('stops immediately on abort while waiting for submit, and never clicks it afterwards', async () => {
    const { d, submit, submitEl } = makePollingDeps({ submitDisabled: true })
    const ac = new AbortController()
    const p = createNotebookWithUrls(['https://a/'], d, { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(300)
    ac.abort()
    // タイムアウトを待たず、中断の時点で false に確定する
    await vi.advanceTimersByTimeAsync(0)
    await expect(p).resolves.toBe(false)

    // 中断後に有効化されても押さない
    submit.disabled = false
    await vi.advanceTimersByTimeAsync(TIMEOUT)
    expect(d.clicks).not.toContain(submitEl)
  })

  // ⑤ の不変条件: 挿入クリック後（コミット後）の完了待ちは中断しない。中断で false を返すと、
  // 実際には作られたノートブックを失敗と誤記録する。
  it('ignores an abort after the submit click and still reports success', async () => {
    const { d, dialog, submitEl } = makePollingDeps()
    const ac = new AbortController()
    const p = createNotebookWithUrls(['https://a/'], d, { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(300)
    expect(d.clicks[d.clicks.length - 1]).toBe(submitEl)

    ac.abort()
    let settled = false
    void p.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(200)
    expect(settled).toBe(false)               // 中断では確定しない

    dialog.isConnected = false
    await vi.advanceTimersByTimeAsync(100)
    await expect(p).resolves.toBe(true)
  })

  it('passes the signal to every wait before the submit click, and not to the completion wait', async () => {
    const { d, dialog } = makePollingDeps()
    dialog.isConnected = false
    const ac = new AbortController()
    const seen: (AbortSignal | undefined)[] = []
    d.waitFor = ((fn: () => unknown, opts: { signal?: AbortSignal } = {}) => {
      seen.push(opts.signal)
      return waitFor(fn, opts)
    }) as CreatorDeps['waitFor']
    await expect(createNotebookWithUrls(['https://a/'], d, { signal: ac.signal })).resolves.toBe(true)
    // ①新規作成 ②ダイアログ+チップ ③URL 欄 ④挿入ボタン は signal つき、⑤完了待ちだけ無し
    expect(seen).toEqual([ac.signal, ac.signal, ac.signal, ac.signal, undefined])
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
    // 既定ではカスタマイズダイアログは出ない（旧 UI 相当）。#84 のテストで差し替える。
    getAudioGenerateButton: () => null,
    click: (el) => { clicks.push(el) },
    isGenerating: () => false,
    waitFor: fakeWaitFor,
    delay: async () => {},
    ...over,
  }
}

// #84: タイルクリックが「音声解説をカスタマイズ」ダイアログを開くようになった（§8.12）。
// ダイアログが出たら「生成」を押す。出ない経路（旧 UI / 将来の変更）でも壊れないこと。
describe('triggerAudioOverview with the customize dialog', () => {
  it('clicks 生成 in the dialog and reports success', async () => {
    const gen = document.createElement('button')
    gen.textContent = '生成'
    let calls = 0
    const d = makeAudioDeps({
      getAudioGenerateButton: () => gen,
      // タイル→ダイアログ→生成クリックの後で生成中になる
      isGenerating: () => { calls++; return calls >= 4 },
    })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toContain(gen)          // 生成ボタンを押している
    expect(d.clicks[0]).not.toBe(gen)        // 先にタイルを押している
  })

  it('settles before clicking 生成 (the dialog is not clickable the instant it appears)', async () => {
    const gen = document.createElement('button')
    gen.textContent = '生成'
    const order: string[] = []
    let calls = 0
    const d = makeAudioDeps({
      getAudioGenerateButton: () => gen,
      isGenerating: () => { calls++; return calls >= 4 },
    })
    d.delay = async (ms) => { order.push(`delay:${ms}`) }
    const realClick = d.click
    d.click = (el) => { order.push(el === gen ? 'click:generate' : 'click:tile'); realClick(el) }
    await triggerAudioOverview(d)
    const delayIdx = order.findIndex((o) => o.startsWith('delay:'))
    expect(delayIdx).toBeGreaterThanOrEqual(0)
    expect(delayIdx).toBeLessThan(order.indexOf('click:generate'))
  })

  it('still works when no dialog appears (old UI / future change)', async () => {
    let calls = 0
    const d = makeAudioDeps({
      getAudioGenerateButton: () => null,
      isGenerating: () => { calls++; return calls >= 3 },
    })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toHaveLength(1)         // タイルのみ
  })

  // codex P2: settle 待機だけが signal を見ないと、中断後に生成を開始してしまう。
  it('passes the abort signal to the settle wait', async () => {
    const gen = document.createElement('button')
    gen.textContent = '生成'
    const ac = new AbortController()
    const seen: (AbortSignal | undefined)[] = []
    let calls = 0
    const d = makeAudioDeps({
      getAudioGenerateButton: () => gen,
      isGenerating: () => { calls++; return calls >= 4 },
    })
    d.delay = async (_ms, sig) => { seen.push(sig) }
    await triggerAudioOverview(d, { signal: ac.signal })
    expect(seen[0]).toBe(ac.signal)
  })

  it('does not click 生成 when the signal aborts during the settle wait', async () => {
    const gen = document.createElement('button')
    gen.textContent = '生成'
    const ac = new AbortController()
    const d = makeAudioDeps({ getAudioGenerateButton: () => gen, isGenerating: () => false })
    d.delay = async () => { ac.abort() }   // settle 中に中断が入る
    const ok = await triggerAudioOverview(d, { signal: ac.signal })
    expect(d.clicks).not.toContain(gen)    // 中断後に生成を開始しない
    expect(ok).toBe(false)
  })

  it('does not click 生成 when generation already started', async () => {
    const gen = document.createElement('button')
    gen.textContent = '生成'
    const d = makeAudioDeps({ getAudioGenerateButton: () => gen, isGenerating: () => true })
    const ok = await triggerAudioOverview(d)
    expect(ok).toBe(true)
    expect(d.clicks).toEqual([])             // 二重生成しない
  })
})

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

// #45: 実 waitFor ＋フェイクタイマーで、タイル待ちのポーリングと中断を再現する。
describe('triggerAudioOverview with the real waitFor (polling / abort)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function makeDisabledTile(): HTMLElement {
    const tile = document.createElement('div')
    tile.setAttribute('role', 'button')
    tile.setAttribute('aria-label', '音声解説')
    tile.setAttribute('aria-disabled', 'true')
    return tile
  }

  it('clicks the tile only after it turns from aria-disabled to enabled', async () => {
    const tile = makeDisabledTile()
    const d = makeAudioDeps({ getAudioOverviewButton: () => tile, waitFor, timeout: 1000 })
    d.isGenerating = () => d.clicks.length > 0   // クリックが効いて生成が始まる
    const p = triggerAudioOverview(d)
    await vi.advanceTimersByTimeAsync(2000)
    expect(d.clicks).toEqual([])                 // 無効の間は押さない

    tile.removeAttribute('aria-disabled')
    await vi.advanceTimersByTimeAsync(100)
    expect(d.clicks).toEqual([tile])

    // カスタマイズダイアログは出ない（DIALOG_WAIT_MS で素通り）→ 生成開始を検知して成功
    await vi.advanceTimersByTimeAsync(6000)
    await expect(p).resolves.toBe(true)
    expect(d.clicks).toEqual([tile])
  })

  it('stops immediately on abort while waiting for the tile, and never clicks it afterwards', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tile = makeDisabledTile()
    const ac = new AbortController()
    const d = makeAudioDeps({ getAudioOverviewButton: () => tile, waitFor, timeout: 1000 })
    const p = triggerAudioOverview(d, { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(2000)
    ac.abort()
    await vi.advanceTimersByTimeAsync(0)
    await expect(p).resolves.toBe(false)

    tile.removeAttribute('aria-disabled')
    await vi.advanceTimersByTimeAsync(20000)
    expect(d.clicks).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('does not start generating when aborted while waiting for the customize dialog', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const tile = document.createElement('div')
    const gen = document.createElement('button')
    let dialogOpen = false
    const ac = new AbortController()
    const d = makeAudioDeps({
      getAudioOverviewButton: () => tile,
      getAudioGenerateButton: () => (dialogOpen ? gen : null),
      waitFor,
      timeout: 1000,
    })
    const p = triggerAudioOverview(d, { signal: ac.signal })
    await vi.advanceTimersByTimeAsync(1000)
    expect(d.clicks).toEqual([tile])             // タイルは押してダイアログ待ち

    ac.abort()
    dialogOpen = true                            // 中断後にダイアログが出ても「生成」は押さない
    await vi.advanceTimersByTimeAsync(60000)
    await expect(p).resolves.toBe(false)
    expect(d.clicks).toEqual([tile])
    warn.mockRestore()
  })
})
