import { describe, it, expect, vi } from 'vitest'
import { listOpenTabs } from '../src/content/tabs-bridge'
import { LIST_TABS_MESSAGE } from '../src/types'

describe('listOpenTabs', () => {
  it('sends the list-tabs message and returns tabs', async () => {
    const runtime = {
      sendMessage: vi.fn().mockResolvedValue({ tabs: [{ title: 'A', url: 'https://a.example/' }] }),
    }
    const tabs = await listOpenTabs(runtime)
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: LIST_TABS_MESSAGE })
    expect(tabs).toEqual([{ title: 'A', url: 'https://a.example/' }])
  })

  it('returns [] when the response has no tabs', async () => {
    const runtime = { sendMessage: vi.fn().mockResolvedValue(undefined) }
    expect(await listOpenTabs(runtime)).toEqual([])
  })

  it('rejects when chrome.runtime is unavailable', async () => {
    await expect(listOpenTabs(undefined)).rejects.toThrow()
  })
})
