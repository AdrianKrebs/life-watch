// Tiny 2D signed-distance toolkit for drawing bridges, levers and hands.
//
// Watch bridges are organic: circles around every pivot and screw, joined
// by arms, with smooth concave fillets between them. Describing them as a
// smooth union of simple distance fields and contouring the result gives
// those fillets for free, instead of hand-drawing every curve.

export type Vec2 = [number, number];
export type SDF = (x: number, y: number) => number;

export const circle =
	(cx: number, cy: number, r: number): SDF =>
	(x, y) =>
		Math.hypot(x - cx, y - cy) - r;

export const ring =
	(cx: number, cy: number, r: number, width: number): SDF =>
	(x, y) =>
		Math.abs(Math.hypot(x - cx, y - cy) - r) - width / 2;

/** Capsule between two points with radius r (optionally tapering to r2). */
export const capsule = (ax: number, ay: number, bx: number, by: number, r: number, r2 = r): SDF => {
	const dx = bx - ax;
	const dy = by - ay;
	const len2 = dx * dx + dy * dy;
	return (x, y) => {
		const px = x - ax;
		const py = y - ay;
		const h = Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
		return Math.hypot(px - dx * h, py - dy * h) - (r + (r2 - r) * h);
	};
};

export const box =
	(cx: number, cy: number, hw: number, hh: number, angle = 0, round = 0): SDF =>
	(x, y) => {
		const c = Math.cos(-angle);
		const s = Math.sin(-angle);
		const lx = (x - cx) * c - (y - cy) * s;
		const ly = (x - cx) * s + (y - cy) * c;
		const qx = Math.abs(lx) - hw + round;
		const qy = Math.abs(ly) - hh + round;
		return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - round;
	};

/** Arc band: part of a ring between two angles, with round ends. */
export const arc = (cx: number, cy: number, r: number, a0: number, a1: number, width: number): SDF => {
	const mid = (a0 + a1) / 2;
	const half = Math.abs(a1 - a0) / 2;
	return (x, y) => {
		let a = Math.atan2(y - cy, x - cx) - mid;
		a = Math.atan2(Math.sin(a), Math.cos(a));
		if (Math.abs(a) <= half) return Math.abs(Math.hypot(x - cx, y - cy) - r) - width / 2;
		const e = mid + Math.sign(a) * half;
		return Math.hypot(x - cx - r * Math.cos(e), y - cy - r * Math.sin(e)) - width / 2;
	};
};

export const union =
	(...fs: SDF[]): SDF =>
	(x, y) => {
		let d = Infinity;
		for (const f of fs) d = Math.min(d, f(x, y));
		return d;
	};

/** Polynomial smooth minimum: union with a fillet of radius ~k. */
export const smoothUnion =
	(k: number, ...fs: SDF[]): SDF =>
	(x, y) => {
		let d = fs[0](x, y);
		for (let i = 1; i < fs.length; i++) {
			const b = fs[i](x, y);
			const h = Math.max(k - Math.abs(d - b), 0) / k;
			d = Math.min(d, b) - h * h * k * 0.25;
		}
		return d;
	};

export const subtract =
	(a: SDF, ...bs: SDF[]): SDF =>
	(x, y) => {
		let d = a(x, y);
		for (const b of bs) d = Math.max(d, -b(x, y));
		return d;
	};

export const smoothSubtract =
	(k: number, a: SDF, b: SDF): SDF =>
	(x, y) => {
		const d1 = a(x, y);
		const d2 = -b(x, y);
		const h = Math.max(k - Math.abs(d1 - d2), 0) / k;
		return Math.max(d1, d2) + h * h * k * 0.25;
	};

export const intersect =
	(...fs: SDF[]): SDF =>
	(x, y) => {
		let d = -Infinity;
		for (const f of fs) d = Math.max(d, f(x, y));
		return d;
	};

export const offset =
	(f: SDF, r: number): SDF =>
	(x, y) =>
		f(x, y) - r;

/**
 * Contour an SDF at zero with marching squares, returning closed loops:
 * counter-clockwise around solids (negative inside), clockwise around holes.
 */
export function contour(
	f: SDF,
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	step = 0.06,
): Vec2[][] {
	const minX = bounds.minX - step * 2;
	const minY = bounds.minY - step * 2;
	const nx = Math.ceil((bounds.maxX - minX + step * 2) / step) + 1;
	const ny = Math.ceil((bounds.maxY - minY + step * 2) / step) + 1;
	const v = new Float64Array(nx * ny);
	for (let j = 0; j < ny; j++) {
		const y = minY + j * step;
		for (let i = 0; i < nx; i++) v[j * nx + i] = f(minX + i * step, y);
	}

	// Edge ids: horizontal edge (i,j)-(i+1,j) = 2*(j*nx+i), vertical = +1.
	const point = (edge: number): Vec2 => {
		const idx = edge >> 1;
		const i = idx % nx;
		const j = (idx / nx) | 0;
		const a = v[idx];
		if (edge & 1) {
			const b = v[idx + nx];
			const t = a / (a - b);
			return [minX + i * step, minY + (j + t) * step];
		}
		const b = v[idx + 1];
		const t = a / (a - b);
		return [minX + (i + t) * step, minY + j * step];
	};

	const next = new Map<number, number>();
	for (let j = 0; j < ny - 1; j++) {
		for (let i = 0; i < nx - 1; i++) {
			const i0 = j * nx + i;
			const a = v[i0] < 0 ? 1 : 0; // bottom-left
			const b = v[i0 + 1] < 0 ? 1 : 0; // bottom-right
			const c = v[i0 + nx + 1] < 0 ? 1 : 0; // top-right
			const d = v[i0 + nx] < 0 ? 1 : 0; // top-left
			const code = a | (b << 1) | (c << 2) | (d << 3);
			if (code === 0 || code === 15) continue;
			const bottom = 2 * i0;
			const right = 2 * (i0 + 1) + 1;
			const top = 2 * (i0 + nx);
			const left = 2 * i0 + 1;
			// Segments are emitted clockwise around solids; loops get reversed below.
			const add = (from: number, to: number) => next.set(from, to);
			switch (code) {
				case 1: add(left, bottom); break;
				case 2: add(bottom, right); break;
				case 3: add(left, right); break;
				case 4: add(right, top); break;
				case 5: {
					const centre = (v[i0] + v[i0 + 1] + v[i0 + nx] + v[i0 + nx + 1]) / 4;
					if (centre < 0) { add(left, top); add(right, bottom); }
					else { add(left, bottom); add(right, top); }
					break;
				}
				case 6: add(bottom, top); break;
				case 7: add(left, top); break;
				case 8: add(top, left); break;
				case 9: add(top, bottom); break;
				case 10: {
					const centre = (v[i0] + v[i0 + 1] + v[i0 + nx] + v[i0 + nx + 1]) / 4;
					if (centre < 0) { add(bottom, left); add(top, right); }
					else { add(bottom, right); add(top, left); }
					break;
				}
				case 11: add(top, right); break;
				case 12: add(right, left); break;
				case 13: add(right, bottom); break;
				case 14: add(bottom, left); break;
			}
		}
	}

	const loops: Vec2[][] = [];
	const seen = new Set<number>();
	for (const start of next.keys()) {
		if (seen.has(start)) continue;
		const loop: Vec2[] = [];
		let e: number | undefined = start;
		while (e !== undefined && !seen.has(e)) {
			seen.add(e);
			loop.push(point(e));
			e = next.get(e);
		}
		if (loop.length > 2) loops.push(simplify(loop.reverse(), step * 0.08));
	}
	return loops;
}

/** Signed area; positive for counter-clockwise loops. */
export function area(loop: Vec2[]) {
	let a = 0;
	for (let i = 0, n = loop.length; i < n; i++) {
		const [x1, y1] = loop[i];
		const [x2, y2] = loop[(i + 1) % n];
		a += x1 * y2 - x2 * y1;
	}
	return a / 2;
}

/** Closed-polyline Douglas–Peucker simplification. */
export function simplify(loop: Vec2[], tolerance: number): Vec2[] {
	if (loop.length < 8) return loop;
	const keep = new Uint8Array(loop.length);
	const rec = (a: number, b: number) => {
		const [ax, ay] = loop[a];
		const [bx, by] = loop[b];
		const dx = bx - ax;
		const dy = by - ay;
		const len = Math.hypot(dx, dy) || 1e-9;
		let best = -1;
		let bestD = tolerance;
		for (let i = a + 1; i < b; i++) {
			const d = Math.abs((loop[i][0] - ax) * dy - (loop[i][1] - ay) * dx) / len;
			if (d > bestD) {
				bestD = d;
				best = i;
			}
		}
		if (best >= 0) {
			keep[best] = 1;
			rec(a, best);
			rec(best, b);
		}
	};
	const mid = loop.length >> 1;
	keep[0] = keep[mid] = keep[loop.length - 1] = 1;
	rec(0, mid);
	rec(mid, loop.length - 1);
	return loop.filter((_, i) => keep[i]);
}
