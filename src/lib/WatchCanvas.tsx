import { CameraControls, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { LAYER_GAP, WatchModel } from './model/WatchModel';
import { GROUP_ANCHORS, type GroupId } from './model/part';
import { modelKey, type ResolvedConfig } from './config';
import { simNow, useWatch, useWatchStore } from './store';
import { watchState, type WatchState } from './time';

export interface Shared {
	state: WatchState | null;
	labels: Map<GroupId, HTMLElement>;
	leaders: Map<GroupId, { line: SVGLineElement; dot: SVGCircleElement }>;
	labelLayer: HTMLElement | null;
	/** Corners of every part's box in the fully exploded watch, for framing. */
	explodedPoints?: THREE.Vector3[];
	describe?: (id: string) => { name: string; info: string } | undefined;
}

const BG = '#f4eee6';
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Camera presets (mm). The watch faces +z, 12 o'clock is +y.
const VIEWS = {
	front: { pos: [14, -10, 168], target: [0, 3, 0] },
	back: { pos: [-14, -8, -168], target: [0, 3, -6] },
} as const;
// Exploded: look along a steep oblique so every layer shows; azimuth from +z, polar from +y.
const EXPLODED = {
	front: { azimuth: 1.02, polar: 1.2 },
	back: { azimuth: Math.PI - 1.02, polar: 1.2 },
	frontPortrait: { azimuth: 0.35, polar: 0.52 },
	backPortrait: { azimuth: Math.PI - 0.35, polar: 0.52 },
};

function Watch({
	shared,
	config,
	quality,
	interactive,
	onReady,
}: {
	shared: MutableRefObject<Shared>;
	config: ResolvedConfig;
	quality: 'high' | 'low';
	interactive: boolean;
	onReady?: () => void;
}) {
	const key = modelKey(config);
	// Rebuild only when something that changes geometry or textures changes.
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const model = useMemo(() => new WatchModel(config, quality), [key, quality]);
	const store = useWatchStore();
	const birth = config.birth;
	const explodeRef = useRef(0);
	const frames = useRef(0);
	const { camera, size } = useThree();
	const setHovered = useWatch((s) => s.setHovered);

	useEffect(() => {
		shared.current.describe = (id) => model.part(id);
		if (import.meta.env.DEV) (window as unknown as { __lwModel: WatchModel }).__lwModel = model;
		// Hands cast shadows on the dial; so do the bezel and case.
		for (const id of ['hourHand', 'minuteHand', 'dateHand', 'secondsHand', 'dayHand', 'monthHand', 'leapHand', 'handCap', 'bezel']) {
			model.part(id)?.object.traverse((o) => {
				if ((o as THREE.Mesh).isMesh) o.castShadow = true;
			});
		}
		// Glass shouldn't catch the pointer.
		for (const id of ['crystal']) {
			model.part(id)?.object.traverse((o) => {
				(o as THREE.Mesh).raycast = () => undefined;
			});
		}
		model.part('caseBack')?.object.children.forEach((c, i) => {
			if (i > 0) (c as THREE.Mesh).raycast = () => undefined;
		});
		return () => model.dispose();
	}, [model, shared]);

	// Group anchor boxes measured once, assembled.
	const anchors = useMemo(() => {
		model.update(watchState(Date.now(), birth), 0, 0);
		model.root.updateMatrixWorld(true);
		const list = (Object.keys(GROUP_ANCHORS) as GroupId[]).flatMap((id) => {
			const p = model.part(GROUP_ANCHORS[id]);
			if (!p) return [];
			const box = new THREE.Box3().setFromObject(p.object);
			return box.isEmpty() ? [] : [{ id, box, layer: p.layer }];
		});
		// And the whole watch fully exploded, for the camera to frame.
		model.update(watchState(Date.now(), birth), 0, 1);
		model.root.updateMatrixWorld(true);
		const pts: THREE.Vector3[] = [];
		const pb = new THREE.Box3();
		for (const p of model.parts) {
			pb.setFromObject(p.object);
			if (pb.isEmpty()) continue;
			for (let i = 0; i < 8; i++) pts.push(new THREE.Vector3(i & 1 ? pb.max.x : pb.min.x, i & 2 ? pb.max.y : pb.min.y, i & 4 ? pb.max.z : pb.min.z));
		}
		shared.current.explodedPoints = pts;
		model.update(watchState(Date.now(), birth), 0, 0);
		return list.sort((a, b) => b.layer - a.layer);
	}, [model, shared]);

	const v = useMemo(() => new THREE.Vector3(), []);
	useFrame((_, rawDt) => {
		const dt = Math.min(rawDt, 0.1);
		const s = store.getState();
		const now = performance.now();
		const sim = simNow(s, now);
		const fast = Math.abs(s.rate) > 2;
		const state = watchState(sim, birth, fast ? now : undefined);
		shared.current.state = state;
		explodeRef.current += (s.explode - explodeRef.current) * (reducedMotion() ? 1 : 1 - Math.exp(-4.5 * dt));
		if (Math.abs(s.explode - explodeRef.current) < 1e-4) explodeRef.current = s.explode;
		model.setHovered(interactive ? s.hovered : null);
		model.update(state, dt, explodeRef.current);
		// Tell the page once real frames are on screen, so a poster can fade out.
		if (++frames.current === 3) onReady?.();

		// Exploded-view labels, laid out in two lanes above and below the stack.
		const e = explodeRef.current;
		const layer = shared.current.labelLayer;
		if (layer) layer.style.opacity = String(Math.max(0, Math.min(1, (e - 0.6) / 0.3)));
		if (e > 0.55) layoutLabels(e);
	});

	const widths = useMemo(() => new Map<GroupId, number>(), []);
	const layoutLabels = (e: number) => {
		const t = Math.min(1, Math.max(0, (e - 0.1) / 0.9));
		const pts = anchors.map((a) => {
			const z = (a.box.min.z + a.box.max.z) / 2 + a.layer * LAYER_GAP * t;
			const cx = (a.box.min.x + a.box.max.x) / 2;
			v.set(cx, (a.box.min.y + a.box.max.y) / 2, z).project(camera);
			return { a, sx: (v.x * 0.5 + 0.5) * size.width, z, cx };
		});
		pts.sort((p, q) => p.sx - q.sx);
		const items = pts.map((p, i) => {
			const up = i % 2 === 0;
			v.set(p.cx, up ? p.a.box.max.y : p.a.box.min.y, p.z).project(camera);
			return { id: p.a.id, up, ax: (v.x * 0.5 + 0.5) * size.width, ay: (-v.y * 0.5 + 0.5) * size.height, x: 0 };
		});
		const topLane = Math.max(size.width > 760 ? 178 : 132, Math.min(...items.filter((i) => i.up).map((i) => i.ay)) - 58);
		const bottomLane = Math.min(size.height - 96, Math.max(...items.filter((i) => !i.up).map((i) => i.ay)) + 58);
		for (const up of [true, false]) {
			const lane = items.filter((i) => i.up === up).sort((p, q) => p.ax - q.ax);
			lane.forEach((it) => {
				const el = shared.current.labels.get(it.id);
				if (el && !widths.get(it.id)) widths.set(it.id, (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 100);
				it.x = it.ax;
			});
			// Push apart, then recentre the lane on its anchors.
			for (let k = 1; k < lane.length; k++) {
				const min = ((widths.get(lane[k - 1].id) ?? 100) + (widths.get(lane[k].id) ?? 100)) / 2 + 10;
				if (lane[k].x - lane[k - 1].x < min) lane[k].x = lane[k - 1].x + min;
			}
			if (lane.length) {
				const shift = (lane.reduce((s, i) => s + i.x - i.ax, 0) / lane.length) * 0.8;
				lane.forEach((i) => (i.x -= shift));
				// Keep clear of the museum card (top left) and the edges.
				const w0 = (widths.get(lane[0].id) ?? 100) / 2;
				const minX = (up && size.width > 760 ? 350 : 12) + w0;
				if (lane[0].x < minX) {
					const d = minX - lane[0].x;
					lane.forEach((i) => (i.x += d));
				}
				const last = lane[lane.length - 1];
				const maxX = size.width - 12 - (widths.get(last.id) ?? 100) / 2;
				if (last.x > maxX) {
					const d = Math.min(last.x - maxX, lane[0].x - minX);
					lane.forEach((i) => (i.x -= d));
				}
			}
		}
		for (const it of items) {
			const el = shared.current.labels.get(it.id);
			const lead = shared.current.leaders.get(it.id);
			const ly = it.up ? topLane : bottomLane;
			// Anchors off screen (e.g. zoomed in by hand) get no label.
			const onScreen = it.ax > -20 && it.ax < size.width + 20 && it.ay > -20 && it.ay < size.height + 20;
			if (el) {
				el.style.transform = `translate(${it.x.toFixed(1)}px, ${ly.toFixed(1)}px)`;
				el.dataset.side = it.up ? 'up' : 'down';
				el.style.visibility = onScreen ? 'visible' : 'hidden';
			}
			if (lead) lead.line.parentElement!.style.visibility = onScreen ? 'visible' : 'hidden';
			if (lead) {
				lead.line.setAttribute('x1', it.ax.toFixed(1));
				lead.line.setAttribute('y1', it.ay.toFixed(1));
				lead.line.setAttribute('x2', it.x.toFixed(1));
				lead.line.setAttribute('y2', ly.toFixed(1));
				lead.dot.setAttribute('cx', it.ax.toFixed(1));
				lead.dot.setAttribute('cy', it.ay.toFixed(1));
			}
		}
	};

	const onMove = (e: ThreeEvent<PointerEvent>) => {
		if (e.pointerType === 'touch') return;
		e.stopPropagation();
		const id = e.object.userData.partId as string | undefined;
		setHovered(id ?? null);
	};

	// On touch screens a tap identifies a part.
	const onDown = (e: ThreeEvent<PointerEvent>) => {
		if (e.pointerType !== 'touch') return;
		e.stopPropagation();
		const id = e.object.userData.partId as string | undefined;
		setHovered(store.getState().hovered === id ? null : (id ?? null));
	};

	if (!interactive) return <primitive object={model.root} />;
	return <primitive object={model.root} onPointerMove={onMove} onPointerDown={onDown} onPointerLeave={() => setHovered(null)} />;
}

/** Camera position that frames a set of points from a given direction, without snapping to axes. */
function framePoints(points: THREE.Vector3[], azimuth: number, polar: number, fovDeg: number, aspect: number, margin: number, heightFraction = 1) {
	const dir = new THREE.Vector3().setFromSphericalCoords(1, polar, azimuth);
	const forward = dir.clone().negate();
	const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
	const up = new THREE.Vector3().crossVectors(right, forward).normalize();
	const centre = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
	let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity, maxD = -Infinity;
	const p = new THREE.Vector3();
	for (const q of points) {
		p.copy(q).sub(centre);
		const r = p.dot(right);
		const u = p.dot(up);
		minR = Math.min(minR, r);
		maxR = Math.max(maxR, r);
		minU = Math.min(minU, u);
		maxU = Math.max(maxU, u);
		maxD = Math.max(maxD, p.dot(dir));
	}
	const target = centre.clone().addScaledVector(right, (minR + maxR) / 2).addScaledVector(up, (minU + maxU) / 2);
	const tan = Math.tan(((fovDeg / 2) * Math.PI) / 180) * heightFraction;
	const halfW = ((maxR - minR) / 2) * margin;
	const halfH = ((maxU - minU) / 2) * margin;
	const dist = Math.max(halfH / tan, halfW / (tan * aspect)) + maxD;
	return { position: target.clone().addScaledVector(dir, dist), target, distance: dist };
}

function CameraRig({ shared }: { shared: MutableRefObject<Shared> }) {
	const ref = useRef<CameraControls>(null);
	const view = useWatch((s) => s.view);
	const exploded = useWatch((s) => s.explode > 0.5);
	const { size } = useThree();
	const portrait = size.height > size.width * 1.1;
	useEffect(() => {
		if (import.meta.env.DEV) (window as unknown as { __lwCam: CameraControls | null }).__lwCam = ref.current;
	}, []);
	useEffect(() => {
		const c = ref.current;
		if (!c) return;
		if (exploded && shared.current.explodedPoints) {
			const e = EXPLODED[`${view}${portrait ? 'Portrait' : ''}` as keyof typeof EXPLODED];
			const cam = c.camera as THREE.PerspectiveCamera;
			// Frame the stack in the space the overlays leave free.
			const padTop = portrait ? 120 : 118;
			const padBottom = portrait ? 280 : 128;
			const freeH = Math.max(200, size.height - padTop - padBottom);
			const { position, target, distance } = framePoints(shared.current.explodedPoints, e.azimuth, e.polar, cam.fov, size.width / freeH, 1.03, freeH / size.height);
			const animate = !reducedMotion();
			void c.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, animate);
			const worldPerPx = (2 * distance * Math.tan(((cam.fov / 2) * Math.PI) / 180)) / size.height;
			void c.setFocalOffset(0, ((padBottom - padTop) / 2) * worldPerPx, 0, animate);
			return;
		}
		const p = VIEWS[view];
		const fit = portrait ? 1.45 : 1;
		const animate = !reducedMotion();
		void c.setFocalOffset(0, portrait ? -6 : 0, 0, animate);
		void c.setLookAt(p.pos[0] * fit, p.pos[1] * fit, p.pos[2] * fit, p.target[0], p.target[1], p.target[2], animate);
	}, [view, exploded, portrait, shared, size.width, size.height]);
	return (
		<CameraControls
			ref={ref}
			makeDefault
			minDistance={45}
			maxDistance={700}
			smoothTime={0.55}
			draggingSmoothTime={0.12}
			dollySpeed={0.6}
		/>
	);
}

/** Embedded on another page: a fixed product shot that leans gently towards the pointer. */
export const EMBED_VIEW = { pos: [16, -10, 148] as const, target: [0, 4, 0] as const };

function EmbedCamera({ pointerActive }: { pointerActive?: MutableRefObject<boolean> }) {
	const { camera, pointer } = useThree();
	const aim = useMemo(() => new THREE.Vector3(), []);
	const target = useMemo(() => new THREE.Vector3(...EMBED_VIEW.target), []);
	useEffect(() => {
		camera.position.set(...EMBED_VIEW.pos);
		camera.lookAt(target);
	}, [camera, target]);
	useFrame((_, dt) => {
		const on = pointerActive?.current && !reducedMotion();
		aim.set(EMBED_VIEW.pos[0] + (on ? pointer.x * 22 : 0), EMBED_VIEW.pos[1] + (on ? pointer.y * 14 : 0), EMBED_VIEW.pos[2]);
		camera.position.lerp(aim, 1 - Math.exp(-3 * Math.min(dt, 0.1)));
		camera.lookAt(target);
	});
	return null;
}

function Lights() {
	return (
		<>
			<Environment resolution={256} frames={1} environmentIntensity={1}>
				<color attach="background" args={['#4a423a']} />
				{/* Soft box overhead, strip lights either side, a ring light behind the camera. */}
				<Lightformer form="rect" intensity={3.2} position={[0, 70, 60]} scale={[140, 40, 1]} target={[0, 0, 0]} />
				<Lightformer form="ring" intensity={1.4} position={[0, 0, 140]} scale={70} target={[0, 0, 0]} />
				<Lightformer form="rect" intensity={2.4} position={[-110, 10, 40]} scale={[24, 120, 1]} target={[0, 0, 0]} />
				<Lightformer form="rect" intensity={2.0} position={[110, -10, 40]} scale={[24, 120, 1]} target={[0, 0, 0]} />
				<Lightformer form="rect" intensity={0.9} color="#ffdcae" position={[0, -90, 50]} scale={[140, 26, 1]} target={[0, 0, 0]} />
				<Lightformer form="rect" intensity={2.2} position={[30, 40, -130]} scale={[120, 70, 1]} target={[0, 0, 0]} />
				<Lightformer form="rect" intensity={1.2} position={[-60, -50, -110]} scale={[80, 40, 1]} target={[0, 0, 0]} />
				<Lightformer form="rect" intensity={1.6} position={[140, 60, 0]} scale={[30, 120, 1]} target={[0, 0, 0]} />
				<Lightformer form="rect" intensity={1.3} position={[-140, 40, -10]} scale={[30, 120, 1]} target={[0, 0, 0]} />
				<Lightformer form="rect" intensity={0.8} color="#fff4e6" position={[0, -140, -20]} scale={[160, 60, 1]} target={[0, 0, 0]} />
				<Lightformer form="circle" intensity={1.1} position={[90, 110, 90]} scale={30} target={[0, 0, 0]} />
			</Environment>
			<ambientLight intensity={0.08} />
			<directionalLight
				castShadow
				position={[-28, 48, 110]}
				intensity={1.1}
				shadow-mapSize={[2048, 2048]}
				shadow-bias={-0.0004}
				shadow-normalBias={0.02}
				shadow-camera-left={-26}
				shadow-camera-right={26}
				shadow-camera-top={34}
				shadow-camera-bottom={-26}
				shadow-camera-near={60}
				shadow-camera-far={200}
			/>
		</>
	);
}

export default function WatchCanvas({
	shared,
	config,
	mode = 'full',
	onReady,
	pointerActive,
}: {
	shared: MutableRefObject<Shared>;
	config: ResolvedConfig;
	/** 'embed' is a non-interactive product shot for other pages. */
	mode?: 'full' | 'embed';
	onReady?: () => void;
	pointerActive?: MutableRefObject<boolean>;
}) {
	const embed = mode === 'embed';
	const [dpr, setDpr] = useState(embed ? 1.5 : 1.75);
	const [ao, setAo] = useState(true);
	const containerRef = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(true);
	const quality = useMemo<'high' | 'low'>(() => {
		if (typeof navigator === 'undefined') return 'high';
		const mobile = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent);
		return mobile ? 'low' : 'high';
	}, []);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px' });
		io.observe(el);
		return () => io.disconnect();
	}, []);

	return (
		<div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
			<Canvas
				frameloop={visible ? 'always' : 'never'}
				dpr={[1, dpr]}
				shadows="percentage"
				gl={{ antialias: false, powerPreference: 'high-performance', toneMapping: THREE.NeutralToneMapping }}
				camera={{ fov: 24, near: 2, far: 3000, position: embed ? [...EMBED_VIEW.pos] : [14, -10, 168] }}
				style={embed ? { touchAction: 'auto' } : undefined}
			>
				<color attach="background" args={[BG]} />
				<PerformanceMonitor
					onDecline={() => {
						setDpr(1);
						setAo(false);
					}}
					flipflops={2}
				/>
				<Lights />
				<Watch shared={shared} config={config} quality={quality} interactive={!embed} onReady={onReady} />
				{embed ? <EmbedCamera pointerActive={pointerActive} /> : <CameraRig shared={shared} />}
				<EffectComposer multisampling={0}>
					<N8AO enabled={ao} aoRadius={1.6} distanceFalloff={1.2} intensity={2.2} quality={quality === 'high' ? 'medium' : 'performance'} halfRes={quality !== 'high'} />
					<ToneMapping mode={ToneMappingMode.NEUTRAL} />
					<Vignette offset={0.32} darkness={0.32} />
					<SMAA />
				</EffectComposer>
			</Canvas>
		</div>
	);
}

