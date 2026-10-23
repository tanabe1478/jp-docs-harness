// Web Audio で生成する穏やかな環境音。音源ファイルは使わない。
// ブラウンノイズを低域通過フィルタに通し、ごく遅い揺らぎを加えて風のような音にする。

const FADE_SECONDS = 1.2;

export class AmbientSound {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private lfo: OscillatorNode | null = null;
  private volume = 0.4;

  get playing(): boolean {
    return this.source !== null;
  }

  async start(volume: number): Promise<void> {
    this.volume = volume;
    if (this.source) return;
    const context = this.context ?? new AudioContext();
    this.context = context;
    if (context.state === "suspended") await context.resume();

    const buffer = context.createBuffer(1, context.sampleRate * 6, context.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < data.length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[index] = last * 3.2;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    filter.Q.value = 0.4;

    const swell = context.createGain();
    swell.gain.value = 0.75;
    const lfo = context.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoDepth = context.createGain();
    lfoDepth.gain.value = 0.22;
    lfo.connect(lfoDepth).connect(swell.gain);

    const master = context.createGain();
    master.gain.value = 0;
    source.connect(filter).connect(swell).connect(master).connect(context.destination);
    source.start();
    lfo.start();
    master.gain.linearRampToValueAtTime(this.scaled(volume), context.currentTime + FADE_SECONDS);

    this.source = source;
    this.lfo = lfo;
    this.master = master;
  }

  stop(): void {
    const { context, master, source, lfo } = this;
    if (!context || !master || !source) return;
    const end = context.currentTime + FADE_SECONDS / 2;
    master.gain.cancelScheduledValues(context.currentTime);
    master.gain.setValueAtTime(master.gain.value, context.currentTime);
    master.gain.linearRampToValueAtTime(0, end);
    source.stop(end);
    lfo?.stop(end);
    this.source = null;
    this.lfo = null;
    this.master = null;
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (!this.context || !this.master) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(this.scaled(volume), this.context.currentTime, 0.1);
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
  }

  // 聴感上なだらかに変わるよう二乗で効かせる。
  private scaled(volume: number): number {
    return Math.max(0, Math.min(1, volume)) ** 2 * 0.5;
  }
}
