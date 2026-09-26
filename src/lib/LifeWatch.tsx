import { lazy, Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { TickAudio } from './audio';
import { resolveConfig, type LifeWatchConfig, type ResolvedConfig } from './config';
import { prepareFonts } from './fonts';
import { GROUPS, type GroupId } from './model/part';
import { createWatchStore, simNow, SPEEDS, useWatch, useWatchStore, WatchStoreContext } from './store';
import { nextBirthdayEve, nextLeapDayEve, nextMonthEnd, nextShortFebruaryEnd } from './time';
import type { Shared } from './WatchCanvas';
import './life-watch.css';

const WatchCanvas = lazy(() => import('./WatchCanvas'));

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

function hasWebGL2() {
	try {
		return !!document.createElement('canvas').getContext('webgl2');
	} catch {
		return false;
	}
}

function Headphones() {
	return (
		<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
			<path d="M4 15v-3a8 8 0 0 1 16 0v3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
			<rect x="3" y="14" width="4.5" height="7" rx="1.6" fill="currentColor" />
			<rect x="16.5" y="14" width="4.5" height="7" rx="1.6" fill="currentColor" />
		</svg>
	);
}

function MuseumLabel({ audio, config }: { audio: TickAudio; config: ResolvedConfig }) {
	const sound = useWatch((s) => s.sound);
	const setSound = useWatch((s) => s.setSound);
	const toggle = async () => {
		if (sound) {
			audio.disable();
			setSound(false);
		} else {
			await audio.enable();
			setSound(true);
		}
	};
	return (
		<aside className="lw-museum">
			<div className="lw-museum-body">
				<strong>{config.label.title}</strong>
				{config.label.subtitle && <span className="lw-museum-en">{config.label.subtitle}</span>}
				{config.label.lines.map((l) => (
					<span key={l}>{l}</span>
				))}
				{config.label.footnote && <span className="lw-museum-small">{config.label.footnote}</span>}
			</div>
			<button type="button" className={`lw-listen ${sound ? 'on' : ''}`} onClick={toggle} aria-pressed={sound} title={sound ? 'Mute the tick' : 'Listen to the movement'}>
				<Headphones />
			</button>
			{config.label.inventory && <span className="lw-museum-inv">{config.label.inventory}</span>}
		</aside>
	);
}

function Reading({ shared, audio }: { shared: MutableRefObject<Shared>; audio: TickAudio }) {
	const ageRef = useRef<HTMLSpanElement>(null);
	const dateRef = useRef<HTMLSpanElement>(null);
	const store = useWatchStore();
	useEffect(() => {
		let raf = 0;
		let lastText = '';
		const tick = () => {
			raf = requestAnimationFrame(tick);
			const s = shared.current.state;
			const st = store.getState();
			if (s) audio.sync(st.rate, s.beatIndex, simNow(st));
			if (!s || !ageRef.current || !dateRef.current) return;
			const sod = Math.max(0, Math.floor(s.secondsOfDay + 0.05)) % 86_400;
			const d = s.daysSinceBirthday;
			const text = `${s.ageYears} years, ${d} ${d === 1 ? 'day' : 'days'}, ${pad(Math.floor(sod / 3600))}:${pad(Math.floor((sod % 3600) / 60))}:${pad(sod % 60)}`;
			if (text !== lastText) {
				lastText = text;
				ageRef.current.textContent = text;
				dateRef.current.textContent = `${WEEKDAY_NAMES[s.weekday]} ${s.date} ${MONTH_NAMES[s.month - 1]} ${s.year} · ${s.daysLived.toLocaleString('en-US')} days lived`;
			}
		};
		tick();
		return () => cancelAnimationFrame(raf);
	}, [shared, audio, store]);
	return (
		<div className="lw-reading" aria-live="off">
			<span className="lw-reading-age" ref={ageRef} />
			<span className="lw-reading-date" ref={dateRef} />
		</div>
	);
}

function Controls({ audio, config }: { audio: TickAudio; config: ResolvedConfig }) {
	const store = useWatchStore();
	const view = useWatch((s) => s.view);
	const explode = useWatch((s) => s.explode);
	const speed = useWatch((s) => s.speed);
	const { setView, setExplode, setSpeed, jumpTo, resetNow } = store.getState();

	const exploded = explode > 0.5;
	const jump = (fn: (from: number, lead?: number) => number) => {
		jumpTo(fn(simNow(store.getState()), 7), 'real');
		audio.resync();
	};

	return (
		<div className="lw-controls">
			<div className="lw-group" role="group" aria-label="View">
				<button type="button" className={view === 'front' ? 'on' : ''} onClick={() => setView('front')}>
					Dial
				</button>
				<button type="button" className={view === 'back' ? 'on' : ''} onClick={() => setView('back')}>
					Movement
				</button>
				<button type="button" className={exploded ? 'on' : ''} onClick={() => setExplode(exploded ? 0 : 1)} aria-pressed={exploded}>
					{exploded ? 'Assemble' : 'Explode'}
				</button>
			</div>
			<label className="lw-slider">
				<span>Assembled</span>
				<input
					type="range"
					min={0}
					max={1}
					step={0.001}
					value={explode}
					onChange={(e) => setExplode(Number(e.target.value))}
					aria-label="Explode the watch"
				/>
				<span>Exploded</span>
			</label>
			<div className="lw-group" role="group" aria-label="Speed">
				{SPEEDS.map((s) => (
					<button
						key={s.id}
						type="button"
						className={speed === s.id ? 'on' : ''}
						title={s.hint}
						onClick={() => {
							setSpeed(s.id);
							audio.resync();
						}}
					>
						{s.label}
					</button>
				))}
			</div>
			<div className="lw-group lw-jumps" role="group" aria-label="Jump to">
				<button type="button" onClick={() => jump((from, lead) => nextBirthdayEve(from, config.birth, lead))} title="Seven seconds before midnight on the next birthday">
					Birthday
				</button>
				<button type="button" onClick={() => jump(nextMonthEnd)} title="Seven seconds before the end of this month">
					Month end
				</button>
				<button type="button" onClick={() => jump(nextShortFebruaryEnd)} title="28 February → 1 March: the date star skips three teeth">
					28 Feb
				</button>
				<button type="button" onClick={() => jump(nextLeapDayEve)} title="The next 29 February">
					Leap day
				</button>
				<button
					type="button"
					onClick={() => {
						resetNow();
						audio.resync();
					}}
				>
					Now
				</button>
			</div>
		</div>
	);
}

function Labels({ shared }: { shared: MutableRefObject<Shared> }) {
	const ids = Object.keys(GROUPS) as GroupId[];
	const lines = useRef(new Map<GroupId, SVGLineElement>());
	const dots = useRef(new Map<GroupId, SVGCircleElement>());
	const register = (id: GroupId) => {
		const line = lines.current.get(id);
		const dot = dots.current.get(id);
		if (line && dot) shared.current.leaders.set(id, { line, dot });
	};
	return (
		<div
			className="lw-labels"
			ref={(el) => {
				shared.current.labelLayer = el;
			}}
			aria-hidden="true"
		>
			<svg className="lw-leaders">
				{ids.map((id) => (
					<g key={id}>
						<line
							ref={(el) => {
								if (el) lines.current.set(id, el);
								register(id);
							}}
						/>
						<circle
							r={2.6}
							ref={(el) => {
								if (el) dots.current.set(id, el);
								register(id);
							}}
						/>
					</g>
				))}
			</svg>
			{ids.map((id) => (
				<div
					key={id}
					className="lw-label"
					ref={(el) => {
						if (el) shared.current.labels.set(id, el);
						else shared.current.labels.delete(id);
					}}
				>
					<div className="lw-label-box">
						<strong>{GROUPS[id].title}</strong>
					</div>
				</div>
			))}
		</div>
	);
}

function Tooltip({ shared, pointer }: { shared: MutableRefObject<Shared>; pointer: MutableRefObject<{ x: number; y: number }> }) {
	const hovered = useWatch((s) => s.hovered);
	const ref = useRef<HTMLDivElement>(null);
	const info = hovered ? shared.current.describe?.(hovered) : undefined;
	useEffect(() => {
		let raf = 0;
		const loop = () => {
			raf = requestAnimationFrame(loop);
			if (ref.current) ref.current.style.transform = `translate(${pointer.current.x + 18}px, ${pointer.current.y + 18}px)`;
		};
		loop();
		return () => cancelAnimationFrame(raf);
	}, [pointer]);
	return (
		<div className={`lw-tooltip ${info ? 'on' : ''}`} ref={ref} role="status">
			{info && (
				<>
					<strong>{info.name}</strong>
					<span>{info.info}</span>
				</>
			)}
		</div>
	);
}

export interface LifeWatchProps {
	config: LifeWatchConfig;
	className?: string;
}

/** The full, interactive life watch: dial, movement, exploded view, time controls. */
export default function LifeWatch({ config, className }: LifeWatchProps) {
	const resolved = useMemo(() => resolveConfig(config), [config]);
	const store = useMemo(() => createWatchStore(), []);
	return (
		<WatchStoreContext.Provider value={store}>
			<Stage config={resolved} className={className} />
		</WatchStoreContext.Provider>
	);
}

function Stage({ config, className }: { config: ResolvedConfig; className?: string }) {
	const store = useWatchStore();
	const [ready, setReady] = useState(false);
	const [webgl, setWebgl] = useState(true);
	const shared = useRef<Shared>({ state: null, labels: new Map(), leaders: new Map(), labelLayer: null });
	const pointer = useRef({ x: -999, y: -999 });
	const audio = useMemo(() => new TickAudio(), []);

	useEffect(() => {
		if (import.meta.env.DEV) (window as unknown as { __lw: typeof store }).__lw = store;
		if (!hasWebGL2()) {
			setWebgl(false);
			return;
		}
		prepareFonts(config.loadFonts).then(() => setReady(true));
		const onVis = () => {
			if (document.hidden && store.getState().sound) audio.disable();
			else if (!document.hidden && store.getState().sound) void audio.enable();
		};
		document.addEventListener('visibilitychange', onVis);
		return () => {
			document.removeEventListener('visibilitychange', onVis);
			audio.disable();
		};
	}, [audio, store, config.loadFonts]);

	return (
		<div
			className={`lw-stage${className ? ` ${className}` : ''}`}
			onPointerMove={(e) => {
				const r = e.currentTarget.getBoundingClientRect();
				pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
			}}
			onPointerDown={(e) => {
				const r = e.currentTarget.getBoundingClientRect();
				pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
			}}
			onPointerLeave={(e) => {
				if (e.pointerType !== 'touch') store.getState().setHovered(null);
			}}
		>
			{webgl ? (
				ready && (
					<Suspense fallback={<div className="lw-loading">Assembling the movement…</div>}>
						<WatchCanvas shared={shared} config={config} />
					</Suspense>
				)
			) : (
				<div className="lw-loading">This watch needs WebGL 2 to run.</div>
			)}
			{!ready && webgl && <div className="lw-loading">Assembling the movement…</div>}
			<MuseumLabel audio={audio} config={config} />
			<Labels shared={shared} />
			<Tooltip shared={shared} pointer={pointer} />
			<Reading shared={shared} audio={audio} />
			<Controls audio={audio} config={config} />
		</div>
	);
}
