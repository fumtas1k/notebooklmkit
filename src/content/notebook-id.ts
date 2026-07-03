// /notebook/<id> の pathname から notebook id を取り出す。該当しなければ null。
// main.ts の isNotebookPath（真偽のみ）とは役割が異なるため別関数として並存させる。
export function parseNotebookId(pathname: string): string | null {
  const m = pathname.match(/^\/notebook\/([^/?#]+)/)
  return m ? m[1] : null
}

// document.title（例: "タイトル - NotebookLM"）から末尾の " - NotebookLM" を除いてノートブック名を得る。
export function parseNotebookTitle(docTitle: string): string {
  return docTitle.replace(/\s*[-–—]\s*NotebookLM\s*$/i, '').trim()
}
