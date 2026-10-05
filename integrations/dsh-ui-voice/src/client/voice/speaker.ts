/** FIFO audio playback; the visual speaking state follows started audio only. */
export class ReplySpeaker {
  private ctx: AudioContext | null = null
  private queue: ArrayBuffer[] = []
  private playing: AudioBufferSourceNode | null = null
  private drainRunning = false
  private finishCurrent: (() => void) | null = null
  private generation = 0
  private disposed = false
  private preparingValue = false
  private listeners = new Set<() => void>()
  error: string | null = null
  get preparing(): boolean { return this.preparingValue }
  set preparing(value: boolean) { this.preparingValue = value; this.emit() }
  get speaking(): boolean { return this.playing !== null && this.ctx?.state === 'running' }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit(): void { for (const listener of this.listeners) { try { listener() } catch (error) { console.error('[ui-voice] playback subscriber', error) } } }
  /** Called from an existing user gesture; does not request any device. */
  unlock(): void {
    if (this.disposed) return
    const ctx = this.ctx ?? (this.ctx = new AudioContext())
    if (ctx.state === 'suspended') void ctx.resume().catch(() => { this.error = 'playback'; this.emit() })
  }
  speak(wav: ArrayBuffer): void {
    if (this.disposed) return
    this.error = null; this.queue.push(wav); void this.drain()
  }
  private async drain(): Promise<void> {
    if (this.drainRunning) return
    this.drainRunning = true
    try {
      const ctx = this.ctx ?? (this.ctx = new AudioContext())
      while (this.queue.length && !this.disposed) {
        const generation = this.generation
        const wav = this.queue.shift()!
        try {
          if (ctx.state === 'suspended') {
            let timer: ReturnType<typeof setTimeout> | undefined
            try { await Promise.race([ctx.resume(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Audio gesture required')), 3000) })]) }
            finally { clearTimeout(timer) }
          }
          const buffer = await ctx.decodeAudioData(wav)
          if (this.disposed || generation !== this.generation) continue
          if (ctx.state !== 'running') throw new Error('AudioContext is not running')
          await new Promise<void>((resolve, reject) => {
            const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination)
            const finish = () => { source.onended = null; source.disconnect(); if (this.playing === source) this.playing = null; this.finishCurrent = null; this.emit(); resolve() }
            source.onended = finish; this.finishCurrent = finish
            try { source.start(); this.playing = source; this.emit() }
            catch (error) { finish(); reject(error) }
          })
        } catch (error) {
          if (generation === this.generation && !this.disposed) { this.error = 'playback'; this.queue = []; this.emit(); console.error('[ui-voice] playback failed', error) }
        }
      }
    } finally { this.drainRunning = false; this.emit() }
  }
  stop(): void {
    this.generation++; this.preparingValue = false; this.queue = []
    const source = this.playing
    if (source) { try { source.stop() } catch { /* Already ended. */ } }
    this.finishCurrent?.(); this.playing = null; this.emit()
  }
  dispose(): void {
    this.disposed = true; this.stop(); this.listeners.clear()
    if (this.ctx) { void this.ctx.close().catch(error => console.error('[ui-voice] audio close', error)); this.ctx = null }
  }
}
