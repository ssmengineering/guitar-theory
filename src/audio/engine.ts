/**
 * The player: every stem of a song through one time-stretcher.
 *
 * Signalsmith Stretch runs in an AudioWorklet and takes as many channels as it
 * is told to. We give it one channel per stem, so a tempo change moves all of
 * them by the same sample and the bass can never drift from the brushes. After
 * the stretcher a splitter fans the channels out to a gain and a meter per
 * stem, and they sum again at the output.
 *
 * Position is in song seconds whatever the rate, read straight from the
 * stretcher's own clock rather than estimated. This module imports nothing from
 * the theory engine; it only knows how to make a sound.
 */

import SignalsmithStretch from 'signalsmith-stretch'

export interface StemInput {
  id: string
  label: string
  /** The encoded file, as the package stores it. */
  bytes: ArrayBuffer
}

export interface StemState {
  id: string
  label: string
  /** 0..1, the fader. */
  gain: number
  muted: boolean
}

export interface LoopRange {
  start: number
  end: number
}

/** The stretcher's node, with the methods its worklet attaches at runtime. */
type StretchNode = AudioWorkletNode & {
  inputTime: number
  schedule(change: Record<string, number | boolean>): Promise<unknown>
  addBuffers(channels: Float32Array[], transfer?: ArrayBuffer[]): Promise<number>
  dropBuffers(): Promise<unknown>
  setUpdateInterval(seconds: number, callback: (time: number) => void): Promise<unknown>
}

interface StemNodes {
  state: StemState
  gain: GainNode
  analyser: AnalyserNode
  scratch: Uint8Array<ArrayBuffer>
}

/** How close to the end counts as the end: the stretcher rounds by block. */
const END_SLACK = 0.03

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Average an AudioBuffer's channels into one, padded with silence to `length`. */
function monoOf(buffer: AudioBuffer, length: number): Float32Array {
  const out = new Float32Array(length)
  const n = buffer.numberOfChannels
  for (let c = 0; c < n; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) out[i]! += data[i]! / n
  }
  return out
}

export class SongPlayer {
  readonly context: AudioContext
  private readonly master: GainNode
  private stretch: StretchNode | null = null
  private splitter: ChannelSplitterNode | null = null
  private stems: StemNodes[] = []
  private readonly tickers = new Set<() => void>()
  private ended = false

  /** Song length in seconds. */
  duration = 0
  /** Where we are, in song seconds. */
  position = 0
  /** 1 is the record's own tempo. */
  rate = 1
  loop: LoopRange | null = null
  playing = false

  constructor(context: AudioContext = new AudioContext()) {
    this.context = context
    this.master = context.createGain()
    this.master.connect(context.destination)
  }

  /** Decode the stems and build the graph. Replaces whatever was loaded before. */
  async load(inputs: StemInput[]): Promise<void> {
    this.unload()
    const decoded = await Promise.all(
      inputs.map((input) => this.context.decodeAudioData(input.bytes.slice(0))),
    )
    const length = Math.max(0, ...decoded.map((b) => b.length))
    const channels = decoded.map((b) => monoOf(b, length))
    this.duration = length / this.context.sampleRate

    const stretch = (await SignalsmithStretch(this.context, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [channels.length],
    })) as StretchNode
    await stretch.addBuffers(
      channels,
      channels.map((c) => c.buffer as ArrayBuffer),
    )

    const splitter = this.context.createChannelSplitter(channels.length)
    stretch.connect(splitter)
    this.stems = inputs.map((input, i) => {
      const gain = this.context.createGain()
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 1024
      // The meter sits after the fader so a muted stem reads as silence.
      splitter.connect(gain, i)
      gain.connect(analyser)
      analyser.connect(this.master)
      return {
        state: { id: input.id, label: input.label, gain: 1, muted: false },
        gain,
        analyser,
        scratch: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
      }
    })

    void stretch.setUpdateInterval(0.04, (time) => this.onTime(time))
    this.stretch = stretch
    this.splitter = splitter
    this.position = 0
    this.playing = false
    this.ended = false
    this.loop = null
    await stretch.schedule({ rate: this.rate, loopStart: 0, loopEnd: 0 })
  }

  /** Tear down the graph; the context stays for the next song. */
  unload(): void {
    for (const stem of this.stems) {
      stem.gain.disconnect()
      stem.analyser.disconnect()
    }
    this.splitter?.disconnect()
    if (this.stretch) {
      void this.stretch.schedule({ active: false })
      this.stretch.disconnect()
      void this.stretch.dropBuffers()
    }
    this.stems = []
    this.stretch = null
    this.splitter = null
    this.playing = false
    this.position = 0
    this.duration = 0
  }

  dispose(): void {
    this.unload()
    void this.context.close()
  }

  /** Called whenever the position or the transport state changes. */
  onTick(fn: () => void): () => void {
    this.tickers.add(fn)
    return () => this.tickers.delete(fn)
  }

  private notify(): void {
    for (const fn of this.tickers) fn()
  }

  private onTime(time: number): void {
    this.position = clamp(time, 0, this.duration)
    if (this.playing && !this.loop && time >= this.duration - END_SLACK) {
      void this.pause()
      this.ended = true
      this.position = this.duration
    }
    this.notify()
  }

  private async wake(): Promise<void> {
    if (this.context.state !== 'running') await this.context.resume()
    if (this.ended || this.position >= this.duration - END_SLACK) {
      this.ended = false
      await this.seek(this.loop ? this.loop.start : 0)
    }
  }

  async play(): Promise<void> {
    if (!this.stretch) return
    await this.wake()
    await this.stretch.schedule({ active: true, rate: this.rate })
    this.playing = true
    this.notify()
  }

  /**
   * Click `beats` times at `interval` seconds (real time, so already divided by
   * the rate), then start on the beat after the last click.
   */
  async countIn(beats: number, interval: number): Promise<void> {
    if (!this.stretch) return
    await this.wake()
    const first = this.context.currentTime + 0.05
    for (let k = 0; k < beats; k++) this.click(first + k * interval, k === 0)
    await this.stretch.schedule({ active: true, rate: this.rate, output: first + beats * interval })
    this.playing = true
    this.notify()
  }

  private click(at: number, accent: boolean): void {
    const osc = this.context.createOscillator()
    const env = this.context.createGain()
    osc.type = 'square'
    osc.frequency.value = accent ? 1500 : 1000
    env.gain.setValueAtTime(0.0001, at)
    env.gain.exponentialRampToValueAtTime(accent ? 0.35 : 0.25, at + 0.003)
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.07)
    osc.connect(env)
    env.connect(this.master)
    osc.start(at)
    osc.stop(at + 0.08)
  }

  async pause(): Promise<void> {
    if (!this.stretch) return
    await this.stretch.schedule({ active: false })
    this.playing = false
    this.notify()
  }

  /** Pause and go back to the loop start, or the top. */
  async stop(): Promise<void> {
    await this.pause()
    await this.seek(this.loop ? this.loop.start : 0)
  }

  async seek(time: number): Promise<void> {
    if (!this.stretch) return
    const t = clamp(time, 0, this.duration)
    this.ended = false
    await this.stretch.schedule({ input: t })
    this.position = t
    this.notify()
  }

  async setRate(rate: number): Promise<void> {
    this.rate = clamp(rate, 0.25, 2)
    await this.stretch?.schedule({ rate: this.rate })
    this.notify()
  }

  /** A loop shorter than a twentieth of a second is treated as none. */
  async setLoop(range: LoopRange | null): Promise<void> {
    const loop =
      range && range.end - range.start > 0.05
        ? { start: clamp(range.start, 0, this.duration), end: clamp(range.end, 0, this.duration) }
        : null
    this.loop = loop
    await this.stretch?.schedule(
      loop ? { loopStart: loop.start, loopEnd: loop.end } : { loopStart: 0, loopEnd: 0 },
    )
    if (loop && (this.position < loop.start || this.position > loop.end)) {
      await this.seek(loop.start)
    }
    this.notify()
  }

  stemStates(): StemState[] {
    return this.stems.map((s) => ({ ...s.state }))
  }

  /** The analyser sitting after a stem's fader, for anything that wants to draw it. */
  analyserFor(id: string): AnalyserNode | null {
    return this.stems.find((s) => s.state.id === id)?.analyser ?? null
  }

  setGain(id: string, gain: number): void {
    const stem = this.stems.find((s) => s.state.id === id)
    if (!stem) return
    stem.state.gain = clamp(gain, 0, 1)
    this.apply(stem)
  }

  setMuted(id: string, muted: boolean): void {
    const stem = this.stems.find((s) => s.state.id === id)
    if (!stem) return
    stem.state.muted = muted
    this.apply(stem)
  }

  private apply(stem: StemNodes): void {
    const target = stem.state.muted ? 0 : stem.state.gain
    stem.gain.gain.setTargetAtTime(target, this.context.currentTime, 0.01)
  }

  /** RMS level per stem, 0..1, after the fader. For meters. */
  levels(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const stem of this.stems) {
      stem.analyser.getByteTimeDomainData(stem.scratch)
      let sum = 0
      for (let i = 0; i < stem.scratch.length; i++) {
        const v = (stem.scratch[i]! - 128) / 128
        sum += v * v
      }
      out[stem.state.id] = Math.sqrt(sum / stem.scratch.length)
    }
    return out
  }
}
