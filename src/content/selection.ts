export class SelectionStore {
  private selected = new Set<string>()
  private listeners = new Set<(size: number) => void>()

  toggle(key: string): void {
    if (this.selected.has(key)) this.selected.delete(key)
    else this.selected.add(key)
    this.emit()
  }

  set(key: string, on: boolean): void {
    const before = this.selected.size
    if (on) this.selected.add(key)
    else this.selected.delete(key)
    if (this.selected.size !== before) this.emit()
  }

  has(key: string): boolean {
    return this.selected.has(key)
  }

  replaceAll(keys: string[]): void {
    this.selected = new Set(keys)
    this.emit()
  }

  clear(): void {
    if (this.selected.size === 0) return
    this.selected.clear()
    this.emit()
  }

  get size(): number {
    return this.selected.size
  }

  keys(): string[] {
    return Array.from(this.selected)
  }

  onChange(cb: (size: number) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.selected.size)
  }
}
