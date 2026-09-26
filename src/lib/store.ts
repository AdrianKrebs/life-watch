import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';

// The simulated clock is anchored: simMs = anchorSim + (performance.now() - anchorPerf) * rate.
// Changing rate re-anchors so time never jumps. Each watch on a page has its own store.

export interface Speed {
	id: string;
	label: string;
	rate: number;
	hint: string;
}

export const SPEEDS: Speed[] = [
	{ id: 'pause', label: 'Pause', rate: 0, hint: 'Stop the watch' },
	{ id: 'slow', label: '1/20×', rate: 0.05, hint: 'Slow motion: watch the escapement tick' },
	{ id: 'real', label: 'Live', rate: 1, hint: 'Real time' },
	{ id: 'hour', label: '1 h/s', rate: 3600, hint: 'An hour per second' },
	{ id: 'day', label: '1 day/s', rate: 86_400, hint: 'A day per second: watch the calendar' },
	{ id: 'month', label: '1 mo/s', rate: 86_400 * 30.44, hint: 'A month per second: watch the 48-month cam' },
];

export interface WatchStoreState {
	anchorSim: number;
	anchorPerf: number;
	rate: number;
	speed: string;
	explode: number;
	hovered: string | null;
	sound: boolean;
	/** Which side of the watch faces the camera. */
	view: 'front' | 'back';
	setSpeed: (id: string) => void;
	jumpTo: (simMs: number, speed?: string) => void;
	resetNow: () => void;
	setExplode: (v: number) => void;
	setHovered: (id: string | null) => void;
	setSound: (on: boolean) => void;
	setView: (v: WatchStoreState['view']) => void;
}

export type WatchStore = StoreApi<WatchStoreState>;

const perf = () => (typeof performance !== 'undefined' ? performance.now() : 0);

export function simNow(s: Pick<WatchStoreState, 'anchorSim' | 'anchorPerf' | 'rate'>, at = perf()) {
	return s.anchorSim + (at - s.anchorPerf) * s.rate;
}

export function createWatchStore(): WatchStore {
	return createStore<WatchStoreState>((set, get) => ({
		anchorSim: Date.now(),
		anchorPerf: perf(),
		rate: 1,
		speed: 'real',
		explode: 0,
		hovered: null,
		sound: false,
		view: 'front',
		setSpeed: (id) => {
			const speed = SPEEDS.find((s) => s.id === id);
			if (!speed) return;
			const now = perf();
			set({ anchorSim: simNow(get(), now), anchorPerf: now, rate: speed.rate, speed: id });
		},
		jumpTo: (simMs, speed = 'real') => {
			const s = SPEEDS.find((x) => x.id === speed)!;
			set({ anchorSim: simMs, anchorPerf: perf(), rate: s.rate, speed });
		},
		resetNow: () => set({ anchorSim: Date.now(), anchorPerf: perf(), rate: 1, speed: 'real' }),
		setExplode: (v) => set({ explode: Math.min(1, Math.max(0, v)) }),
		setHovered: (id) => set({ hovered: id }),
		setSound: (on) => set({ sound: on }),
		setView: (view) => set({ view }),
	}));
}

export const WatchStoreContext = createContext<WatchStore | null>(null);

export function useWatchStore(): WatchStore {
	const store = useContext(WatchStoreContext);
	if (!store) throw new Error('life-watch: missing WatchStoreContext');
	return store;
}

export function useWatch<T>(selector: (s: WatchStoreState) => T): T {
	return useStore(useWatchStore(), selector);
}
