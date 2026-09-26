import * as THREE from 'three';
import type { ResolvedConfig } from '../config';
import { createMaterials, type Materials } from '../materials';
import type { WatchState } from '../time';
import { buildCase } from './case';
import { buildDialSide } from './dialSide';
import { buildMovement } from './movement';
import type { FrameContext, Part } from './part';

/** Spacing between explode layers at full explosion, in mm. */
export const LAYER_GAP = 7.2;
const MAX_LAYER = 14;

const smootherstep = (x: number) => {
	const t = Math.min(1, Math.max(0, x));
	return t * t * t * (t * (6 * t - 15) + 10);
};

export class WatchModel {
	readonly root = new THREE.Group();
	readonly parts: Part[];
	readonly materials: Materials;
	private readonly byId = new Map<string, Part>();
	private readonly highlight = new Map<THREE.Material, THREE.Material>();
	private hovered: string | null = null;
	explode = 0;

	constructor(config: ResolvedConfig, quality: 'high' | 'low' = 'high') {
		this.materials = createMaterials(quality, config.metal);
		const M = this.materials;
		this.parts = [...buildCase(M, config).parts, ...buildDialSide(M, config).parts, ...buildMovement(M, config).parts];
		for (const p of this.parts) {
			p.base = p.object.position.clone();
			this.byId.set(p.id, p);
			p.object.traverse((o) => {
				o.userData.partId = p.id;
			});
			this.root.add(p.object);
		}
	}

	part(id: string) {
		return this.byId.get(id);
	}

	update(state: WatchState, dt: number, explode: number) {
		this.explode = explode;
		const ctx: FrameContext = { state, dt, explode };
		for (const p of this.parts) {
			p.update?.(ctx);
			const base = p.base!;
			// Outer layers leave first, like lifting a watch apart from the top down.
			const lead = 0.28 * (1 - Math.abs(p.layer) / MAX_LAYER);
			const t = smootherstep((explode - lead) / (1 - lead * 0.9));
			p.object.position.set(base.x, base.y, base.z + p.layer * LAYER_GAP * t);
			if (p.explodeOffset) p.object.position.addScaledVector(p.explodeOffset, t);
		}
	}

	setHovered(id: string | null) {
		if (id === this.hovered) return;
		if (this.hovered) this.swap(this.hovered, false);
		this.hovered = id;
		if (id) this.swap(id, true);
	}

	private highlighted(mat: THREE.Material) {
		let h = this.highlight.get(mat);
		if (!h) {
			h = mat.clone();
			const m = h as THREE.MeshPhysicalMaterial;
			if ('emissive' in m) {
				m.emissive = new THREE.Color('#ff9a3c');
				m.emissiveIntensity = 0.22;
			}
			this.highlight.set(mat, h);
		}
		return h;
	}

	private swap(id: string, on: boolean) {
		const p = this.byId.get(id);
		if (!p) return;
		p.object.traverse((o) => {
			const m = o as THREE.Mesh;
			if (!m.isMesh) return;
			if (on) {
				m.userData.baseMaterial = m.material;
				m.material = Array.isArray(m.material) ? m.material.map((x) => this.highlighted(x)) : this.highlighted(m.material);
			} else if (m.userData.baseMaterial) {
				m.material = m.userData.baseMaterial;
			}
		});
	}

	dispose() {
		this.root.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.isMesh) m.geometry.dispose();
		});
		for (const m of this.materials.list) m.dispose();
		for (const m of this.highlight.values()) m.dispose();
	}
}

