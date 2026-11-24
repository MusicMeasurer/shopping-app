/**
 * Initial/explicit reads are blocking; automatic cache refreshes are not.
 * A read begun before a local mutation may not overwrite that mutation.
 * Overlapping reads are superseded and reconciled again after the write.
 * This is a local view coordinator, not a change to the cloud queue.
 */
export class ItemReadGate {
  private generation = 0
  private reading = false
  private writing = false
  private refreshAfterWrite = false
  private blockingRead = true

  get blocking() { return this.blockingRead }

  startRead(blocking = false): number {
    this.blockingRead ||= blocking
    this.reading = true
    if (this.writing) this.refreshAfterWrite = true
    return ++this.generation
  }

  finishRead(ticket: number): boolean {
    if (ticket !== this.generation || !this.reading) return false
    this.reading = false
    this.blockingRead = false
    return true
  }

  startWrite(): boolean {
    if (this.writing || this.blockingRead) return false
    this.writing = true
    this.refreshAfterWrite = this.reading
    this.invalidateRead()
    return true
  }

  finishWrite(): boolean {
    this.writing = false
    const refresh = this.refreshAfterWrite || this.reading
    this.refreshAfterWrite = false
    this.invalidateRead()
    return refresh
  }

  invalidateRead() {
    this.generation++
    this.reading = false
  }
}
