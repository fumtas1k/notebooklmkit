export interface ParsedUrlList {
  valid: string[]
  invalid: string[]
}

// 貼り付けテキストを URL リストに正規化する純関数。
// 改行・空白で分割し、http/https のみ valid。valid は初出順を保って重複排除。
export function parseUrlList(text: string): ParsedUrlList {
  const valid: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  for (const token of text.split(/\s+/)) {
    const s = token.trim()
    if (!s) continue
    let ok = false
    try {
      const u = new URL(s)
      ok = u.protocol === 'http:' || u.protocol === 'https:'
    } catch {
      ok = false
    }
    if (!ok) {
      invalid.push(s)
    } else if (!seen.has(s)) {
      seen.add(s)
      valid.push(s)
    }
  }
  return { valid, invalid }
}
