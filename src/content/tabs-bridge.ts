import { LIST_TABS_MESSAGE, type TabInfo } from '../types'

export interface RuntimeLike {
  sendMessage(message: unknown): Promise<unknown>
}

function defaultRuntime(): RuntimeLike | undefined {
  return (globalThis as { chrome?: { runtime?: RuntimeLike } }).chrome?.runtime
}

// background へタブ一覧を要求する（MV3 の sendMessage は Promise を返す）。
// runtime は注入可能にして jsdom でテストする。
export async function listOpenTabs(
  runtime: RuntimeLike | undefined = defaultRuntime(),
): Promise<TabInfo[]> {
  if (!runtime) throw new Error('chrome.runtime unavailable')
  const res = (await runtime.sendMessage({ type: LIST_TABS_MESSAGE })) as
    | { tabs?: TabInfo[] }
    | null
    | undefined
  return res?.tabs ?? []
}
