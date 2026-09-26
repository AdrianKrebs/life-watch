import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { drawCasebackRing, drawMeander } from '../dial';
import { latheZ } from '../geometry/shapes';
import type { ResolvedConfig } from '../config';
import { mesh, pinion, type Mats } from './builders';
import type { Part } from './part';

const TAU = Math.PI * 2;
const STEM_Z = -4.2;

function lathe(profile: [number, number][], mat: THREE.Material | THREE.Material[], segments = 160, crease = 38) {
	let geo: THREE.BufferGeometry = latheZ(profile, segments);
	geo = toCreasedNormals(geo, (crease * Math.PI) / 180);
	return mesh(geo, mat);
}

/** A thin lathed band following a profile segment, lifted along its normal. */
function band(a: [number, number], b: [number, number], lift: number, mat: THREE.Material, segments = 256) {
	const dx = b[0] - a[0];
	const dz = b[1] - a[1];
	const l = Math.hypot(dx, dz);
	const nx = dz / l;
	const nz = -dx / l;
	const s = Math.sign(nz) || 1;
	const p: [number, number][] = [
		[a[0] + nx * lift * s, a[1] + nz * lift * s],
		[b[0] + nx * lift * s, b[1] + nz * lift * s],
	];
	const geo = latheZ(p, segments);
	return mesh(geo, mat);
}

export function buildCase(M: Mats, config: ResolvedConfig) {
	const parts: Part[] = [];
	const add = (p: Part) => {
		parts.push(p);
		return p;
	};

	const meander = drawMeander(config.enamel);
	const enamelBand = new THREE.MeshPhysicalMaterial({
		map: meander,
		alphaTest: 0.5,
		metalness: 0,
		roughness: 0.25,
		clearcoat: 1,
		clearcoatRoughness: 0.03,
		side: THREE.DoubleSide,
		name: 'champleve',
	});

	// ---------------------------------------------------------------- crystal
	{
		const rim = 19.3;
		const sag = 1.8;
		const Rs = (rim * rim + sag * sag) / (2 * sag);
		const apex = 4.35;
		const profile: [number, number][] = [];
		for (let i = 0; i <= 28; i++) {
			const r = (i / 28) * rim;
			profile.push([r, apex - (Rs - Math.sqrt(Rs * Rs - r * r))]);
		}
		profile.push([rim, 2.3]);
		const geo = latheZ(profile, 128);
		const m = mesh(geo, M.sapphire);
		m.renderOrder = 10;
		add({ id: 'crystal', name: 'Sapphire crystal', info: 'Domed sapphire, hard enough that only diamond scratches it.', group: 'crystal', layer: 13, object: m });
	}

	// ---------------------------------------------------------------- bezel
	{
		const slopeA: [number, number] = [19.72, 3.03];
		const slopeB: [number, number] = [21.55, 2.2];
		const profile: [number, number][] = [
			[19.25, 2.3],
			[19.25, 2.98],
			[19.45, 3.06],
			slopeA,
			slopeB,
			[22.1, 1.85],
			[22.38, 1.5],
			[22.4, 1.28],
			[22.2, 1.2],
			[19.6, 1.2],
			[19.6, 2.3],
			[19.25, 2.3],
		];
		const g = new THREE.Group();
		g.add(lathe(profile, M.gold));
		const tex = meander.clone();
		tex.repeat.set(34, 1);
		tex.needsUpdate = true;
		const mat = enamelBand.clone();
		mat.map = tex;
		const mid = (t: number): [number, number] => [slopeA[0] + (slopeB[0] - slopeA[0]) * t, slopeA[1] + (slopeB[1] - slopeA[1]) * t];
		g.add(band(mid(0.08), mid(0.92), 0.012, mat));
		add({ id: 'bezel', name: 'Bezel', info: 'Gold, with a band of champlevé enamel: a black meander on sky blue, borrowed from the Patek Philippe singing-bird box of 1866.', group: 'bezel', layer: 12, object: g });
	}

	// ---------------------------------------------------------------- case middle, pendant and bow
	{
		const profile: [number, number][] = [
			[18.95, -10.9],
			[18.95, 1.2],
			[21.9, 1.2],
			[22.3, 0.95],
			[22.45, 0.45],
			[22.45, -10.2],
			[22.3, -10.75],
			[21.9, -11.05],
			[21.3, -11.2],
			[18.95, -11.2],
			[18.95, -10.9],
		];
		const g = new THREE.Group();
		g.add(lathe(profile, M.gold, 192));
		const tex = meander.clone();
		tex.repeat.set(30, 1);
		tex.needsUpdate = true;
		const mat = enamelBand.clone();
		mat.map = tex;
		g.add(band([22.45, -6.25], [22.45, -3.25], 0.015, mat, 256));

		// Pendant at 12: a lathed collar along +y.
		const pendant = latheZ(
			[
				[0, 0],
				[1.95, 0],
				[1.95, 0.45],
				[1.6, 0.9],
				[1.5, 2.3],
				[1.8, 2.5],
				[1.8, 2.95],
				[0.5, 2.95],
				[0.5, 0],
			],
			48,
		);
		pendant.rotateX(-Math.PI / 2);
		pendant.translate(0, 21.95, STEM_Z);
		g.add(mesh(toCreasedNormals(pendant, 0.7), M.gold));

		// Bow: an open ring pivoting on the pendant.
		const bowR = 4.5;
		const bowCy = 27.35;
		const arcLen = (262 * Math.PI) / 180;
		const bow = new THREE.TorusGeometry(bowR, 0.72, 20, 120, arcLen);
		bow.rotateZ(-Math.PI / 2 + (TAU - arcLen) / 2);
		bow.translate(0, bowCy, STEM_Z);
		g.add(mesh(bow, M.gold));
		for (const s of [-1, 1]) {
			const a = -Math.PI / 2 + s * ((Math.PI * 2 - arcLen) / 2);
			const ex = bowR * Math.cos(a);
			const ey = bowCy + bowR * Math.sin(a);
			const knob = new THREE.CylinderGeometry(0.5, 0.62, Math.abs(ex) - 1.6, 16);
			knob.rotateZ(Math.PI / 2);
			knob.translate((ex + s * 1.6) / 2, ey + 0.05, STEM_Z);
			g.add(mesh(knob, M.gold));
		}
		add({ id: 'caseMiddle', name: 'Case', info: 'Yellow gold, with a champlevé band around its flank, the pendant and the bow.', group: 'case', layer: -12.2, object: g });
	}

	// ---------------------------------------------------------------- display back
	{
		const g = new THREE.Group();
		const profile: [number, number][] = [
			[18.95, -11.2],
			[21.3, -11.2],
			[21.7, -11.5],
			[21.55, -11.92],
			[20.9, -12.2],
			[19.2, -12.2],
			[19.2, -11.4],
			[18.95, -11.4],
			[18.95, -11.2],
		];
		g.add(lathe(profile, M.gold));
		const glass = new THREE.Mesh(new THREE.CircleGeometry(19.25, 96), M.sapphire);
		glass.position.z = -11.95;
		glass.renderOrder = 10;
		g.add(glass);
		const inscription = `${config.inscription} · `;
		const ring = new THREE.RingGeometry(19.3, 20.85, 160, 1);
		const tex = drawCasebackRing(20.85, 19.3, inscription);
		const engr = new THREE.Mesh(
			ring,
			new THREE.MeshPhysicalMaterial({ map: tex, transparent: true, metalness: 1, roughness: 0.45, color: 0xffffff, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
		);
		engr.rotation.y = Math.PI;
		engr.position.z = -12.205;
		g.add(engr);
		add({ id: 'caseBack', name: 'Display back', info: 'Sapphire, so the movement can be admired; engraved around the rim.', group: 'case', layer: -13.6, object: g });
	}

	// ---------------------------------------------------------------- crown and stem
	{
		const g = new THREE.Group();
		const crownGeo = latheZ(
			[
				[0, 0],
				[1.5, 0],
				[2.45, 0.22],
				[2.7, 0.6],
				[2.7, 2.05],
				[2.45, 2.45],
				[1.5, 2.68],
				[0, 2.72],
			],
			144,
		);
		// Flutes for grip.
		const pos = crownGeo.getAttribute('position');
		for (let i = 0; i < pos.count; i++) {
			const x = pos.getX(i);
			const y = pos.getY(i);
			const r = Math.hypot(x, y);
			if (r > 2.5) {
				const a = Math.atan2(y, x);
				const k = 1 - 0.045 * (0.5 + 0.5 * Math.cos(a * 30));
				pos.setXY(i, x * k, y * k);
			}
		}
		crownGeo.rotateX(-Math.PI / 2);
		crownGeo.translate(0, 24.9, STEM_Z);
		g.add(mesh(toCreasedNormals(crownGeo, 0.9), M.gold));
		const stem = new THREE.CylinderGeometry(0.42, 0.42, 12.3, 16);
		stem.translate(0, 18.75, STEM_Z);
		g.add(mesh(stem, M.steel));
		// Winding and sliding pinions on the stem.
		for (const [y, teeth] of [
			[14.6, 14],
			[16.1, 11],
		] as [number, number][]) {
			const p = pinion(M, teeth, 0.13, 30, -0.55, 0.9);
			p.rotation.x = -Math.PI / 2;
			p.position.set(0, y, STEM_Z);
			g.add(p);
		}
		add({
			id: 'crown',
			name: 'Crown and stem',
			info: 'Wind the watch through the crown; the stem’s pinions turn the crown wheel and ratchet on the barrel bridge.',
			group: 'keyless',
			layer: 1.2,
			object: g,
			explodeOffset: new THREE.Vector3(0, 9, 0),
		});
	}

	return { parts };
}
