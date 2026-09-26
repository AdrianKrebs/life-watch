import * as THREE from 'three';
import { capsule, circle, contour, smoothUnion, type SDF, type Vec2 } from './sdf';
import { circlePath } from './shapes';

// Horological gearing: cycloidal teeth rather than involutes.
//
// The wheel's addendum is an epicycloid traced by a circle half the size of
// the mating pinion rolling on the wheel's pitch circle; the same circle
// rolling inside the pinion traces a straight radial flank, which is why
// watch pinion leaves have radial sides and rounded tips. Tips are
// truncated where the two flanks meet, giving the "ogival" wheel tooth.

export interface ToothSpec {
	teeth: number;
	module: number;
	/** Teeth of the mating gear; sets the generating circle of the addendum. */
	mate: number;
	/** Pinions have narrow leaves with round tips. */
	pinion?: boolean;
	addendum?: number; // in modules
	dedendum?: number; // in modules
	thickness?: number; // tooth thickness at the pitch circle, in modules
}

const P = (r: number, a: number): Vec2 => [r * Math.cos(a), r * Math.sin(a)];

function epicycloid(R: number, rho: number, t: number): Vec2 {
	const k = (R + rho) / rho;
	return [(R + rho) * Math.cos(t) - rho * Math.cos(k * t), (R + rho) * Math.sin(t) - rho * Math.sin(k * t)];
}

export function toothDims(spec: ToothSpec) {
	const pinion = spec.pinion ?? spec.teeth < 16;
	const m = spec.module;
	const R = (m * spec.teeth) / 2;
	return {
		pinion,
		R,
		Ra: R + (spec.addendum ?? (pinion ? 0.9 : 1.35)) * m,
		Rr: R - (spec.dedendum ?? (pinion ? 1.7 : 1.55)) * m,
		thick: (spec.thickness ?? (pinion ? 1.05 : Math.PI / 2)) * m,
	};
}

/** Right flank of one tooth centred on angle 0 (negative-angle side), root → tip. */
function flankPoints(spec: ToothSpec, steps: number): Vec2[] {
	const { pinion, R, Ra, Rr, thick } = toothDims(spec);
	const half = thick / 2 / R;
	const flank: Vec2[] = [P(Rr, -half)];
	if (pinion) {
		// Radial flank, then a semicircular tip.
		const tipCentre = Ra / (1 + Math.sin(half));
		const tipR = Ra - tipCentre;
		for (let i = 0; i <= steps; i++) {
			const phi = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
			const lx = tipCentre + tipR * Math.cos(phi);
			const ly = tipR * Math.sin(phi);
			flank.push(P(Math.hypot(lx, ly), Math.atan2(ly, lx)));
		}
		return flank;
	}
	// Radial dedendum up to the pitch circle, then the epicycloidal addendum.
	flank.push(P(R, -half));
	const rho = (spec.module * spec.mate) / 4;
	let prev = flank[flank.length - 1];
	for (let i = 1; i <= steps * 4; i++) {
		const t = (i / (steps * 4)) * 1.5;
		const [ex, ey] = epicycloid(R, rho, t);
		const r = Math.hypot(ex, ey);
		const a = Math.atan2(ey, ex) - half;
		if (a >= 0 || r >= Ra) {
			// Clip against the tip circle or the tooth's centre line.
			const pr = Math.hypot(prev[0], prev[1]);
			const pa = Math.atan2(prev[1], prev[0]);
			const fr = r >= Ra ? (Ra - pr) / (r - pr) : 1;
			const fa = a >= 0 ? -pa / (a - pa) : 1;
			const f = Math.min(fr, fa);
			const rr = pr + (r - pr) * f;
			const aa = Math.min(0, pa + (a - pa) * f);
			flank.push(P(rr, aa));
			if (aa < -1e-4) flank.push(P(rr, 0)); // flat on the tip circle
			break;
		}
		flank.push(P(r, a));
		prev = flank[flank.length - 1];
	}
	return flank;
}

/** Outline of a gear (closed loop, CCW) with cycloidal teeth. */
export function gearOutline(spec: ToothSpec, steps = 6): Vec2[] {
	const { R, Rr, thick } = toothDims(spec);
	const half = thick / 2 / R;
	const pitch = (Math.PI * 2) / spec.teeth;
	const flank = flankPoints(spec, steps);
	const out: Vec2[] = [];
	const rootSteps = 3;
	for (let k = 0; k < spec.teeth; k++) {
		const base = k * pitch;
		const c = Math.cos(base);
		const s = Math.sin(base);
		const rot = ([x, y]: Vec2): Vec2 => [x * c - y * s, x * s + y * c];
		// Root arc between the previous tooth and this one.
		for (let i = 1; i < rootSteps; i++) out.push(P(Rr, base - pitch + half + ((pitch - 2 * half) * i) / rootSteps));
		for (const p of flank) out.push(rot(p));
		for (let i = flank.length - 1; i >= 0; i--) {
			const [x, y] = flank[i];
			if (Math.abs(y) < 1e-6 && i === flank.length - 1) continue; // shared apex
			out.push(rot([x, -y]));
		}
	}
	return dedupe(out);
}

function dedupe(pts: Vec2[]) {
	return pts.filter((p, i) => {
		const q = pts[(i + 1) % pts.length];
		return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-5;
	});
}

export interface CrossingSpec {
	/** Number of crossings (spokes). */
	spokes: number;
	rimInner: number;
	hub: number;
	width: number;
	/** Sideways sweep of each spoke in radians (curved arms). */
	sweep?: number;
}

const holeCache = new Map<string, Vec2[][]>();

/** Windows between the spokes, contoured from a distance field so every corner gets a fillet. */
export function crossingHoles({ spokes, rimInner, hub, width, sweep = 0 }: CrossingSpec): Vec2[][] {
	const key = [spokes, rimInner, hub, width, sweep].map((v) => v.toFixed(3)).join(':');
	const cached = holeCache.get(key);
	if (cached) return cached;

	const arms: SDF[] = [];
	for (let i = 0; i < spokes; i++) {
		const a = (i / spokes) * Math.PI * 2 + Math.PI / 2;
		if (sweep === 0) {
			arms.push(capsule(0, 0, ...P(rimInner + width, a), width / 2));
			continue;
		}
		// Curved arm: a quadratic Bézier from the hub to the rim, as a chain of capsules.
		const p0 = P(hub * 0.5, a);
		const p2 = P(rimInner + width, a + sweep);
		const p1 = P(rimInner * 0.62, a + sweep * 0.1);
		const n = 8;
		let last = p0;
		for (let j = 1; j <= n; j++) {
			const t = j / n;
			const q: Vec2 = [
				(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
				(1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
			];
			arms.push(capsule(last[0], last[1], q[0], q[1], (width / 2) * (1.15 - 0.3 * t)));
			last = q;
		}
	}
	const solid = smoothUnion(Math.min(0.3, width * 0.9), ...arms, circle(0, 0, hub), (x, y) => rimInner - Math.hypot(x, y));
	const windows: SDF = (x, y) => -solid(x, y);
	const loops = contour(windows, { minX: -rimInner, minY: -rimInner, maxX: rimInner, maxY: rimInner }, Math.max(0.02, rimInner / 120));
	// Contours come out counter-clockwise around the windows; holes need clockwise.
	const holes = loops.map((l) => l.slice().reverse());
	holeCache.set(key, holes);
	return holes;
}

export interface WheelSpec extends ToothSpec {
	spokes?: number;
	rim?: number;
	hub?: number;
	spokeWidth?: number;
	sweep?: number;
	bore?: number;
}

/** A wheel with rim, hub and crossings between the spokes. */
export function wheelShape(spec: WheelSpec): THREE.Shape {
	const shape = new THREE.Shape(gearOutline(spec).map(([x, y]) => new THREE.Vector2(x, y)));
	const { R, Rr } = toothDims(spec);
	if (spec.spokes) {
		const holes = crossingHoles({
			spokes: spec.spokes,
			rimInner: Rr - (spec.rim ?? Math.max(0.32, R * 0.09)),
			hub: spec.hub ?? Math.max(0.6, R * 0.17),
			width: spec.spokeWidth ?? Math.max(0.24, R * 0.075),
			sweep: spec.sweep,
		});
		for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
	}
	if (spec.bore) shape.holes.push(new THREE.Path(circlePath(0, 0, spec.bore)));
	return shape;
}

/** Star wheel for the calendar: pointed teeth for fingers and jumpers. */
export function starOutline(teeth: number, rOuter: number, depth: number): Vec2[] {
	const pts: Vec2[] = [];
	const pitch = (Math.PI * 2) / teeth;
	const ri = rOuter - depth;
	for (let i = 0; i < teeth; i++) {
		const a = i * pitch + Math.PI / 2;
		pts.push(P(ri, a - pitch / 2));
		pts.push(P(ri + depth * 0.12, a - pitch * 0.36));
		pts.push(P(rOuter - depth * 0.08, a - pitch * 0.06));
		pts.push(P(rOuter, a));
		pts.push(P(rOuter - depth * 0.08, a + pitch * 0.06));
		pts.push(P(ri + depth * 0.12, a + pitch * 0.36));
	}
	return pts;
}

/**
 * Club-tooth escape wheel (Swiss lever). The wheel turns counter-clockwise
 * seen from the dial, so the teeth lean that way: a locking face undercut
 * by the draw angle, a slanted impulse face on the club, and a long
 * concave back.
 */
export function escapeWheelOutline(teeth: number, R: number): Vec2[] {
	const pitch = (Math.PI * 2) / teeth;
	const root = R * 0.72;
	const tooth: [number, number][] = [
		// [angle offset in pitches, radius factor], CCW
		[-0.64, 0.72],
		[-0.5, 0.77],
		[-0.38, 0.85],
		[-0.28, 0.92],
		[-0.2, 0.958], // heel of the club
		[-0.1, 0.978],
		[0, 1], // locking corner
		[-0.035, 0.955],
		[-0.075, 0.905], // locking face, undercut for draw
		[-0.04, 0.84],
		[0.04, 0.78],
		[0.2, 0.73],
	];
	const pts: Vec2[] = [];
	for (let i = 0; i < teeth; i++) {
		const a0 = i * pitch;
		for (const [da, rf] of tooth) pts.push(P(rf === 0.72 ? root : R * rf, a0 + da * pitch));
	}
	return pts;
}
