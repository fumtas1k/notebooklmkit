export interface RowIdentity {
  title: string
  jslog: string | null
}

export interface NotebookTarget extends RowIdentity {
  key: string
}

export interface DeleteProgress {
  total: number
  completed: number
  failed: number
  currentTitle?: string
}

export interface DeleteResult {
  succeeded: string[]
  failed: { key: string; reason: string }[]
  aborted: boolean
}

export function makeTarget(id: RowIdentity): NotebookTarget {
  const key = id.jslog ?? `title:${id.title}`
  return { ...id, key }
}
