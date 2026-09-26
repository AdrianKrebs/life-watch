import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { gearOutline, wheelShape, type WheelSpec } from '../geometry/gear';
import { extrude, latheZ } from '../geometry/shapes';
import type { Vec2 } from '../geometry/sdf';
import { addRadialTangents, type Materials } from '../materials';

export type Mats = Materials;

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], shadow = false) {
	const m = new THREE.Mesh(geo, mat);
	m.castShadow = shadow;
	m.receiveShadow = shadow;
	return m;
}

/** Extruded slab between z0 and z1 (z0 < z1), caps and sides with separate materials. */
export function slab(
	shapes: THREE.Shape | THREE.Shape[],
	z0: number,
	z1: number,
	cap: THREE.Material,
	side: THREE.Material = cap,
	opts: { bevel?: number; curveSegments?: number; radialTangents?: boolean; smooth?: boolean; uv?: { ox: number; oy: number; size: number } } = {},
) {
	let geo: THREE.BufferGeometry = extrude(shapes, {
		depth: z1 - z0,
		bevel: opts.bevel ?? Math.min(0.07, (z1 - z0) * 0.22),
		bevelSegments: 1,
		curveSegments: opts.curveSegments ?? 8,
		uv: opts.uv,
	});
	if (opts.smooth !== false) geo = toCreasedNormals(geo, Math.PI / 5);
	if (opts.radialTangents) addRadialTangents(geo);
	geo.translate(0, 0, z0);
	return mesh(geo, [cap, side]);
}

export function polyShape(pts: Vec2[]) {
	return new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
}

export function discShape(r: number, holes: [number, number, number][] = []) {
	const s = new THREE.Shape();
	s.absarc(0, 0, r, 0, Math.PI * 2, false);
	for (const [x, y, hr] of holes) {
		const h = new THREE.Path();
		h.absarc(x, y, hr, 0, Math.PI * 2, true);
		s.holes.push(h);
	}
	return s;
}

export function ringShape(rOuter: number, rInner: number) {
	return discShape(rOuter, [[0, 0, rInner]]);
}

/** Wheel with crossings, gilt with circular graining; its arbor rotates the group. */
export function wheel(M: Mats, spec: WheelSpec, z0: number, thickness: number) {
	const shape = wheelShape({ bore: 0, ...spec });
	return slab(shape, z0, z0 + thickness, M.gilt, M.giltPolished, {
		bevel: Math.min(0.035, spec.module * 0.22),
		radialTangents: true,
		curveSegments: 4,
	});
}

/** Pinion: polished steel leaves (always the smaller gear in a watch train). */
export function pinion(M: Mats, teeth: number, module: number, mate: number, z0: number, length: number) {
	const outline = gearOutline({ teeth, module, mate, pinion: true }, 5);
	return slab(polyShape(outline), z0, z0 + length, M.steel, M.steel, { bevel: Math.min(0.03, module * 0.2), curveSegments: 3 });
}

/** Arbor with conical pivots, along z from z0 to z1. */
export function arbor(M: Mats, r: number, z0: number, z1: number) {
	const len = z1 - z0;
	const pivotR = Math.max(0.06, r * 0.35);
	const cone = Math.min(0.35, len * 0.12);
	const profile: [number, number][] = [
		[0, 0],
		[pivotR, 0],
		[pivotR, cone * 0.8],
		[r, cone * 1.6],
		[r, len - cone * 1.6],
		[pivotR, len - cone * 0.8],
		[pivotR, len],
		[0, len],
	];
	const geo = latheZ(profile, 20);
	geo.translate(0, 0, z0);
	return mesh(geo, M.steel);
}

/**
 * Jewel bearing: a domed ruby with its oil sink, optionally set in a
 * polished gold chaton held by two screws. `facing` is +1 when the jewel
 * is seen from the dial side, -1 from the back.
 */
export function jewel(M: Mats, x: number, y: number, z: number, facing: 1 | -1, r = 0.55, chaton = false) {
	const g = new THREE.Group();
	g.position.set(x, y, z);
	const rubyProfile: [number, number][] = [
		[r * 0.18, 0],
		[r, 0],
		[r, 0.08],
		[r * 0.86, 0.16],
		[r * 0.5, 0.2],
		[r * 0.26, 0.12],
		[r * 0.18, 0.08],
	];
	const rg = latheZ(rubyProfile, 28);
	const ruby = mesh(rg, M.ruby);
	g.add(ruby);
	if (chaton) {
		const cr = r * 1.75;
		const cg = latheZ(
			[
				[r * 0.98, 0.02],
				[cr, 0.02],
				[cr, 0.1],
				[cr * 0.94, 0.16],
				[r * 1.02, 0.14],
			],
			36,
		);
		g.add(mesh(cg, M.goldSatin));
		for (const a of [0.35, Math.PI + 0.35]) {
			const s = screw(M, cr * 1.35 * Math.cos(a), cr * 1.35 * Math.sin(a), 0, 1, r * 0.55);
			g.add(s);
		}
	}
	if (facing < 0) g.rotation.x = Math.PI;
	return g;
}

/** Heat-blued screw head with a slot, seated at z facing ±z. */
export function screw(M: Mats, x: number, y: number, z: number, facing: 1 | -1, r = 0.75, blued = true) {
	const g = new THREE.Group();
	g.position.set(x, y, z);
	const h = r * 0.55;
	const head = latheZ(
		[
			[0, 0],
			[r, 0],
			[r, h * 0.45],
			[r * 0.9, h * 0.8],
			[r * 0.55, h],
			[0, h],
		],
		32,
	);
	g.add(mesh(head, blued ? M.blued : M.steel));
	const slot = new THREE.BoxGeometry(r * 2.05, r * 0.22, h * 0.75);
	slot.translate(0, 0, h * 0.72);
	const sm = mesh(slot, M.steelDark);
	sm.rotation.z = (x * 7.3 + y * 3.1) % Math.PI; // screws never line up in real life
	g.add(sm);
	if (facing < 0) g.rotation.x = Math.PI;
	return g;
}

/** Simple lathed pipe (hand pipes, cannon pinion, stems). */
export function pipe(M: THREE.Material, rOuter: number, rInner: number, z0: number, z1: number, segments = 32) {
	const geo = latheZ(
		[
			[rInner, 0],
			[rOuter, 0],
			[rOuter, z1 - z0],
			[rInner, z1 - z0],
		],
		segments,
	);
	geo.translate(0, 0, z0);
	return mesh(geo, M);
}

/**
 * Hairspring: a flat Archimedean ribbon whose coils breathe with the balance.
 * The inner end turns with the balance while the outer end is pinned at the
 * stud; the extra winding is shared along the length and the coils contract
 * or expand accordingly (after Ciechanowski's and Eisenegger's models).
 */
export class Hairspring {
	readonly mesh: THREE.Mesh;
	private readonly positions: Float32Array;
	private readonly normals: Float32Array;
	private readonly segments: number;
	private readonly turns: number;
	private readonly r0: number;
	private readonly pitch: number;
	private readonly thickness: number;
	private readonly height: number;
	private readonly studAngle: number;
	private readonly length: number;
	private last = NaN;

	constructor(material: THREE.Material, opts: { turns?: number; r0?: number; pitch?: number; thickness?: number; height?: number; studAngle?: number } = {}) {
		this.turns = opts.turns ?? 12.5;
		this.r0 = opts.r0 ?? 0.72;
		this.pitch = opts.pitch ?? 0.2;
		this.thickness = opts.thickness ?? 0.05;
		this.height = opts.height ?? 0.16;
		this.studAngle = opts.studAngle ?? 0;
		this.segments = Math.round(this.turns * 96);
		const Theta = this.turns * Math.PI * 2;
		this.length = Theta * (this.r0 + (this.pitch * this.turns) / 2);

		const n = this.segments + 1;
		// Four vertices per ring (inner-top, outer-top, outer-bottom, inner-bottom), duplicated per face for crisp normals.
		const verts = n * 8;
		this.positions = new Float32Array(verts * 3);
		this.normals = new Float32Array(verts * 3);
		const index: number[] = [];
		for (let i = 0; i < this.segments; i++) {
			for (let f = 0; f < 4; f++) {
				const a = (i * 4 + f) * 2;
				const b = ((i + 1) * 4 + f) * 2;
				index.push(a, b, a + 1, a + 1, b, b + 1);
			}
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));
		geo.setIndex(index);
		this.mesh = new THREE.Mesh(geo, material);
		this.mesh.frustumCulled = false;
		this.update(0);
	}

	/** phi: balance angle in radians. */
	update(phi: number) {
		if (phi === this.last) return;
		this.last = phi;
		const { segments, turns, r0, pitch, thickness: t, height: h } = this;
		const Theta = turns * Math.PI * 2;
		// The collet end turns with the balance; a CCW swing unwinds this CCW-outward spiral.
		const span = Theta - phi;
		const P = this.positions;
		const N = this.normals;
		const faces: [number, number, number, number, number, number][] = [
			// [radial offset a, z a, radial offset b, z b, normal radial, normal z]
			[-t / 2, h, t / 2, h, 0, 1], // top
			[t / 2, h, t / 2, 0, 1, 0], // outer
			[t / 2, 0, -t / 2, 0, 0, -1], // bottom
			[-t / 2, 0, -t / 2, h, -1, 0], // inner
		];
		for (let i = 0; i <= segments; i++) {
			const u = i / segments;
			const theta = this.studAngle - span * (1 - u);
			const rl = r0 + pitch * turns * u;
			const r = rl + ((rl * rl * phi) / this.length) * Math.sin(Math.PI * u) * 0.9;
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			for (let f = 0; f < 4; f++) {
				const [ra, za, rb, zb, nr, nz] = faces[f];
				const k = (i * 4 + f) * 2 * 3;
				P[k] = (r + ra) * c;
				P[k + 1] = (r + ra) * s;
				P[k + 2] = za;
				P[k + 3] = (r + rb) * c;
				P[k + 4] = (r + rb) * s;
				P[k + 5] = zb;
				N[k] = N[k + 3] = nr * c;
				N[k + 1] = N[k + 4] = nr * s;
				N[k + 2] = N[k + 5] = nz;
			}
		}
		const geo = this.mesh.geometry;
		geo.getAttribute('position').needsUpdate = true;
		geo.getAttribute('normal').needsUpdate = true;
	}
}

/** Tube along a polyline (springs, levers' fine wire parts). */
export function tube(M: THREE.Material, pts: [number, number, number][], r: number, closed = false) {
	const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed);
	return mesh(new THREE.TubeGeometry(curve, Math.max(16, pts.length * 8), r, 10, closed), M);
}
