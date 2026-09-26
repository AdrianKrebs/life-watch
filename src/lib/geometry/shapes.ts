import * as THREE from 'three';
import { area, contour, type SDF, type Vec2 } from './sdf';

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function pointInLoop(p: Vec2, loop: Vec2[]) {
	let inside = false;
	for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
		const [xi, yi] = loop[i];
		const [xj, yj] = loop[j];
		if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

/** Turn closed loops (CCW solids, CW holes) into THREE shapes with holes. */
export function loopsToShapes(loops: Vec2[][]): THREE.Shape[] {
	const outers = loops.filter((l) => area(l) > 0).map((l) => ({ loop: l, a: area(l), holes: [] as Vec2[][] }));
	const holes = loops.filter((l) => area(l) < 0);
	for (const h of holes) {
		let best: (typeof outers)[number] | undefined;
		for (const o of outers) {
			if (pointInLoop(h[0], o.loop) && (!best || o.a < best.a)) best = o;
		}
		best?.holes.push(h);
	}
	return outers.map(({ loop, holes }) => {
		const shape = new THREE.Shape(loop.map(([x, y]) => new THREE.Vector2(x, y)));
		for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
		return shape;
	});
}

export function sdfShapes(f: SDF, bounds: Bounds, step = 0.05) {
	return loopsToShapes(contour(f, bounds, step));
}

export function circlePath(cx: number, cy: number, r: number, clockwise = true, segments = 48) {
	const pts: THREE.Vector2[] = [];
	for (let i = 0; i < segments; i++) {
		const a = ((clockwise ? -1 : 1) * i * Math.PI * 2) / segments;
		pts.push(new THREE.Vector2(cx + r * Math.cos(a), cy + r * Math.sin(a)));
	}
	return pts;
}

export function addCircleHoles(shapes: THREE.Shape[], holes: [number, number, number][]) {
	for (const [x, y, r] of holes) {
		const target = shapes.find((s) => pointInLoop([x, y], s.getPoints().map((p) => [p.x, p.y])));
		(target ?? shapes[0])?.holes.push(new THREE.Path(circlePath(x, y, r, true, Math.max(16, Math.round(r * 40)))));
	}
	return shapes;
}

export interface ExtrudeOpts {
	depth: number;
	bevel?: number;
	bevelSegments?: number;
	curveSegments?: number;
	/** Map UVs from plane coordinates: u = (x - ox) / size, v = (y - oy) / size. */
	uv?: { ox: number; oy: number; size: number };
}

/**
 * Extrude shapes along +z, from z = 0 to z = depth, bevelled on both
 * faces (the polished "anglage" of watch parts). Group 0 = caps, group 1 =
 * sides and bevels, so parts can have a finished face and polished edges.
 */
export function extrude(shapes: THREE.Shape | THREE.Shape[], opts: ExtrudeOpts) {
	const bevel = opts.bevel ?? Math.min(0.08, opts.depth * 0.25);
	const geo = new THREE.ExtrudeGeometry(shapes, {
		depth: Math.max(0.001, opts.depth - bevel * 2),
		bevelEnabled: bevel > 0,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelOffset: -bevel,
		bevelSegments: opts.bevelSegments ?? 2,
		curveSegments: opts.curveSegments ?? 6,
	});
	geo.translate(0, 0, bevel);
	const uv = opts.uv ?? { ox: -20, oy: -20, size: 40 };
	const pos = geo.getAttribute('position');
	const uvs = geo.getAttribute('uv');
	for (let i = 0; i < pos.count; i++) {
		uvs.setXY(i, (pos.getX(i) - uv.ox) / uv.size, (pos.getY(i) - uv.oy) / uv.size);
	}
	uvs.needsUpdate = true;
	geo.computeBoundingSphere();
	return geo;
}

/** Lathe a (radius, z) profile around the z axis (three's lathe spins around y). */
export function latheZ(profile: [number, number][], segments = 96, phiStart = 0, phiLength = Math.PI * 2) {
	const geo = new THREE.LatheGeometry(
		profile.map(([r, z]) => new THREE.Vector2(r, z)),
		segments,
		phiStart,
		phiLength,
	);
	geo.rotateX(Math.PI / 2);
	return geo;
}
