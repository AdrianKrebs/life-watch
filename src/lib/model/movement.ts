import * as THREE from 'three';
import { crossingHoles, escapeWheelOutline, gearOutline } from '../geometry/gear';
import { box, capsule, circle, smoothSubtract, smoothUnion, subtract, union, type SDF, type Vec2 } from '../geometry/sdf';
import { addCircleHoles, latheZ, sdfShapes } from '../geometry/shapes';
import { BEATS_PER_TURN, MOVEMENT_R, TRAIN, Z } from '../layout';
import { addRadialTangents } from '../materials';
import { turns } from '../time';
import { arbor, discShape, Hairspring, jewel, mesh, pinion, polyShape, screw, slab, wheel, type Mats } from './builders';
import type { ResolvedConfig } from '../config';
import { meshPhase, type Part } from './part';

const TAU = Math.PI * 2;
const dir = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);

function engraving(lines: { text: string; size: number; y: number; weight?: number; spacing?: number }[], w: number, h: number, color = '#d9b45c') {
	const px = 90;
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(w * px);
	canvas.height = Math.round(h * px);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = color;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	for (const l of lines) {
		ctx.font = `${l.weight ?? 600} ${l.size * px}px "Source Serif 4", Georgia, serif`;
		(ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${(l.spacing ?? 0) * px}px`;
		ctx.fillText(l.text, canvas.width / 2, (h / 2 - l.y) * px);
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 8;
	return tex;
}

/** A decal plane lying on a surface, readable from the given side. */
export function decal(tex: THREE.Texture, w: number, h: number, x: number, y: number, z: number, facing: 1 | -1, rotation = 0, metal = true) {
	const geo = new THREE.PlaneGeometry(w, h);
	const mat = new THREE.MeshPhysicalMaterial({
		map: tex,
		transparent: true,
		metalness: metal ? 1 : 0,
		roughness: metal ? 0.28 : 0.6,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -2,
	});
	const m = new THREE.Mesh(geo, mat);
	m.position.set(x, y, z);
	m.rotation.z = rotation;
	if (facing < 0) m.rotation.y = Math.PI;
	m.renderOrder = 2;
	return m;
}

/** Pillar from the main plate up to the underside of a bridge. */
function pillar(M: Mats, x: number, y: number, r: number, zTop: number) {
	const geo = latheZ(
		[
			[0, 0],
			[r, 0],
			[r, Z.mainPlateBack - zTop],
			[0, Z.mainPlateBack - zTop],
		],
		24,
	);
	geo.rotateX(Math.PI);
	geo.translate(x, y, Z.mainPlateBack);
	return mesh(geo, M.anglage);
}

export function buildMovement(M: Mats, config: ResolvedConfig) {
	const parts: Part[] = [];
	const add = (p: Part) => {
		parts.push(p);
		return p;
	};
	const { barrel: B, centre: C, third: T3, fourth: F4, escape: E, pallet: PF, balance: BAL } = TRAIN;

	// ---------------------------------------------------------------- main plate
	{
		const holes: [number, number, number][] = [
			[0, 0, 0.5],
			[F4.x, F4.y, 0.35],
			[-8.2, 0, 0.3],
			[8.2, 0, 0.3],
		];
		const shape = discShape(MOVEMENT_R, holes);
		// Pocket for the days drums of the life counter, under the barrel.
		const pocket = new THREE.Path();
		pocket.moveTo(-2.1, 4.4);
		pocket.lineTo(-2.1, 8.0);
		pocket.lineTo(2.1, 8.0);
		pocket.lineTo(2.1, 4.4);
		pocket.closePath();
		shape.holes.push(pocket);
		const m = slab(shape, Z.mainPlateBack, Z.mainPlateFront, M.plate, M.anglage, { bevel: 0.12, curveSegments: 40 });
		const g = new THREE.Group();
		g.add(m);
		// Jewels for the lower pivots, visible from the back where no bridge covers them.
		g.add(jewel(M, BAL.x, BAL.y, Z.mainPlateBack, -1, 0.5));
		g.add(jewel(M, PF.x, PF.y, Z.mainPlateBack, -1, 0.38));
		g.add(jewel(M, E.x, E.y, Z.mainPlateBack, -1, 0.4));
		add({ id: 'mainPlate', name: 'Main plate', info: 'The foundation every other part is built on, decorated with perlage.', group: 'plate', layer: 0, object: g });
	}

	// ---------------------------------------------------------------- barrel
	{
		const teethZ0 = -5.0;
		const drum = new THREE.Group();
		drum.position.set(B.x, B.y, 0);
		const R = (B.module * B.teeth) / 2;
		const ringShape = polyShape(gearOutline({ teeth: B.teeth, module: B.module, mate: C.pinion }));
		const hole = new THREE.Path();
		hole.absarc(0, 0, R - 0.55, 0, TAU, true);
		ringShape.holes.push(hole);
		const teeth = slab(ringShape, teethZ0, -4.62, M.gilt, M.giltPolished, { radialTangents: true, curveSegments: 20 });
		drum.add(teeth);
		const wallR = R - 0.4;
		const cup = latheZ(
			[
				[0.95, -4.62],
				[wallR, -4.62],
				[wallR, -7.62],
				[wallR - 0.28, -7.62],
				[wallR - 0.28, -4.85],
				[0.95, -4.85],
			],
			96,
		);
		drum.add(mesh(cup, [M.giltPolished]));
		const drumPart = add({
			id: 'barrel',
			name: 'Barrel',
			info: 'Holds the mainspring. 96 teeth drive the centre pinion; it turns once every eight hours.',
			group: 'train',
			layer: -1.3,
			object: drum,
		});
		drumPart.update = ({ state }) => {
			drum.rotation.z = TAU * turns(state.trainBeats, BEATS_PER_TURN.barrel);
		};

		// Mainspring: a coiled ribbon, visible once the barrel cover lifts.
		const spring = new Hairspring(M.steel, { turns: 7.5, r0: 1.75, pitch: (wallR - 0.45 - 1.75) / 7.5, thickness: 0.13, height: 2.5 });
		spring.mesh.position.set(B.x, B.y, -7.45);
		const springPart = add({
			id: 'mainspring',
			name: 'Mainspring',
			info: 'A coiled strip of Nivaflex alloy, the watch’s only source of energy. About 50 hours when fully wound.',
			group: 'train',
			layer: -2.3,
			object: spring.mesh,
		});
		springPart.update = ({ state }) => {
			spring.mesh.rotation.z = TAU * turns(state.trainBeats, BEATS_PER_TURN.barrel);
		};

		const coverShape = discShape(wallR - 0.02, [[0, 0, 0.75]]);
		const cover = slab(coverShape, -7.8, -7.62, M.gilt, M.giltPolished, { radialTangents: true, curveSegments: 40 });
		const coverG = new THREE.Group();
		coverG.position.set(B.x, B.y, 0);
		coverG.add(cover);
		const coverPart = add({
			id: 'barrelCover',
			name: 'Barrel cover',
			info: 'Snaps into the barrel drum and closes it over the spring.',
			group: 'train',
			layer: -3.1,
			object: coverG,
		});
		coverPart.update = ({ state }) => {
			coverG.rotation.z = TAU * turns(state.trainBeats, BEATS_PER_TURN.barrel);
		};

		const arborG = new THREE.Group();
		arborG.position.set(B.x, B.y, 0);
		arborG.add(arbor(M, 0.9, Z.mainPlateBack - 0.05, -10.05));
		add({ id: 'barrelArbor', name: 'Barrel arbor', info: 'Stays still while running; winding turns it to coil the mainspring.', group: 'train', layer: -2.0, object: arborG });
	}

	// ---------------------------------------------------------------- going train
	const gBC = dir(B, C);
	const gC3 = dir(C, T3);
	const g34 = dir(T3, F4);
	const g4E = dir(F4, E);

	const centre = new THREE.Group();
	{
		centre.position.set(C.x, C.y, 0);
		const w = wheel(M, { teeth: C.teeth, module: C.module, mate: T3.pinion, spokes: 5, sweep: 0.0 }, -8.1, 0.2);
		centre.add(w);
		const p = pinion(M, C.pinion, C.pinionModule, B.teeth, -5.05, 0.5);
		p.rotation.z = meshPhase(0, B.teeth, C.pinion, gBC); // barrel drives the centre pinion
		centre.add(p);
		centre.add(arbor(M, 0.28, Z.mainPlateFront + 0.6, Z.bridgesBack - 0.05));
		const part = add({
			id: 'centreWheel',
			name: 'Centre wheel',
			info: 'Turns once an hour and carries the minute hand through the cannon pinion. 80 teeth.',
			group: 'train',
			layer: -2.4,
			object: centre,
		});
		part.update = ({ state }) => {
			centre.rotation.z = -TAU * turns(state.trainBeats, BEATS_PER_TURN.centre);
		};
	}

	{
		const g = new THREE.Group();
		g.position.set(T3.x, T3.y, 0);
		g.add(wheel(M, { teeth: T3.teeth, module: T3.module, mate: F4.pinion, spokes: 5 }, -7.0, 0.18));
		const p = pinion(M, T3.pinion, T3.pinionModule, C.teeth, -8.22, 0.44);
		p.rotation.z = meshPhase(0, C.teeth, T3.pinion, gC3);
		g.add(p);
		g.add(arbor(M, 0.22, Z.mainPlateBack - 0.05, Z.bridgesBack - 0.05));
		const part = add({ id: 'thirdWheel', name: 'Third wheel', info: '60 teeth, one turn every 7½ minutes.', group: 'train', layer: -2.0, object: g });
		part.update = ({ state }) => {
			g.rotation.z = TAU * turns(state.trainBeats, BEATS_PER_TURN.third);
		};
	}

	{
		const g = new THREE.Group();
		g.position.set(F4.x, F4.y, 0);
		g.add(wheel(M, { teeth: F4.teeth, module: F4.module, mate: E.pinion, spokes: 6 }, -6.1, 0.17));
		const p = pinion(M, F4.pinion, F4.pinionModule, T3.teeth, -7.12, 0.42);
		p.rotation.z = meshPhase(0, T3.teeth, F4.pinion, g34);
		g.add(p);
		// The fourth arbor reaches through the plate and the dial for the seconds hand.
		g.add(arbor(M, 0.2, 0.3, Z.bridgesBack - 0.05));
		const part = add({
			id: 'fourthWheel',
			name: 'Fourth wheel',
			info: 'Turns once a minute; its arbor carries the small seconds hand. Steps 1/5 s at every beat.',
			group: 'train',
			layer: -1.2,
			object: g,
		});
		part.update = ({ state }) => {
			g.rotation.z = -TAU * turns(state.trainBeats, BEATS_PER_TURN.fourth);
		};
	}

	// ---------------------------------------------------------------- escapement
	const lineOfCentres = TRAIN.lineOfCentres;
	{
		const g = new THREE.Group();
		g.position.set(E.x, E.y, 0);
		const outline = escapeWheelOutline(E.teeth, E.radius);
		const shape = polyShape(outline);
		for (const h of crossingHoles({ spokes: 5, rimInner: E.radius * 0.6, hub: 0.55, width: 0.2, sweep: 0.85 })) {
			shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
		}
		const w = slab(shape, -7.62, -7.47, M.steel, M.steel, { bevel: 0.025, radialTangents: true, curveSegments: 3 });
		// Lock a tooth on the entry pallet after every even beat (see time.ts).
		w.rotation.z = lineOfCentres - Math.PI / 6;
		g.add(w);
		const p = pinion(M, E.pinion, E.pinionModule, F4.teeth, -6.16, 0.3);
		p.rotation.z = meshPhase(0, F4.teeth, E.pinion, g4E);
		g.add(p);
		g.add(arbor(M, 0.16, Z.mainPlateBack - 0.05, Z.bridgesBack - 0.05));
		const part = add({
			id: 'escapeWheel',
			name: 'Escape wheel',
			info: '15 club teeth. Released twice per oscillation, it advances 12° a beat and turns every six seconds.',
			group: 'escapement',
			layer: -1.7,
			object: g,
		});
		part.update = ({ state }) => {
			g.rotation.z = TAU * turns(state.trainBeats, BEATS_PER_TURN.escape);
		};
	}

	{
		// Pallet fork, drawn in its own frame: +x points from the arbor to the balance.
		const L = Math.hypot(BAL.x - PF.x, BAL.y - PF.y) - TRAIN.impulseRadius;
		const lockR = E.radius;
		const eX = -E.radius / Math.cos(Math.PI / 6); // escape wheel centre in the fork frame
		const locks: Vec2[] = [
			[eX + lockR * Math.cos(Math.PI / 6), lockR * Math.sin(Math.PI / 6)],
			[eX + lockR * Math.cos(-Math.PI / 6), lockR * Math.sin(-Math.PI / 6)],
		];
		const stoneDirs = [Math.PI / 6, -Math.PI / 6];
		const body: SDF = smoothUnion(
			0.25,
			circle(0, 0, 0.4),
			capsule(0, 0, L - 0.25, 0, 0.2, 0.16),
			// Fork horns around the slot for the impulse pin.
			capsule(L - 0.35, 0.2, L + 0.3, 0.34, 0.1),
			capsule(L - 0.35, -0.2, L + 0.3, -0.34, 0.1),
			// Pallet arms carrying the stones.
			...locks.map(([x, y], i) => capsule(0, 0, x + Math.cos(stoneDirs[i]) * 0.7, y + Math.sin(stoneDirs[i]) * 0.7, 0.26)),
		);
		const slot = box(L + 0.05, 0, 0.35, 0.13);
		const fork = subtract(body, slot, ...locks.map(([x, y], i) => box(x + Math.cos(stoneDirs[i]) * 0.3, y + Math.sin(stoneDirs[i]) * 0.3, 0.46, 0.17, stoneDirs[i])));
		const shapes = sdfShapes(fork, { minX: -2.5, minY: -2.5, maxX: L + 0.6, maxY: 2.5 }, 0.02);
		const g = new THREE.Group();
		g.position.set(PF.x, PF.y, 0);
		const inner = new THREE.Group();
		g.add(inner);
		inner.add(slab(shapes, -7.72, -7.5, M.steel, M.anglage, { bevel: 0.03 }));
		// Guard pin (dart): on the fork's face above the slot, at the safety roller's level.
		const dart = sdfShapes(capsule(L - 0.55, 0, L + 0.27, 0, 0.06, 0.035), { minX: L - 0.8, minY: -0.3, maxX: L + 0.5, maxY: 0.3 }, 0.01);
		inner.add(slab(dart, -7.5, -7.41, M.steel, M.steel, { bevel: 0.01 }));
		// Pallet stones: radial to the wheel, both leaning with their outer end
		// ahead in the wheel's travel (draw), the locked tooth's corner on the
		// locking face, and a slanted impulse face on the working end.
		const stoneShape = polyShape([
			[-0.45, -0.15],
			[0.45, -0.15],
			[0.45, 0.15],
			[-0.28, 0.15],
		]);
		for (let i = 0; i < 2; i++) {
			const [x, y] = locks[i];
			const a = stoneDirs[i];
			const t: Vec2 = [-Math.sin(a), Math.cos(a)]; // wheel travel at the lock
			const stone = slab(stoneShape, -7.69, -7.43, M.ruby, M.ruby, { bevel: 0.02, smooth: false });
			stone.position.set(x + Math.cos(a) * 0.56 + t[0] * 0.15, y + Math.sin(a) * 0.56 + t[1] * 0.15, 0);
			stone.rotation.z = a + 0.2;
			inner.add(stone);
		}
		g.add(arbor(M, 0.14, Z.mainPlateBack - 0.05, -8.1));
		const part = add({
			id: 'palletFork',
			name: 'Pallet fork',
			info: 'Rocks 10¼° bank to bank. Its ruby pallets lock and release the escape wheel; its fork passes impulse to the balance.',
			group: 'escapement',
			layer: -2.8,
			object: g,
		});
		part.update = ({ state }) => {
			inner.rotation.z = lineOfCentres + state.fork;
		};
	}

	// ---------------------------------------------------------------- balance
	// The balance cock reaches out towards 4–5 o'clock; the regulator pins sit opposite.
	const cockDir = (-55 * Math.PI) / 180;
	const springTurns = 12.5;
	const springR0 = 0.72;
	const springPitch = 0.205;
	const springOuter = springR0 + springPitch * springTurns;
	const hairspring = new Hairspring(M.steelDark, {
		turns: springTurns,
		r0: springR0,
		pitch: springPitch,
		thickness: 0.05,
		height: 0.15,
		studAngle: cockDir + Math.PI + 0.35,
	});
	{
		const g = new THREE.Group();
		g.position.set(BAL.x, BAL.y, 0);
		const rot = new THREE.Group();
		g.add(rot);
		const R = BAL.radius;
		const rimW = 0.5;
		const armShape: SDF = union(
			(x, y) => Math.abs(Math.hypot(x, y) - (R - rimW / 2)) - rimW / 2,
			capsule(-(R - 0.2), 0, R - 0.2, 0, 0.3),
			circle(0, 0, 0.75),
		);
		const rimShapes = sdfShapes(armShape, { minX: -R, minY: -R, maxX: R, maxY: R }, 0.03);
		addCircleHoles(rimShapes, [[0, 0, 0.18]]);
		// Rim taller than the arms, as on a real balance.
		const arms = slab(rimShapes, -8.45, -8.25, M.gilt, M.giltPolished, { bevel: 0.04, radialTangents: true });
		rot.add(arms);
		const rimGeo = latheZ(
			[
				[R - rimW, -8.7],
				[R, -8.7],
				[R, -8.1],
				[R - rimW, -8.1],
				[R - rimW, -8.7],
			],
			128,
		);
		addRadialTangents(rimGeo);
		rot.add(mesh(rimGeo, M.giltPolished));
		// Timing screws around the rim, pairs of gold with steel mean-time screws on the arm axis.
		const nScrews = 18;
		for (let i = 0; i < nScrews; i++) {
			const a = (i / nScrews) * TAU + Math.PI / nScrews;
			const meanTime = [0, 8, 9, 17].includes(i); // pairs flanking each arm
			const sg = new THREE.Group();
			const head = latheZ(
				[
					[0, 0],
					[0.36, 0],
					[0.36, 0.22],
					[0.22, 0.34],
					[0, 0.36],
				],
				16,
			);
			sg.add(mesh(head, meanTime ? M.steel : M.gold));
			sg.rotation.y = Math.PI / 2; // screw axis radial
			const holder = new THREE.Group();
			holder.add(sg);
			sg.position.set(R, 0, 0);
			holder.rotation.z = a;
			holder.position.z = -8.4;
			rot.add(holder);
		}
		// Double roller. The impulse roller sits behind the fork and its ruby pin
		// reaches up into the slot; the safety roller, in front at the dart's
		// level, has a crescent that lets the dart pass only while the pin is in the slot.
		const pinAngle = lineOfCentres + Math.PI;
		const roller = latheZ(
			[
				[0.12, -7.92],
				[1.0, -7.92],
				[1.0, -7.8],
				[0.12, -7.8],
			],
			32,
		);
		rot.add(mesh(roller, M.steel));
		const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.38, 12), M.ruby);
		pin.rotation.x = Math.PI / 2;
		pin.position.set(TRAIN.impulseRadius * Math.cos(pinAngle), TRAIN.impulseRadius * Math.sin(pinAngle), -7.73);
		rot.add(pin);
		const safetySdf = subtract(circle(0, 0, 0.52), circle(0.62 * Math.cos(pinAngle), 0.62 * Math.sin(pinAngle), 0.22), circle(0, 0, 0.12));
		rot.add(slab(sdfShapes(safetySdf, { minX: -0.6, minY: -0.6, maxX: 0.6, maxY: 0.6 }, 0.01), -7.5, -7.4, M.steel, M.steel, { bevel: 0.01 }));
		rot.add(arbor(M, 0.2, Z.mainPlateBack - 0.05, Z.cockBack + 0.05));
		// Hairspring collet.
		const collet = latheZ(
			[
				[0.2, -9.02],
				[0.62, -9.02],
				[0.62, -8.82],
				[0.2, -8.82],
			],
			20,
		);
		rot.add(mesh(collet, M.steel));
		const part = add({
			id: 'balance',
			name: 'Balance wheel',
			info: 'Swings about 280° each way, 2.5 times a second. Gold timing screws on the rim set its inertia.',
			group: 'balance',
			layer: -4.4,
			object: g,
		});
		part.update = ({ state }) => {
			rot.rotation.z = state.balance;
		};
	}
	{
		const g = new THREE.Group();
		g.position.set(BAL.x, BAL.y, -9.0);
		g.add(hairspring.mesh);
		const part = add({
			id: 'hairspring',
			name: 'Hairspring',
			info: 'Twelve and a half coils of Nivarox, thinner than a hair. It breathes with every swing and sets the rate.',
			group: 'balance',
			layer: -5.1,
			object: g,
		});
		part.update = ({ state }) => hairspring.update(state.balance);
	}

	// ---------------------------------------------------------------- bridges
	// Classic Swiss bridges drawn as smooth unions: bosses around every pivot
	// and screw, arms between them, fillets everywhere, clearance cut round
	// the balance and between neighbouring bridges.
	const barrelHead = 6.8;
	const barrelFeet: Vec2[] = [
		[-14.0, 9.3],
		[-8.8, 15.3],
		[6.8, 13.8],
	];
	const lobe: [Vec2, Vec2] = [
		[-6.0, 10.6],
		[-13.0, 8.4],
	];
	// Crown wheel on the ratchet's module (56 teeth on r 6): 16 teeth, r 1.71.
	const ratchetModule = 12 / 56;
	const crownWheel = { x: 0, y: 0, r: (16 * ratchetModule) / 2, teeth: 16 };
	{
		const d = 6 + crownWheel.r;
		const a = (83 * Math.PI) / 180;
		crownWheel.x = B.x + d * Math.cos(a);
		crownWheel.y = B.y + d * Math.sin(a);
	}
	const barrelBridgeSdf: SDF = smoothUnion(
		1.8,
		circle(B.x, B.y, barrelHead),
		capsule(...lobe[0], ...lobe[1], 3.3, 2.6),
		...barrelFeet.map(([x, y]) => circle(x, y, 1.55)),
		capsule(B.x, B.y, ...barrelFeet[1], 2.4, 1.3),
		capsule(B.x, B.y, ...barrelFeet[2], 2.2, 1.3),
		circle(crownWheel.x, crownWheel.y, 1.8),
		capsule(B.x, B.y, crownWheel.x, crownWheel.y, 1.9),
	);
	const barrelBridgeClip: SDF = (x, y) => Math.max(barrelBridgeSdf(x, y), Math.hypot(x, y) - (MOVEMENT_R - 0.15));

	const trainFeet: Vec2[] = [
		[-7.9, -9.0],
		[-6.4, 0.6],
		[-1.5, -14.3],
	];
	const trainBridgeSdf: SDF = smoothSubtract(
		0.9,
		smoothSubtract(
			0.8,
			smoothUnion(
				1.5,
				circle(C.x, C.y, 1.9),
				circle(T3.x, T3.y, 1.75),
				circle(F4.x, F4.y, 1.9),
				circle(E.x, E.y, 1.5),
				capsule(C.x, C.y, T3.x, T3.y, 1.55),
				capsule(T3.x, T3.y, F4.x, F4.y, 1.6),
				capsule(F4.x, F4.y, E.x, E.y, 1.25),
				capsule(T3.x, T3.y, ...trainFeet[0], 1.5, 1.35),
				capsule(C.x, C.y, ...trainFeet[1], 1.4, 1.35),
				capsule(F4.x, F4.y, ...trainFeet[2], 1.45, 1.35),
				...trainFeet.map(([x, y]) => circle(x, y, 1.5)),
			),
			circle(B.x, B.y, barrelHead + 0.4),
		),
		circle(BAL.x, BAL.y, BAL.radius + 0.55),
	);

	const bridgeBounds = { minX: -MOVEMENT_R, minY: -MOVEMENT_R, maxX: MOVEMENT_R, maxY: MOVEMENT_R };
	{
		const shapes = sdfShapes(barrelBridgeClip, bridgeBounds, 0.05);
		const g = new THREE.Group();
		g.add(slab(shapes, Z.bridgesBack, Z.bridgesFront, M.rhodium, M.anglage, { bevel: 0.14, curveSegments: 4 }));
		for (const [x, y] of barrelFeet) g.add(pillar(M, x, y, 0.8, Z.bridgesFront));
		const tex = engraving(
			[
				{ text: config.engraving[0], size: Math.min(0.9, 9 / Math.max(1, config.engraving[0].length)), y: 0.5, spacing: 0.24 },
				{ text: config.engraving[1], size: Math.min(0.42, 12 / Math.max(1, config.engraving[1].length)), y: -0.45, weight: 400, spacing: 0.06 },
			],
			7,
			2.2,
		);
		// Along the bridge's lobe, reading correctly from the back.
		const mid: Vec2 = [(lobe[0][0] + lobe[1][0]) / 2 - 0.4, (lobe[0][1] + lobe[1][1]) / 2 + 0.05];
		const along = Math.atan2(lobe[1][1] - lobe[0][1], -(lobe[1][0] - lobe[0][0]));
		g.add(decal(tex, 7, 2.2, mid[0], mid[1], Z.bridgesBack - 0.005, -1, along));
		add({
			id: 'barrelBridge',
			name: 'Barrel bridge',
			info: 'Holds the barrel arbor and the winding wheels. Côtes de Genève on top, polished bevels on the edges.',
			group: 'bridges',
			layer: -6.0,
			object: g,
		});
	}
	{
		const shapes = sdfShapes(trainBridgeSdf, bridgeBounds, 0.05);
		const g = new THREE.Group();
		g.add(slab(shapes, Z.bridgesBack, Z.bridgesFront, M.rhodium, M.anglage, { bevel: 0.14, curveSegments: 4 }));
		for (const [x, y] of trainFeet) g.add(pillar(M, x, y, 0.75, Z.bridgesFront));
		g.add(jewel(M, C.x, C.y, Z.bridgesBack, -1, 0.5, true));
		g.add(jewel(M, T3.x, T3.y, Z.bridgesBack, -1, 0.45, true));
		g.add(jewel(M, F4.x, F4.y, Z.bridgesBack, -1, 0.45, true));
		g.add(jewel(M, E.x, E.y, Z.bridgesBack, -1, 0.4));
		add({
			id: 'trainBridge',
			name: 'Train bridge',
			info: 'Upper pivots of the centre, third, fourth and escape wheels; the first three rubies sit in screwed gold chatons.',
			group: 'bridges',
			layer: -6.0,
			object: g,
		});
	}
	{
		const foot: Vec2 = [4.4, -14.6];
		const sdf = smoothUnion(0.6, circle(PF.x, PF.y, 1.0), circle(...foot, 1.2), capsule(PF.x, PF.y, ...foot, 0.75, 0.95));
		const shapes = sdfShapes(sdf, bridgeBounds, 0.04);
		const g = new THREE.Group();
		g.add(slab(shapes, -8.05, -7.8, M.rhodium, M.anglage, { bevel: 0.06 }));
		g.add(pillar(M, ...foot, 0.7, -7.8));
		g.add(jewel(M, PF.x, PF.y, -8.05, -1, 0.36));
		add({ id: 'palletCock', name: 'Pallet cock', info: 'Holds the pallet fork’s upper pivot, beneath the balance.', group: 'escapement', layer: -3.5, object: g });
		add({ id: 'palletCockScrew', name: 'Screw', info: 'Heat-blued steel screw.', group: 'escapement', layer: -3.9, object: screw(M, ...foot, -8.05, -1, 0.62) });
	}

	// Bridge screws lift off first when the watch comes apart.
	for (const [x, y] of [...barrelFeet, ...trainFeet]) {
		add({ id: `bridgeScrew${x}${y}`, name: 'Bridge screw', info: 'Heat-blued at about 290 °C until the oxide film turns cornflower blue.', group: 'bridges', layer: -6.8, object: screw(M, x, y, Z.bridgesBack, -1, 0.85) });
	}

	// ---------------------------------------------------------------- winding wheels on the barrel bridge
	{
		const R = 6.0;
		const n = 56;
		const pts: Vec2[] = [];
		for (let i = 0; i < n; i++) {
			const a = (i / n) * TAU;
			const b = ((i + 0.75) / n) * TAU;
			pts.push([R * Math.cos(a), R * Math.sin(a)]);
			pts.push([(R - 0.32) * Math.cos(b), (R - 0.32) * Math.sin(b)]);
		}
		const shape = polyShape(pts);
		const sq = new THREE.Path([new THREE.Vector2(-0.55, -0.55), new THREE.Vector2(-0.55, 0.55), new THREE.Vector2(0.55, 0.55), new THREE.Vector2(0.55, -0.55)]);
		shape.holes.push(sq);
		const g = new THREE.Group();
		g.position.set(B.x, B.y, 0);
		const m = slab(shape, -10.0, Z.bridgesBack - 0.02, M.steel, M.anglage, { bevel: 0.05 });
		// Sunray finish: tangential anisotropy.
		const geo = m.geometry;
		const pos = geo.getAttribute('position');
		const t = new Float32Array(pos.count * 4);
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const y = pos.getY(i);
			const l = Math.hypot(x, y) || 1;
			t[i * 4] = -y / l;
			t[i * 4 + 1] = x / l;
			t[i * 4 + 3] = 1;
		}
		geo.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
		m.material = [M.steelSunray, M.anglage];
		g.add(m);
		g.add(screw(M, 0, 0, -10.0, -1, 1.25, false));
		add({ id: 'ratchet', name: 'Ratchet wheel', info: 'Sits on the barrel arbor’s square; winding the crown turns it. Sunray finish.', group: 'keyless', layer: -7.2, object: g });

		const cw = new THREE.Group();
		cw.position.set(crownWheel.x, crownWheel.y, 0);
		const cwShape = polyShape(gearOutline({ teeth: crownWheel.teeth, module: ratchetModule, mate: n }));
		const cwm = slab(cwShape, -10.0, Z.bridgesBack - 0.02, M.steelSunray, M.anglage, { bevel: 0.05 });
		cw.add(cwm);
		cw.add(screw(M, 0, 0, -10.0, -1, 0.7, false));
		add({ id: 'crownWheel', name: 'Crown wheel', info: 'Takes the winding from the stem to the ratchet wheel. Held by a left-handed screw.', group: 'keyless', layer: -7.2, object: cw });

		// Click and its spring stop the ratchet from running back.
		// Pivoted so the ratchet's load pulls the pawl in and winding lifts it out.
		const clickSdf = smoothUnion(0.3, circle(-8.8, 8.35, 0.55), capsule(-8.8, 8.35, -7.2, 7.2, 0.35, 0.18));
		const clickShapes = sdfShapes(clickSdf, bridgeBounds, 0.03);
		const clickG = new THREE.Group();
		clickG.add(slab(clickShapes, -9.95, Z.bridgesBack - 0.02, M.steel, M.anglage, { bevel: 0.04 }));
		clickG.add(screw(M, -8.8, 8.35, -9.95, -1, 0.45));
		add({ id: 'click', name: 'Click', info: 'A sprung pawl on the ratchet wheel: you can wind, but the spring can’t unwind backwards.', group: 'keyless', layer: -7.2, object: clickG });
	}

	// ---------------------------------------------------------------- balance cock with regulator
	{
		const footDir = cockDir;
		// Foot outside the rim and its timing screws, inside the movement's edge.
		const foot: Vec2 = [BAL.x + 7.8 * Math.cos(footDir), BAL.y + 7.8 * Math.sin(footDir)];
		const cockSdf = smoothUnion(0.9, circle(BAL.x, BAL.y, 2.0), capsule(BAL.x, BAL.y, ...foot, 1.15, 1.25), circle(...foot, 1.3));
		const shapes = sdfShapes(cockSdf, bridgeBounds, 0.04);
		const g = new THREE.Group();
		g.add(slab(shapes, Z.cockBack, -9.2, M.rhodium, M.anglage, { bevel: 0.13 }));
		// Foot pillar down to the plate.
		const pillar = latheZ(
			[
				[0, 0],
				[0.9, 0],
				[0.9, 4.8],
				[0, 4.8],
			],
			36,
		);
		pillar.translate(foot[0], foot[1], -9.2);
		g.add(mesh(pillar, M.anglage));
		g.add(jewel(M, BAL.x, BAL.y, Z.cockBack, -1, 0.55, true));
		// Engraved regulator scale: A (avance) and R (retard), like the Czapek demonstration movement.
		const scaleTex = engraving(
			[
				{ text: 'R                 A', size: 0.9, y: 0.35, weight: 600 },
				{ text: '|  |  |  |  |  |  |  |  |', size: 0.5, y: -0.5, weight: 400 },
			],
			4.2,
			2.2,
			'#1d1d24',
		);
		const along = footDir;
		const scalePos: Vec2 = [BAL.x + 4.9 * Math.cos(along), BAL.y + 4.9 * Math.sin(along)];
		// The decal is mirrored to face the back, so its rotation is too.
		g.add(decal(scaleTex, 3.4, 1.8, scalePos[0], scalePos[1], Z.cockBack - 0.005, -1, -(along + Math.PI / 2), false));

		// Regulator index: a long needle over the scale and two pins at the hairspring.
		const indexSdf = smoothUnion(
			0.25,
			(x, y) => Math.abs(Math.hypot(x, y) - 0.95) - 0.22,
			capsule(0.9, 0, 5.1, 0, 0.2, 0.05),
			capsule(-0.9, 0, -springOuter - 0.25, 0, 0.26, 0.2),
		);
		const indexShapes = sdfShapes(indexSdf, { minX: -3.8, minY: -1.4, maxX: 5.4, maxY: 1.4 }, 0.02);
		const idx = new THREE.Group();
		idx.position.set(BAL.x, BAL.y, 0);
		idx.rotation.z = along;
		idx.add(slab(indexShapes, Z.cockBack - 0.12, Z.cockBack - 0.01, M.steel, M.anglage, { bevel: 0.02 }));
		// Regulator pins either side of the outer coil.
		for (const r of [springOuter - 0.075, springOuter + 0.075]) {
			const pinG = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.3, 8), M.steel);
			pinG.rotation.x = Math.PI / 2;
			pinG.position.set(-r, 0, -9.6);
			idx.add(pinG);
		}
		g.add(idx);
		add({
			id: 'balanceCock',
			name: 'Balance cock',
			info: 'Carries the balance’s upper pivot under a cap jewel, and the regulator: nudge the index towards A to gain, R to lose.',
			group: 'cock',
			layer: -8.3,
			object: g,
		});
		add({ id: 'cockScrew', name: 'Cock screw', info: 'Heat-blued steel screw.', group: 'cock', layer: -9.0, object: screw(M, ...foot, Z.cockBack, -1, 0.8) });
	}

	return { parts, hairspring };
}

