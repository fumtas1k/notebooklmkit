import { describe, it, expect, beforeEach, vi } from 'vitest'
import { init, start, buildTargets } from '../src/content/main'
import { SelectionStore } from '../src/content/selection'
import { CHECKBOX_ATTR } from '../src/content/ui/row-checkbox'
import { deleteNotebooks } from '../src/content/deleter'

vi.mock('../src/content/deleter', () => ({
  deleteNotebooks: vi.fn(),
}))

const LIST = `
<div class="all-projects-container"><project-table><table class="project-table"><tbody>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">A</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
  <tr mat-row role="row"><td class="title-column"><span class="project-table-title">B</span></td>
    <td class="actions-column"><project-action-button><button class="project-button-more"></button></project-action-button></td></tr>
</tbody></table></project-table></div>`

describe('buildTargets', () => {
  beforeEach(() => { document.body.innerHTML = LIST })
  it('returns targets for currently selected keys only', () => {
    const store = new SelectionStore()
    store.set('title:A', true)
    const targets = buildTargets(store)
    expect(targets.map((t) => t.title)).toEqual(['A'])
    expect(targets.map((t) => t.key)).toEqual(['title:A'])
  })
})

describe('init', () => {
  beforeEach(() => { document.body.innerHTML = LIST })
  it('injects checkboxes and the action bar', () => {
    init()
    expect(document.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()
  })
})

describe('start (async / SPA mount)', () => {
  it('waits for .all-projects-container to appear, then bootstraps init exactly once', async () => {
    // Use a detached, dedicated root: no `.all-projects-container` exists yet,
    // simulating a cold/SPA load where the container mounts asynchronously.
    // Scoping the DOM (and the bootstrap observer) to a detached root keeps
    // this test isolated from stale MutationObservers left behind by other
    // `init()` calls elsewhere in this file (init/start never auto-disconnect
    // unless the caller keeps and invokes the returned disposer).
    const root = document.createElement('div')
    expect(root.querySelector('.all-projects-container')).toBeNull()

    const dispose = start(root)
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(0)

    root.innerHTML = LIST
    // MutationObserver callbacks are queued as microtasks.
    await Promise.resolve()
    await Promise.resolve()

    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
    expect(document.querySelector('[data-nlk="action-bar"]')).not.toBeNull()

    dispose()
  })

  it('calls init immediately when the container already exists', () => {
    const root = document.createElement('div')
    root.innerHTML = LIST
    const dispose = start(root)
    expect(root.querySelectorAll(`[${CHECKBOX_ATTR}]`).length).toBe(2)
    dispose()
  })
})

describe('runDelete error recovery', () => {
  beforeEach(() => {
    vi.mocked(deleteNotebooks).mockReset()
  })

  it('un-busies the action bar and shows domError if deleteNotebooks rejects', async () => {
    vi.mocked(deleteNotebooks).mockRejectedValue(new Error('unexpected DOM failure'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Use a detached root for the notebook rows/checkboxes: init() never
    // disconnects its MutationObserver, so earlier tests in this file left
    // observers watching `document`/`document.body`. Feeding rows through a
    // node those stale observers don't watch keeps this test from racing
    // with them (the action bar / confirm dialog still mount on
    // document.body by default, which is fine since only this test drives
    // them).
    const root = document.createElement('div')
    root.innerHTML = LIST
    init(root)
    const checkbox = root.querySelector<HTMLInputElement>(`[${CHECKBOX_ATTR}]`)
    expect(checkbox).not.toBeNull()
    checkbox!.checked = true
    checkbox!.dispatchEvent(new Event('change'))

    const deleteBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-delete"]')
    deleteBtn!.click()

    // confirmDeletion resolves its promise synchronously up to the dialog
    // insertion, so the confirm dialog is present right after the click.
    const okBtn = document.querySelector<HTMLButtonElement>('[data-nlk="confirm-ok"]')
    expect(okBtn).not.toBeNull()
    okBtn!.click()

    // Flush the microtask queue so the rejected deleteNotebooks() and the
    // surrounding try/finally in runDelete settle.
    await new Promise((resolve) => setTimeout(resolve, 0))

    const stopBtn = document.querySelector<HTMLButtonElement>('[data-nlk="bar-stop"]')
    const progress = document.querySelector('[data-nlk="bar-progress"]')
    expect(stopBtn!.hidden).toBe(true) // bar left the busy state
    expect(deleteBtn!.hidden).toBe(false)
    expect(progress!.textContent).toMatch(/did not match expectations|想定と異なる/)
    expect(errSpy).toHaveBeenCalled()

    errSpy.mockRestore()
  })
})
