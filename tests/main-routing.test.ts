import { describe, it, expect, beforeEach, vi } from 'vitest'
import { start, initImport, isNotebookPath } from '../src/content/main'
import { importUrls } from '../src/content/importer'

vi.mock('../src/content/importer', () => ({
  importUrls: vi.fn(),
}))

const LIST = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">A</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table></div>`

const flush = () => new Promise((r) => setTimeout(r, 0))

describe('isNotebookPath', () => {
  it('detects notebook pages by pathname', () => {
    expect(isNotebookPath('/notebook/abc123')).toBe(true)
    expect(isNotebookPath('/')).toBe(false)
    expect(isNotebookPath('/settings')).toBe(false)
  })
})

describe('start routing', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('mounts the list UI on the projects page', () => {
    document.body.innerHTML = LIST
    const dispose = start(document, () => '/')
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
    expect(document.querySelector('[data-nlk="import-fab"]')).toBeNull()
    dispose()
  })

  it('mounts the import UI on a notebook page', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const dispose = start(document, () => '/notebook/abc123')
    expect(document.querySelector('[data-nlk="import-fab"]')).not.toBeNull()
    expect(document.querySelector('[data-nlk="action-bar"]')).toBeNull()
    dispose()
  })

  it('switches UIs when the SPA navigates list → notebook', async () => {
    document.body.innerHTML = LIST
    let path = '/'
    const dispose = start(document, () => path)
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
    path = '/notebook/abc'
    document.body.innerHTML = '<div id="app"></div>' // SPA 再描画で mutation 発火
    await flush()
    expect(document.querySelector('[data-nlk="action-bar"]')).toBeNull()
    expect(document.querySelector('[data-nlk="import-fab"]')).not.toBeNull()
    dispose()
  })

  it('dispose unmounts whichever UI is active', () => {
    document.body.innerHTML = '<div id="app"></div>'
    const dispose = start(document, () => '/notebook/abc')
    dispose()
    expect(document.querySelector('[data-nlk="import-fab"]')).toBeNull()
  })

  it('does not tear down the list UI when the container detaches transiently without navigation', async () => {
    document.body.innerHTML = LIST
    const dispose = start(document, () => '/')
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()

    document.querySelector('.all-projects-container')!.remove()
    await flush()

    // pathname 不変のため teardown されない（issue #38 のガード）
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()

    dispose()
  })
})

describe('initImport wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.mocked(importUrls).mockReset()
  })

  function typeAndRun(text: string) {
    const ta = document.querySelector<HTMLTextAreaElement>('[data-nlk="import-urls"]')!
    ta.value = text
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('[data-nlk="import-run"]')!.click()
  }

  it('runs importUrls with parsed urls and shows a summary', async () => {
    vi.mocked(importUrls).mockResolvedValue({
      succeeded: ['https://a.example/'],
      failed: [],
      aborted: false,
    })
    const dispose = initImport()
    typeAndRun('https://a.example/\nbad-url')
    await Promise.resolve()
    expect(importUrls).toHaveBeenCalledTimes(1)
    expect(vi.mocked(importUrls).mock.calls[0][0]).toEqual(['https://a.example/'])
    await new Promise((r) => setTimeout(r, 0))
    const progress = document.querySelector('[data-nlk="import-progress"]')!
    expect(progress.textContent).toContain('1')
    // 成功した URL は textarea から除去される
    const ta = document.querySelector<HTMLTextAreaElement>('[data-nlk="import-urls"]')!
    expect(ta.value).not.toContain('https://a.example/')
    dispose()
  })

  it('ignores a second run while one is in flight', async () => {
    let resolve!: (v: unknown) => void
    vi.mocked(importUrls).mockReturnValue(new Promise((r) => { resolve = r }) as never)
    const dispose = initImport()
    typeAndRun('https://a.example/')
    typeAndRun('https://a.example/')
    expect(importUrls).toHaveBeenCalledTimes(1)
    resolve({ succeeded: [], failed: [], aborted: false })
    await new Promise((r) => setTimeout(r, 0))
    dispose()
  })
})

// issue #103: runImport は結果に応じて importAborted / importFailedSummary / importDone を
// 出し分ける。importUrls は最初の失敗で停止する（安全側）が、そのとき aborted は false
// （aborted は利用者の「中断」専用）なので、分岐を取り違えると「完了」と表示されて
// 残りが未処理であることが伝わらない。削除側の runDelete summary（issue #99、
// main-wiring.test.ts）と同じく配線ごと固定する。文言自体は i18n.test.ts で固定済み。
describe('runImport summary (issue #103)', () => {
  const URLS = ['https://a.example/', 'https://b.example/', 'https://c.example/']

  beforeEach(() => {
    document.body.innerHTML = ''
    vi.mocked(importUrls).mockReset()
  })

  // 3 件の URL を入力 → インポート実行し、完了後の進捗表示と textarea の残りを返す。
  async function importThree(): Promise<{ text: string; remaining: string[] }> {
    const dispose = initImport()
    const ta = document.querySelector<HTMLTextAreaElement>('[data-nlk="import-urls"]')!
    ta.value = URLS.join('\n')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('[data-nlk="import-run"]')!.click()
    await flush()

    expect(vi.mocked(importUrls)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(importUrls).mock.calls[0][0]).toEqual(URLS)
    // 実行が終わったら busy が解ける（実行ボタンが戻り、中断ボタンが隠れる）。
    expect(document.querySelector<HTMLButtonElement>('[data-nlk="import-run"]')!.hidden).toBe(false)
    expect(document.querySelector<HTMLButtonElement>('[data-nlk="import-stop"]')!.hidden).toBe(true)
    const text = document.querySelector('[data-nlk="import-progress"]')!.textContent ?? ''
    const remaining = ta.value.split('\n').filter(Boolean)
    dispose()
    return { text, remaining }
  }

  it('shows the importFailedSummary with the unprocessed count when the run stopped on a failure', async () => {
    vi.mocked(importUrls).mockResolvedValue({
      succeeded: [],
      failed: [{ url: URLS[0], reason: 'dialog did not close' }],
      aborted: false,
    })

    const { text, remaining } = await importThree()

    // 3 件投入・1 件目で失敗 → 成功 0 / 失敗 1 / 残り 2。
    expect(text).toMatch(
      /^(Stopped on failure: 0 imported \/ 1 failed \/ 2 not processed|失敗のため停止: 成功 0件 \/ 失敗 1件 \/ 残り 2件は未処理)$/,
    )
    expect(text).not.toMatch(/^完了|^Done/)
    // 失敗・未処理の URL は textarea に残る（リトライしやすくするため）。
    expect(remaining).toEqual(URLS)
  })

  it('counts the already-imported ones when it stopped on a later item', async () => {
    vi.mocked(importUrls).mockResolvedValue({
      succeeded: [URLS[0]],
      failed: [{ url: URLS[1], reason: 'timeout' }],
      aborted: false,
    })

    const { text, remaining } = await importThree()

    expect(text).toMatch(
      /^(Stopped on failure: 1 imported \/ 1 failed \/ 1 not processed|失敗のため停止: 成功 1件 \/ 失敗 1件 \/ 残り 1件は未処理)$/,
    )
    expect(remaining).toEqual([URLS[1], URLS[2]])
  })

  it('keeps the importDone summary when everything succeeded', async () => {
    vi.mocked(importUrls).mockResolvedValue({ succeeded: [...URLS], failed: [], aborted: false })

    const { text, remaining } = await importThree()

    expect(text).toMatch(/^(Done: 3 imported \/ 0 failed|完了: 成功 3件 \/ 失敗 0件)$/)
    expect(remaining).toEqual([])
  })

  it('shows the importAborted summary when the user stopped the run', async () => {
    vi.mocked(importUrls).mockResolvedValue({ succeeded: [URLS[0]], failed: [], aborted: true })

    const { text, remaining } = await importThree()

    expect(text).toMatch(
      /^(Stopped: 1 imported \/ 2 not processed|中断しました: 成功 1件 \/ 残り 2件は未処理)$/,
    )
    expect(remaining).toEqual([URLS[1], URLS[2]])
  })

  // 現行の importUrls は「中断」と「失敗」を同時には返さないが、分岐の優先順位
  // （利用者の中断が失敗より先）は固定しておく。importer が将来併発を返しても順序が退行しない。
  it('prefers the importAborted summary when the result is both aborted and failed', async () => {
    vi.mocked(importUrls).mockResolvedValue({
      succeeded: [URLS[0]],
      failed: [{ url: URLS[1], reason: 'x' }],
      aborted: true,
    })

    const { text } = await importThree()

    expect(text).toMatch(/^(Stopped: 1 imported \/ 1 not processed|中断しました: 成功 1件 \/ 残り 1件は未処理)$/)
  })
})
