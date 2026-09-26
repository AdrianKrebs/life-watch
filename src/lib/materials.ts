import * as THREE from 'three';

// Finishes. Brushed and grained metal is rendered with anisotropic
// highlights: the anisotropy direction is the one across the tool marks,
// where the micro-surface is roughest. Côtes de Genève and perlage are baked
// once into direction fields in movement coordinates (planar UVs over
// x, y ∈ [-20, 20] mm) so the stripes run across every bridge, as they do
// when a watchmaker decorates the bridges screwed together.

const lin = (hex: string) => new THREE.Color(hex);

const SPAN = 40; // textures cover x, y ∈ [-20, 20] mm

function packDirection(data: Uint8Array, k: number, dx: number, dy: number, strength: number) {
	// Directions are axial; keep them in one half-plane so mipmaps don't cancel.
	if (dx < 0 || (dx === 0 && dy < 0)) {
		dx = -dx;
		dy = -dy;
	}
	data[k] = (dx * 0.5 + 0.5) * 255;
	data[k + 1] = (dy * 0.5 + 0.5) * 255;
	data[k + 2] = strength * 255;
	data[k + 3] = 255;
}

function toTexture(data: Uint8Array, size: number) {
	const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	tex.colorSpace = THREE.NoColorSpace;
	tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.anisotropy = 8;
	tex.needsUpdate = true;
	return tex;
}

/**
 * Côtes de Genève: diagonal bands, each swept by a rotating tool whose edge
 * leaves arcs across the band. With a continuous sweep the arc through a
 * point is centred one tool radius behind it, so the direction fans from
 * one edge of the band to the other: every band shades like a shallow
 * cylinder, and neighbouring bands break sharply, which is the look.
 */
function cotesDeGeneve(size: number) {
	const w = 2.4; // band width
	const Rt = w * 1.05; // tool radius
	const ang = (-28 * Math.PI) / 180;
	const c = Math.cos(ang);
	const sn = Math.sin(ang);
	const data = new Uint8Array(size * size * 4);
	for (let j = 0; j < size; j++) {
		// Row 0 is v = 0, which is y = -20 mm.
		const y = -SPAN / 2 + ((j + 0.5) / size) * SPAN;
		for (let i = 0; i < size; i++) {
			const x = -SPAN / 2 + ((i + 0.5) / size) * SPAN;
			const v = x * sn + y * c;
			const dv = v - (Math.floor(v / w) + 0.5) * w;
			const du = Math.sqrt(Rt * Rt - dv * dv);
			const rx = du / Rt;
			const ry = dv / Rt;
			const edge = Math.abs(dv) / (w / 2);
			packDirection(data, (j * size + i) * 4, rx * c + ry * sn, -rx * sn + ry * c, 0.6 + 0.4 * (1 - edge ** 8));
		}
	}
	return toTexture(data, size);
}

/**
 * Perlage: overlapping circular grains laid down row by row, each new one
 * on top of the last. Stamped grain by grain, like the real thing.
 */
function perlage(size: number) {
	const r = 0.7;
	const pitch = r * 0.74;
	const data = new Uint8Array(size * size * 4);
	const px = size / SPAN;
	const rp = r * px;
	const rows = Math.ceil(SPAN / pitch) + 2;
	let seed = 11;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * pitch * 0.18 * px;
	for (let row = 0; row < rows; row++) {
		const cyBase = (row * pitch) * px;
		const offset = (row & 1) * pitch * 0.5 * px;
		for (let col = -1; col < rows; col++) {
			const cx = col * pitch * px + offset + rnd();
			const cy = cyBase + rnd();
			const i0 = Math.max(0, Math.floor(cx - rp));
			const i1 = Math.min(size - 1, Math.ceil(cx + rp));
			const j0 = Math.max(0, Math.floor(cy - rp));
			const j1 = Math.min(size - 1, Math.ceil(cy + rp));
			for (let j = j0; j <= j1; j++) {
				const dy = j + 0.5 - cy;
				for (let i = i0; i <= i1; i++) {
					const dx = i + 0.5 - cx;
					const d = Math.sqrt(dx * dx + dy * dy);
					if (d > rp) continue;
					const inv = 1 / (d || 1);
					packDirection(data, (j * size + i) * 4, dx * inv, dy * inv, Math.min(1, 0.2 + (d / rp) * 0.75));
				}
			}
		}
	}
	return toTexture(data, size);
}

/** Radial tangents for concentric circular graining on round parts (rotates with them). */
export function addRadialTangents(geo: THREE.BufferGeometry, cx = 0, cy = 0) {
	const pos = geo.getAttribute('position');
	const t = new Float32Array(pos.count * 4);
	for (let i = 0; i < pos.count; i++) {
		const dx = pos.getX(i) - cx;
		const dy = pos.getY(i) - cy;
		const l = Math.hypot(dx, dy) || 1;
		t[i * 4] = dx / l;
		t[i * 4 + 1] = dy / l;
		t[i * 4 + 2] = 0;
		t[i * 4 + 3] = 1;
	}
	geo.setAttribute('tangent', new THREE.BufferAttribute(t, 4));
	return geo;
}

export type Materials = ReturnType<typeof createMaterials>;

// Linear base colours for the case metals.
const METALS = {
	yellow: [1, 0.74, 0.36],
	rose: [0.97, 0.6, 0.47],
	white: [0.78, 0.78, 0.8],
} as const;

export function createMaterials(quality: 'high' | 'low' = 'high', metal: keyof typeof METALS = 'yellow') {
	const texSize = quality === 'high' ? 2048 : 1024;
	const cotes = cotesDeGeneve(texSize);
	const pearl = perlage(texSize);

	const gold = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color().setRGB(METALS[metal][0], METALS[metal][1], METALS[metal][2], THREE.LinearSRGBColorSpace),
		metalness: 1,
		roughness: 0.16,
		name: 'gold',
	});
	const goldSatin = gold.clone();
	goldSatin.roughness = 0.34;
	goldSatin.anisotropy = 0.75;
	goldSatin.name = 'goldSatin';

	// Gilt brass for wheels: warmer, with circular graining.
	const gilt = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color().setRGB(0.93, 0.66, 0.33, THREE.LinearSRGBColorSpace),
		metalness: 1,
		roughness: 0.3,
		anisotropy: 0.8,
		name: 'gilt',
	});
	const giltPolished = gilt.clone();
	giltPolished.roughness = 0.12;
	giltPolished.anisotropy = 0;
	giltPolished.name = 'giltPolished';

	const rhodium = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color().setRGB(0.66, 0.67, 0.69, THREE.LinearSRGBColorSpace),
		metalness: 1,
		roughness: 0.36,
		anisotropy: 0.55,
		anisotropyMap: cotes,
		name: 'rhodiumCotes',
	});
	const plate = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color().setRGB(0.62, 0.63, 0.65, THREE.LinearSRGBColorSpace),
		metalness: 1,
		roughness: 0.46,
		anisotropy: 0.45,
		anisotropyMap: pearl,
		name: 'platePerlage',
	});
	// Polished anglage on the edges of plates and bridges.
	const anglage = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color().setRGB(0.74, 0.75, 0.77, THREE.LinearSRGBColorSpace),
		metalness: 1,
		roughness: 0.07,
		name: 'anglage',
	});
	const steel = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color().setRGB(0.7, 0.71, 0.73, THREE.LinearSRGBColorSpace),
		metalness: 1,
		roughness: 0.12,
		name: 'steel',
	});
	const steelSunray = steel.clone();
	steelSunray.roughness = 0.26;
	steelSunray.anisotropy = 0.85;
	steelSunray.name = 'steelSunray';
	const steelDark = steel.clone();
	steelDark.color = new THREE.Color().setRGB(0.36, 0.37, 0.4, THREE.LinearSRGBColorSpace);
	steelDark.roughness = 0.22;
	steelDark.name = 'steelDark';

	// Heat-blued steel: a thin oxide film, hence the iridescence.
	const blued = new THREE.MeshPhysicalMaterial({
		color: new THREE.Color().setRGB(0.025, 0.07, 0.36, THREE.LinearSRGBColorSpace),
		metalness: 1,
		roughness: 0.14,
		iridescence: 0.25,
		iridescenceIOR: 1.6,
		iridescenceThicknessRange: [330, 380],
		name: 'blued',
	});

	const ruby = new THREE.MeshPhysicalMaterial({
		color: lin('#b0102e'),
		metalness: 0,
		roughness: 0.04,
		ior: 1.77,
		clearcoat: 1,
		clearcoatRoughness: 0.02,
		emissive: lin('#4a0010'),
		emissiveIntensity: 0.6,
		specularIntensity: 1,
		name: 'ruby',
	});

	const enamel = new THREE.MeshPhysicalMaterial({
		color: 0xffffff,
		roughness: 0.42,
		metalness: 0,
		clearcoat: 1,
		clearcoatRoughness: 0.035,
		name: 'enamel',
	});
	const enamelEdge = new THREE.MeshPhysicalMaterial({
		color: lin('#e8e2d4'),
		roughness: 0.3,
		clearcoat: 1,
		clearcoatRoughness: 0.05,
		name: 'enamelEdge',
	});
	const lacquer = new THREE.MeshPhysicalMaterial({
		color: 0xffffff,
		roughness: 0.55,
		metalness: 0,
		clearcoat: 0.4,
		clearcoatRoughness: 0.3,
		name: 'lacquer',
	});
	const moon = new THREE.MeshPhysicalMaterial({
		color: 0xffffff,
		roughness: 0.3,
		metalness: 0.2,
		clearcoat: 1,
		clearcoatRoughness: 0.04,
		name: 'moon',
	});

	const sapphire = new THREE.MeshPhysicalMaterial({
		color: 0xffffff,
		metalness: 0,
		roughness: 0,
		transparent: true,
		opacity: 0.1,
		ior: 1.77,
		specularIntensity: 1,
		depthWrite: false,
		side: THREE.DoubleSide,
		iridescence: 0.35,
		iridescenceIOR: 1.3,
		iridescenceThicknessRange: [200, 400],
		name: 'sapphire',
	});

	const all = { gold, goldSatin, gilt, giltPolished, rhodium, plate, anglage, steel, steelSunray, steelDark, blued, ruby, enamel, enamelEdge, lacquer, moon, sapphire };
	return { ...all, textures: { cotes, pearl }, list: Object.values(all) };
}
