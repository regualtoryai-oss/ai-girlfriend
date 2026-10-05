/** Explicit, one-shot microphone capture. Silence never ends or submits a turn. */
import { MIC_CAPTURE_WORKLET_SOURCE } from '../worklets/mic-capture.ts'

export class MicRecorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private chunks: ArrayBuffer[] = []
  private bytes = 0
  private released = false
  private started = false
  private finishing: (() => void) | null = null

  constructor(private readonly onError?: () => void) {}

  async start(): Promise<void> {
    if (this.started || this.released) throw new Error('Recorder already used')
    this.started = true
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } })
      if (this.released) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      this.stream = stream
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      this.ctx = ctx
      const url = URL.createObjectURL(new Blob([MIC_CAPTURE_WORKLET_SOURCE], { type: 'text/javascript' }))
      try { await ctx.audioWorklet.addModule(url) }
      finally { URL.revokeObjectURL(url) }
      if (this.released) return
      const source = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'mic-capture', {
        numberOfInputs: 1, numberOfOutputs: 0, processorOptions: { chunkMs: 40 },
      })
      this.source = source
      this.node = node
      node.port.onmessage = event => {
        if (this.released) return
        if (event.data instanceof ArrayBuffer) {
          // Bound memory to five minutes without submitting a partial utterance.
          if (this.bytes + event.data.byteLength > 16000 * 2 * 300) {
            this.stop()
            this.onError?.()
            return
          }
          this.chunks.push(event.data)
          this.bytes += event.data.byteLength
        } else if (event.data?.kind === 'flushed') this.finishing?.()
      }
      source.connect(node)
      await ctx.resume()
    } catch (error) {
      this.stop()
      throw error
    }
  }

  /** Stop tracks immediately, then drain the worklet's last fractional chunk. */
  async finish(): Promise<ArrayBuffer> {
    if (this.released) return new ArrayBuffer(0)
    this.source?.disconnect()
    this.stream?.getTracks().forEach(track => track.stop())
    if (this.node) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.finishing = null; resolve() }, 300)
        this.finishing = () => { clearTimeout(timer); this.finishing = null; resolve() }
        this.node!.port.postMessage({ kind: 'flush' })
      })
    }
    const pcm = new Uint8Array(this.bytes)
    let offset = 0
    for (const chunk of this.chunks) { pcm.set(new Uint8Array(chunk), offset); offset += chunk.byteLength }
    this.stop()
    return pcm.buffer
  }

  /** Cancellation discards all captured audio, including a pending start. */
  stop(): void {
    this.released = true
    this.finishing?.()
    this.node?.port.close()
    this.source?.disconnect()
    this.stream?.getTracks().forEach(track => track.stop())
    void this.ctx?.close().catch(() => {})
    this.node = null
    this.source = null
    this.stream = null
    this.ctx = null
    this.chunks = []
    this.bytes = 0
  }
}
