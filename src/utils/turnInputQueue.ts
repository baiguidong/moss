export type TurnInputState = 'accepted' | 'consumed' | 'cancelled'
type Entry = { id: string; text: string; onState: (state: TurnInputState) => void }

/** One foreground engine owns this inbox; it is never shared with other sessions or agents. */
export class TurnInputQueue {
  private accepting = false
  private entries: Entry[] = []
  open() { this.close(); this.accepting = true }
  accept(entry: Entry): boolean {
    if (!this.accepting) return false
    if (this.entries.length >= 16 || this.entries.reduce((sum, item) => sum + Buffer.byteLength(item.text), 0) + Buffer.byteLength(entry.text) > 256_000) {
      throw new Error('待补充的内容过多，请等待当前消息加入上下文。')
    }
    this.entries.push(entry)
    return true
  }
  take(closeIfEmpty = false): Entry[] {
    const entries = this.entries.splice(0)
    if (!entries.length && closeIfEmpty) this.accepting = false
    return entries
  }
  close() {
    this.accepting = false
    for (const entry of this.entries.splice(0)) entry.onState('cancelled')
  }
}
