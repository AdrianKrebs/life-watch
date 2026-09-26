import type * as THREE from 'three';
import type { WatchState } from '../time';

/** Label groups shown in the exploded view, front to back. */
export const GROUPS = {
	crystal: { title: 'Sapphire crystal', text: 'Domed, with an anti-reflective bloom.' },
	bezel: { title: 'Bezel', text: 'Yellow gold with a champlevé enamel meander, after the Patek Philippe singing-bird box of 1866.' },
	hands: { title: 'Hands', text: 'Breguet hands in flame-blued steel; the date hand in gold.' },
	dial: { title: 'Enamel dial', text: 'Grand feu white enamel with apertures for the life counters and the moon.' },
	counters: { title: 'Life counters', text: 'Two big-date discs for years of age, three drums for days since the last birthday.' },
	calendar: { title: 'Perpetual calendar', text: 'Date, day and month stars, the grand lever and the 48-month cam that knows every month and leap year (until 2100, which needs a one-off correction).' },
	calendarPlate: { title: 'Calendar plate', text: 'Gilt, circular graining. Carries the calendar module on the dial side.' },
	motion: { title: 'Motion works', text: 'Cannon pinion, minute wheel and hour wheel (12:1), plus the 24-hour wheel that drives the calendar.' },
	keyless: { title: 'Keyless works', text: 'Crown, stem, sliding and winding pinions, crown wheel, ratchet wheel and click.' },
	plate: { title: 'Main plate', text: 'Rhodium-plated brass with perlage: thousands of overlapping circular grains.' },
	train: { title: 'Going train', text: 'Barrel, centre, third and fourth wheels: 96/12 · 80/10 · 60/8 · 70/7, gearing the barrel’s one turn in 8 h up to the escape wheel’s one turn in 6 s (×4,800).' },
	escapement: { title: 'Swiss lever escapement', text: 'A 15-tooth club-tooth escape wheel and the pallet fork with two ruby pallets.' },
	balance: { title: 'Balance & hairspring', text: '2.5 oscillations per second (18,000 vph). The heart of the watch.' },
	bridges: { title: 'Bridges', text: 'Rhodium-plated with Côtes de Genève, polished bevels, gold chatons and blued screws.' },
	cock: { title: 'Balance cock', text: 'Holds the balance, with the A–R regulator index.' },
	case: { title: 'Case', text: 'Open-face gold pocket watch case with a sapphire display back.' },
} as const;

export type GroupId = keyof typeof GROUPS;

/** The part each exploded-view label points at. */
export const GROUP_ANCHORS: Record<GroupId, string> = {
	crystal: 'crystal',
	bezel: 'bezel',
	hands: 'minuteHand',
	dial: 'dial',
	counters: 'ageUnits',
	calendar: 'dateStar',
	calendarPlate: 'calendarPlate',
	motion: 'dayWheel',
	keyless: 'ratchet',
	plate: 'mainPlate',
	train: 'barrel',
	escapement: 'escapeWheel',
	balance: 'balance',
	bridges: 'trainBridge',
	cock: 'balanceCock',
	case: 'caseMiddle',
};

export interface FrameContext {
	state: WatchState;
	dt: number;
	/** 0..1 */
	explode: number;
}

export interface Part {
	id: string;
	name: string;
	info: string;
	group: GroupId;
	/** Explode layer: positive towards the dial, negative towards the back. */
	layer: number;
	object: THREE.Object3D;
	/** Extra offset at full explosion (e.g. the crown slides out of the pendant). */
	explodeOffset?: THREE.Vector3;
	update?: (ctx: FrameContext) => void;
	/** Base position recorded at assembly. */
	base?: THREE.Vector3;
}

/** Damp an angle towards a target, taking the short way round a given period. */
export function dampAngle(current: number, target: number, lambda: number, dt: number, period = Math.PI * 2) {
	let delta = target - current;
	delta -= period * Math.round(delta / period);
	if (Math.abs(delta) > period * 0.45 && dt > 0) {
		// Big jumps (time travel): snap.
		return current + delta;
	}
	return current + delta * (1 - Math.exp(-lambda * dt));
}

/** Angle of the mesh that makes pinion P (zp leaves) interleave with wheel W (zw teeth). */
export function meshPhase(wheelAngle: number, zw: number, zp: number, gamma: number) {
	// With a tooth of W pointing at P, a gap of P must point back at W.
	return gamma + Math.PI - Math.PI / zp - (zw / zp) * (wheelAngle - gamma);
}
