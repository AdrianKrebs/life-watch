// Tick-tock of an 18,000 vph movement: five beats a second.
//
// Each beat is three micro-events a few milliseconds apart (unlocking,
// impulse, drop), rendered once into a two-beat buffer with an
// OfflineAudioContext and looped, so the rhythm is sample-exact instead of
// depending on timers. In slow motion single beats are triggered instead.

const BEAT = 0.2;

type Ctor = typeof AudioContext;

function noiseBurst(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, q: number, gain: number, decay: number) {
	const len = Math.ceil(ctx.sampleRate * 0.03);
	const buf = ctx.createBuffer(1, len, ctx.sampleRate);
	const d = buf.getChannelData(0);
	for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * decay));
	const src = ctx.createBufferSource();
	src.buffer = buf;
	const bp = ctx.createBiquadFilter();
	bp.type = 'bandpass';
	bp.frequency.value = freq;
	bp.Q.value = q;
	const g = ctx.createGain();
	g.gain.value = gain;
	src.connect(bp).connect(g).connect(out);
	src.start(t);
}

function ring(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, gain: number, decay: number) {
	const osc = ctx.createOscillator();
	osc.frequency.value = freq;
	const g = ctx.createGain();
	g.gain.setValueAtTime(gain, t);
	g.gain.exponentialRampToValueAtTime(1e-4, t + decay);
	osc.connect(g).connect(out);
	osc.start(t);
	osc.stop(t + decay + 0.01);
}

function beat(ctx: BaseAudioContext, out: AudioNode, t: number, tock: boolean) {
	const p = tock ? 0.93 : 1;
	noiseBurst(ctx, out, t, 2600 * p, 1.6, 0.35, 0.0012); // unlocking
	noiseBurst(ctx, out, t + 0.0032, 4200 * p, 2.2, 0.55, 0.0016); // impulse
	noiseBurst(ctx, out, t + 0.0068, 5600 * p, 3, 0.9, 0.0022); // drop onto the pallet
	ring(ctx, out, t + 0.0068, 3350 * p, 0.05, 0.03);
	ring(ctx, out, t + 0.0068, 5150 * p, 0.025, 0.02);
}

export class TickAudio {
	private ctx: AudioContext | null = null;
	private loop: AudioBufferSourceNode | null = null;
	private master: GainNode | null = null;
	private buffer: AudioBuffer | null = null;
	private mode: 'off' | 'loop' | 'single' = 'off';

	async enable() {
		if (!this.ctx) {
			const nav = navigator as Navigator & { audioSession?: { type: string } };
			if (nav.audioSession) nav.audioSession.type = 'playback';
			const C: Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext;
			this.ctx = new C();
			const comp = this.ctx.createDynamicsCompressor();
			this.master = this.ctx.createGain();
			this.master.gain.value = 0.9;
			this.master.connect(comp).connect(this.ctx.destination);
			this.buffer = await this.render();
		}
		await this.ctx.resume();
	}

	disable() {
		this.stopLoop();
		this.mode = 'off';
		void this.ctx?.suspend();
	}

	private async render() {
		const rate = this.ctx!.sampleRate;
		const off = new OfflineAudioContext(1, Math.round(rate * BEAT * 2), rate);
		beat(off, off.destination, 0.001, false);
		beat(off, off.destination, BEAT + 0.001, true);
		return off.startRendering();
	}

	private stopLoop() {
		try {
			this.loop?.stop();
		} catch {
			// already stopped
		}
		this.loop?.disconnect();
		this.loop = null;
	}

	/** Called every frame with the simulation speed, current beat and simulated time. */
	sync(rate: number, beatIndex: number, simMs: number) {
		const ctx = this.ctx;
		if (!ctx || !this.master || !this.buffer || ctx.state !== 'running') return;
		if (rate === 1) {
			if (this.mode !== 'loop') {
				this.mode = 'loop';
				this.stopLoop();
				const src = ctx.createBufferSource();
				src.buffer = this.buffer;
				src.loop = true;
				src.connect(this.master);
				// Start on the watch's next beat, with the right half of the tick-tock pair.
				const next = Math.floor(simMs / 200) + 1;
				const startAt = ctx.currentTime + (next * 200 - simMs) / 1000;
				src.start(startAt, next % 2 === 1 ? BEAT : 0);
				this.loop = src;
			}
			this.lastBeat = beatIndex;
			return;
		}
		if (this.mode === 'loop') this.stopLoop();
		this.mode = 'single';
		if (rate > 0 && rate < 1 && beatIndex !== this.lastBeat) {
			beat(ctx, this.master, ctx.currentTime + 0.005, beatIndex % 2 === 1);
		}
		this.lastBeat = beatIndex;
	}

	/** Re-align the loop after a jump in simulated time. */
	resync() {
		if (this.mode === 'loop') {
			this.stopLoop();
			this.mode = 'single';
		}
	}

	private lastBeat = -1;
}
