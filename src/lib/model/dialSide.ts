import * as THREE from 'three';
import { drawAgeDisc, drawDial, drawDrum, drawMoonDisc } from '../dial';
import { gearOutline, starOutline } from '../geometry/gear';
import { arc, box, capsule, circle, intersect, ring, smoothUnion, subtract, type SDF, type Vec2 } from '../geometry/sdf';
import { sdfShapes } from '../geometry/shapes';
import {
	AGE_DISC_R,
	AGE_DISCS,
	AGE_WINDOW,
	BEATS_PER_TURN,
	CALENDAR,
	DAYS_DRUM_R,
	DAYS_DRUM_W,
	DAYS_WINDOW,
	DIAL_R,
	MOON_DISC_R,
	MOON_ORBIT_R,
	MOON_R,
	MOTION,
	SUBDIALS,
	Z,
} from '../layout';
import { turns, type WatchState } from '../time';
import { arbor, mesh, pinion, pipe, polyShape, screw, slab, wheel, type Mats } from './builders';
import { birthdayLabel, type ResolvedConfig } from '../config';
import { dampAngle, meshPhase, type Part } from './part';

const TAU = Math.PI * 2;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;
const dir = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);
const O = { x: 0, y: 0 };

// Jump stiffness: calendar stars snap in about a fifth of a second at any speed.
const SNAP = 26;

/** Displayed angles of everything that jumps, damped so jumps read as snaps. */
class Jumps {
	values = new Map<string, number>();
	get(key: string, target: number, period: number, dt: number, lambda = SNAP) {
		const cur = this.values.get(key);
		const next = cur === undefined ? target : dampAngle(cur, target, lambda, dt, period);
		this.values.set(key, next);
		return next;
	}
}

// Grand lever geometry (dial-side coordinates, mm).
const DAY_WHEEL = MOTION.dayWheel;
/** Snail step direction at midnight, pointing at the lever's feeler. */
const SNAIL_STEP = (70.6 * Math.PI) / 180;
const SNAIL_R0 = 2.5;
/** Feeler resting on the snail just after midnight. */
const FEELER_SNAIL: Vec2 = [DAY_WHEEL.x + SNAIL_R0 * Math.cos(SNAIL_STEP), DAY_WHEEL.y + SNAIL_R0 * Math.sin(SNAIL_STEP)];
const FEELER_ARM = Math.hypot(FEELER_SNAIL[0] - CALENDAR.grandLeverPivot.x, FEELER_SNAIL[1] - CALENDAR.grandLeverPivot.y);
const LEVER_LIFT = (3.2 * Math.PI) / 180;
const SNAIL_RISE = LEVER_LIFT * FEELER_ARM;
/** Feeler on the 48-month cam, at its top tangent point. */
const FEELER_CAM: Vec2 = [7.26, 3.16];
/** Beak at the date star's 3 o'clock, on the line from the pivot through the star's centre. */
const BEAK: Vec2 = (() => {
	const P = CALENDAR.grandLeverPivot;
	const d = Math.hypot(P.x, P.y);
	const r = CALENDAR.dateStar.r - 0.1;
	return [(-P.x / d) * r, (-P.y / d) * r];
})();
/** Lever rotation that moves the beak one date-star tooth. */
const TOOTH_ON_LEVER = (TAU * CALENDAR.dateStar.r) / CALENDAR.dateStar.teeth / Math.hypot(BEAK[0] - CALENDAR.grandLeverPivot.x, BEAK[1] - CALENDAR.grandLeverPivot.y);

export function buildDialSide(M: Mats, config: ResolvedConfig) {
	const parts: Part[] = [];
	const add = (p: Part) => {
		parts.push(p);
		return p;
	};
	const jumps = new Jumps();

	// Shared per-frame calendar angles (computed once, read by stars, hands, jumpers).
	const cal = { date: 0, day: 0, month: 0, leap: 0, dateLag: 0, dayLag: 0, monthLag: 0, dateTeeth: 0 };
	let lastState: WatchState | null = null;
	const updateCalendar = (state: WatchState, dt: number) => {
		if (state === lastState) return;
		lastState = state;
		const dateTarget = -((state.dateSteps % 31) / 31) * TAU;
		// 1 January 1970 was a Thursday.
		const dayTarget = -((((state.daySteps + 4) % 7) + 7) % 7) / 7 * TAU;
		const monthTarget = -(((state.monthSteps % 12) + 0.5) / 12) * TAU;
		const leapTarget = -((state.leapCycleMonth + 0.5) / 48) * TAU;
		cal.date = jumps.get('date', dateTarget, TAU, dt);
		cal.day = jumps.get('day', dayTarget, TAU, dt);
		cal.month = jumps.get('month', monthTarget, TAU, dt);
		cal.leap = jumps.get('leap', leapTarget, TAU, dt, SNAP * 0.6);
		const lag = (cur: number, target: number, pitch: number) => {
			let d = target - cur;
			d -= TAU * Math.round(d / TAU);
			return Math.min(1, Math.abs(d) / pitch);
		};
		cal.dateLag = lag(cal.date, dateTarget, TAU / 31);
		{
			let d = dateTarget - cal.date;
			d -= TAU * Math.round(d / TAU);
			cal.dateTeeth = Math.abs(d) / (TAU / 31);
		}
		cal.dayLag = lag(cal.day, dayTarget, TAU / 7);
		cal.monthLag = lag(cal.month, monthTarget, TAU / 12);
	};

	// ---------------------------------------------------------------- motion works
	const mw = MOTION.minuteWheel;
	const hw = MOTION.hourWheel;
	const idl = MOTION.idler;
	const dw = MOTION.dayWheel;
	const phiMinuteWheel = meshPhase(0, MOTION.cannon.teeth, mw.teeth, dir(O, mw));
	const phiHourWheel = meshPhase(0, mw.pinion, hw.teeth, dir(mw, O));
	const phiIdler = meshPhase(phiHourWheel, hw.teeth, idl.teeth, dir(O, idl));
	const phiDayWheel = meshPhase(phiIdler, idl.teeth, dw.teeth, dir(idl, dw));

	{
		const g = new THREE.Group();
		g.add(pinion(M, MOTION.cannon.teeth, MOTION.cannon.module, mw.teeth, -2.5, 0.28));
		g.add(pipe(M.steel, 0.55, 0.3, -2.5, 1.1));
		const part = add({
			id: 'cannonPinion',
			name: 'Cannon pinion',
			info: 'Friction-fitted on the centre arbor, it carries the minute hand and lets you set the time while the train runs on.',
			group: 'motion',
			layer: 2.3,
			object: g,
		});
		part.update = ({ state }) => {
			g.rotation.z = -TAU * turns(state.trainBeats, BEATS_PER_TURN.centre);
		};
	}
	{
		const g = new THREE.Group();
		g.position.set(mw.x, mw.y, 0);
		const w = wheel(M, { teeth: mw.teeth, module: mw.module, mate: MOTION.cannon.teeth, spokes: 4 }, -2.5, 0.17);
		w.rotation.z = phiMinuteWheel;
		g.add(w);
		g.add(pinion(M, mw.pinion, mw.pinionModule, hw.teeth, -2.33, 0.36));
		g.add(arbor(M, 0.2, -2.6, -1.85));
		const part = add({ id: 'minuteWheel', name: 'Minute wheel', info: 'Driven 3:1 by the cannon pinion; its 10-leaf pinion drives the hour wheel 4:1, 12:1 in all.', group: 'motion', layer: 2.7, object: g });
		part.update = ({ state }) => {
			g.rotation.z = TAU * turns(state.trainBeats, BEATS_PER_TURN.centre * 3);
		};
	}
	{
		const g = new THREE.Group();
		const w = wheel(M, { teeth: hw.teeth, module: hw.module, mate: mw.pinion, spokes: 0 }, -2.14, 0.17);
		w.rotation.z = phiHourWheel;
		g.add(w);
		g.add(pipe(M.gilt, 0.85, 0.58, -2.14, 0.86));
		const part = add({ id: 'hourWheel', name: 'Hour wheel', info: 'Turns twice a day and carries the hour hand; it also drives the calendar.', group: 'motion', layer: 3.2, object: g });
		part.update = ({ state }) => {
			g.rotation.z = -TAU * turns(state.trainBeats, BEATS_PER_TURN.hour);
		};
	}
	{
		const g = new THREE.Group();
		g.position.set(idl.x, idl.y, 0);
		const w = wheel(M, { teeth: idl.teeth, module: idl.module, mate: hw.teeth, spokes: 0 }, -2.14, 0.17);
		w.rotation.z = phiIdler;
		g.add(w);
		g.add(arbor(M, 0.18, -2.6, -1.8));
		const part = add({ id: 'calendarIdler', name: 'Calendar idler', info: '20 teeth, between the hour wheel and the 24-hour wheel.', group: 'motion', layer: 3.2, object: g });
		part.update = ({ state }) => {
			g.rotation.z = TAU * turns(state.trainBeats, BEATS_PER_TURN.hour / 2);
		};
	}
	{
		const g = new THREE.Group();
		g.position.set(dw.x, dw.y, 0);
		const w = wheel(M, { teeth: dw.teeth, module: dw.module, mate: idl.teeth, spokes: 5 }, -2.14, 0.17);
		w.rotation.z = phiDayWheel;
		g.add(w);
		// Snail cam: its radius grows through the day and drops at midnight.
		const snail: Vec2[] = [];
		const n = 96;
		// The step faces the grand lever's feeler at midnight; its rise over
		// the day is exactly what cocks the lever by LEVER_LIFT.
		for (let i = 0; i <= n; i++) {
			const a = SNAIL_STEP + (i / n) * TAU * 0.985;
			const r = SNAIL_R0 + SNAIL_RISE * (i / n);
			snail.push([r * Math.cos(a), r * Math.sin(a)]);
		}
		g.add(slab(polyShape(snail), -1.97, -1.83, M.steel, M.anglage, { bevel: 0.03 }));
		g.add(arbor(M, 0.22, -2.6, -1.8));
		const part = add({
			id: 'dayWheel',
			name: '24-hour wheel',
			info: 'One turn a day. Its snail slowly cocks the grand lever until it drops at midnight and the calendar jumps.',
			group: 'motion',
			layer: 3.9,
			object: g,
		});
		part.update = ({ state }) => {
			g.rotation.z = -TAU * turns(state.trainBeats, BEATS_PER_TURN.day);
		};
	}

	// ---------------------------------------------------------------- calendar plate
	{
		const holes: SDF[] = [
			circle(0, 0, 1.35),
			circle(SUBDIALS.day.x, SUBDIALS.day.y, 0.5),
			circle(SUBDIALS.month.x, SUBDIALS.month.y, 0.5),
			circle(SUBDIALS.seconds.x, SUBDIALS.seconds.y, 0.5),
			...AGE_DISCS.map((d) => circle(d.x, d.y, 0.45)),
			box(0, DAYS_WINDOW.y, 2.35, 1.95, 0, 0.5),
			circle(...FEELER_SNAIL, 0.9), // window for the grand lever's feeler
			// Lightening cut-outs, as on a real calendar plate.
			...[0.9, 2.1, 3.3, 4.4].map((a) => capsule(12.8 * Math.cos(a + 0.35), 12.8 * Math.sin(a + 0.35), 12.8 * Math.cos(a + 0.75), 12.8 * Math.sin(a + 0.75), 0.9)),
		];
		const sdf = subtract(circle(0, 0, 18.1), ...holes);
		const shapes = sdfShapes(sdf, { minX: -18.3, minY: -18.3, maxX: 18.3, maxY: 18.3 }, 0.06);
		const g = new THREE.Group();
		g.add(slab(shapes, -1.8, -1.4, M.gilt, M.giltPolished, { bevel: 0.08, radialTangents: true, curveSegments: 3 }));
		for (const [x, y] of [
			[-12.9, 9.4],
			[13.4, 8.7],
			[11.2, -11.9],
			[-6, -16],
		] as Vec2[]) {
			g.add(screw(M, x, y, -1.4, 1, 0.75));
		}
		add({ id: 'calendarPlate', name: 'Calendar plate', info: 'The dial-side plate carrying the perpetual calendar module.', group: 'calendarPlate', layer: 4.4, object: g });
	}

	// ---------------------------------------------------------------- grand lever
	{
		const P = CALENDAR.grandLeverPivot;
		const L = (x: number, y: number): Vec2 => [x - P.x, y - P.y];
		// The arm runs round the centre pipes; the beak meets the date star at
		// its 3 o'clock, where the lever's swing is tangential to the star.
		const arcR = 3.75;
		const a0 = (150 * Math.PI) / 180;
		const a1 = (20 * Math.PI) / 180;
		const A1: Vec2 = [arcR * Math.cos(a0), arcR * Math.sin(a0)];
		const A2: Vec2 = [arcR * Math.cos(a1), arcR * Math.sin(a1)];
		const F1 = FEELER_SNAIL;
		const F2 = FEELER_CAM;
		const arcSdf = arc(-P.x, -P.y, arcR, a1, a0, 0.72);
		const sdf = smoothUnion(
			0.55,
			circle(...L(P.x, P.y), 0.95),
			capsule(...L(P.x, P.y), ...L(-8.4, 1.4), 0.62, 0.48),
			capsule(...L(-8.4, 1.4), ...L(...A1), 0.48, 0.4),
			arcSdf,
			capsule(...L(...A2), ...L(...F2), 0.36, 0.22),
			capsule(...L(P.x, P.y), ...L(...F1), 0.5, 0.3),
			circle(...L(...F1), 0.34),
			capsule(...L(...A2), ...L(...BEAK), 0.22, 0.1),
		);
		const shapes = sdfShapes(sdf, { minX: -3, minY: -9, maxX: 24, maxY: 9.5 }, 0.035);
		const g = new THREE.Group();
		g.position.set(P.x, P.y, 0);
		const inner = new THREE.Group();
		inner.add(slab(shapes, -1.34, -1.14, M.steel, M.anglage, { bevel: 0.035 }));
		// Pins carry the beak up to the date star and the feeler down to the snail.
		const beakPin = pipe(M.steel, 0.1, 0, -1.14, -0.84, 12);
		beakPin.position.set(...L(...BEAK), 0);
		inner.add(beakPin);
		const feelerPin = pipe(M.steel, 0.12, 0, -1.95, -1.34, 12);
		feelerPin.position.set(...L(...F1), 0);
		inner.add(feelerPin);
		g.add(inner);
		g.add(screw(M, 0, 0, -1.14, 1, 0.6));
		const part = add({
			id: 'grandLever',
			name: 'Grand lever',
			info: 'Cocked all day by the snail, it falls at midnight and its beak advances the date star. On the last day of a short month it falls further, into the 48-month cam, and advances the star up to four teeth (28 Feb → 1 Mar).',
			group: 'calendar',
			layer: 5.3,
			object: g,
		});
		part.update = ({ state, dt }) => {
			// The snail cocks the lever anticlockwise through the day; at midnight
			// it falls clockwise, one date-star tooth per extra day at month end.
			updateCalendar(state, dt);
			const sod = Math.max(0, state.secondsOfDay);
			const target = LEVER_LIFT * (sod / 86_400) - TOOTH_ON_LEVER * Math.max(0, cal.dateTeeth - 1);
			inner.rotation.z = jumps.get('lever', target, TAU, dt, SNAP * 1.5);
		};
	}

	// ---------------------------------------------------------------- 48-month cam (leap cycle)
	{
		const lc = CALENDAR.leapCam;
		const depth = (m: number) => {
			const year = Math.floor(m / 12); // 3 = leap year
			const month = (m % 12) + 1;
			if (month === 2) return year === 3 ? 0.5 : 0.75;
			return [4, 6, 9, 11].includes(month) ? 0.26 : 0;
		};
		const feeler = Math.atan2(FEELER_CAM[1] - lc.y, FEELER_CAM[0] - lc.x);
		const pts: Vec2[] = [];
		const per = 6;
		for (let m = 0; m < 48; m++) {
			for (let k = 0; k < per; k++) {
				const a = feeler + ((m + (k + 0.5) / per) / 48) * TAU;
				const edge = k === 0 || k === per - 1 ? 0.35 : 1;
				pts.push([(lc.r - depth(m) * edge) * Math.cos(a), (lc.r - depth(m) * edge) * Math.sin(a)]);
			}
		}
		const shape = polyShape(pts);
		const hole = new THREE.Path();
		hole.absarc(0, 0, 0.45, 0, TAU, true);
		shape.holes.push(hole);
		const g = new THREE.Group();
		g.position.set(lc.x, lc.y, 0);
		g.add(slab(shape, -1.34, -1.16, M.steel, M.anglage, { bevel: 0.03 }));
		const part = add({
			id: 'leapCam',
			name: '48-month cam',
			info: 'Four years of months in one turn. Notch depths encode 30-day months, 28-day Februaries and the leap-year February.',
			group: 'calendar',
			layer: 5.3,
			object: g,
		});
		part.update = ({ state, dt }) => {
			updateCalendar(state, dt);
			g.rotation.z = cal.leap;
		};
	}

	// ---------------------------------------------------------------- stars and jumpers
	const starPart = (id: string, name: string, info: string, teeth: number, r: number, depth: number, x: number, y: number, key: 'date' | 'day' | 'month', holeR: number) => {
		const shape = polyShape(starOutline(teeth, r, depth));
		const h = new THREE.Path();
		h.absarc(0, 0, holeR, 0, TAU, true);
		shape.holes.push(h);
		const g = new THREE.Group();
		g.position.set(x, y, 0);
		g.add(slab(shape, -0.98, -0.8, M.steel, M.anglage, { bevel: 0.03, curveSegments: 3 }));
		// The date star's pipe carries the central date hand.
		if (key === 'date') g.add(pipe(M.steel, 1.2, 0.95, -0.8, 0.62));
		const part = add({ id, name, info, group: 'calendar', layer: 6.2, object: g });
		part.update = ({ state, dt }) => {
			updateCalendar(state, dt);
			g.rotation.z = cal[key];
		};
		return g;
	};

	starPart(
		'dateStar',
		'Date star',
		'31 teeth, exactly one turn per calendar month: in short months it is carried through two, three or four teeth at once.',
		CALENDAR.dateStar.teeth,
		CALENDAR.dateStar.r,
		0.42,
		0,
		0,
		'date',
		1.25,
	);
	starPart('dayStar', 'Day star', 'Seven teeth, one per day of the week.', CALENDAR.dayStar.teeth, CALENDAR.dayStar.r, 0.55, CALENDAR.dayStar.x, CALENDAR.dayStar.y, 'day', 0.3);
	starPart('monthStar', 'Month star', 'Twelve teeth, stepped once a month by a finger on the date star.', CALENDAR.monthStar.teeth, CALENDAR.monthStar.r, 0.45, CALENDAR.monthStar.x, CALENDAR.monthStar.y, 'month', 0.3);

	// Jumpers: V-tipped springs that snap each star home.
	const jumper = (id: string, foot: Vec2, tip: Vec2, key: 'dateLag' | 'dayLag' | 'monthLag') => {
		const len = Math.hypot(tip[0] - foot[0], tip[1] - foot[1]);
		const a = Math.atan2(tip[1] - foot[1], tip[0] - foot[0]);
		// Drawn along +x from the foot: a slim spring arm ending in a V.
		const sdf = smoothUnion(
			0.2,
			circle(0, 0, 0.55),
			capsule(0, 0, len - 0.35, 0.25, 0.18, 0.1),
			(x, y) => {
				const dx = x - (len - 0.1);
				return Math.max(Math.abs(dx) * 0.8 + (y - 0.1) * 0.6 - 0.18, -(y + 0.25), Math.abs(dx) - 0.45);
			},
		);
		const shapes = sdfShapes(sdf, { minX: -0.8, minY: -0.8, maxX: len + 0.8, maxY: 0.9 }, 0.02);
		const g = new THREE.Group();
		g.position.set(foot[0], foot[1], 0);
		g.rotation.z = a;
		const inner = new THREE.Group();
		inner.add(slab(shapes, -0.97, -0.81, M.steel, M.anglage, { bevel: 0.025 }));
		g.add(inner);
		g.add(screw(M, 0, 0, -0.8, 1, 0.42));
		const part = add({ id, name: 'Jumper', info: 'A sprung V that lets the star advance only a whole tooth at a time, and snaps it home.', group: 'calendar', layer: 6.2, object: g });
		part.update = ({ state, dt }) => {
			updateCalendar(state, dt);
			inner.rotation.z = 0.06 * Math.sin(Math.PI * cal[key]);
		};
	};
	jumper('dateJumper', [-3.9, -4.4], [-2.6, -3.35], 'dateLag');
	jumper('dayJumper', [-11.6, 3.4], [-9.55, 1.6], 'dayLag');
	jumper('monthJumper', [11.8, 3.3], [9.85, 1.7], 'monthLag');

	// Birthday gate: an AND of the September sector on the month arbor and a finger on the date star.
	{
		const sdf = smoothUnion(0.4, circle(0, 0, 0.5), capsule(0, 0, -2.3, 4.6, 0.3, 0.22), capsule(-2.3, 4.6, -2.0, 5.3, 0.18, 0.1));
		const shapes = sdfShapes(sdf, { minX: -3, minY: -1, maxX: 1, maxY: 6 }, 0.025);
		const g = new THREE.Group();
		g.position.set(5.3, 3.6, 0);
		g.add(slab(shapes, -1.34, -1.16, M.steel, M.anglage, { bevel: 0.03 }));
		g.add(screw(M, 0, 0, -1.14, 1, 0.45));
		add({
			id: 'birthdayGate',
			name: 'Birthday gate',
			info: `Only when the month star shows ${MONTH_NAMES[config.birth.month - 1]} and the date star steps onto the ${ordinal(config.birth.day)} does this lever let the grand lever push the age counter forward.`,
			group: 'counters',
			layer: 5.3,
			object: g,
		});
	}

	// ---------------------------------------------------------------- moon
	{
		const { x, y } = SUBDIALS.seconds;
		const teeth = 135;
		const outline = gearOutline({ teeth, module: (MOON_DISC_R * 2) / (teeth + 2.4), mate: 16 });
		const shape = polyShape(outline);
		const hole = new THREE.Path();
		hole.absarc(0, 0, 0.45, 0, TAU, true);
		shape.holes.push(hole);
		const mat = M.moon.clone();
		mat.map = drawMoonDisc(1024);
		const g = new THREE.Group();
		g.position.set(x, y, 0);
		g.add(slab(shape, -0.34, -0.16, mat, M.steel, { bevel: 0.02, uv: { ox: -4, oy: -4, size: 8 }, smooth: false }));
		const part = add({
			id: 'moonDisc',
			name: 'Moon disc',
			info: '135 teeth and two moons, advanced 16 teeth every 7 days: a lunation of 29.531 days, off by one day only every 122 years.',
			group: 'calendar',
			layer: 7.6,
			object: g,
		});
		part.update = ({ state }) => {
			g.rotation.z = Math.PI / 2 - state.moonPhase * Math.PI;
		};
	}

	// ---------------------------------------------------------------- life counters
	{
		const agePart = (i: number) => {
			const d = AGE_DISCS[i];
			const winX = d.window;
			const winAngle = Math.atan2(AGE_WINDOW.y - d.y, winX - d.x);
			const digitR = Math.hypot(AGE_WINDOW.y - d.y, winX - d.x);
			const { texture, span } = drawAgeDisc(winAngle, digitR, AGE_DISC_R);
			const mat = M.lacquer.clone();
			mat.map = texture;
			// Ten notches on the rim for the jumper.
			const pts: Vec2[] = [];
			for (let k = 0; k < 200; k++) {
				const a = (k / 200) * TAU;
				// Notches sit between digits, never under the window.
				const notch = Math.max(0, Math.cos(((a - winAngle - Math.PI / 10) * 10) / 2) ** 40) * 0.25;
				pts.push([(AGE_DISC_R - notch) * Math.cos(a), (AGE_DISC_R - notch) * Math.sin(a)]);
			}
			const shape = polyShape(pts);
			const h = new THREE.Path();
			h.absarc(0, 0, 0.4, 0, TAU, true);
			shape.holes.push(h);
			const z0 = i === 0 ? -0.32 : -0.56;
			const g = new THREE.Group();
			g.position.set(d.x, d.y, 0);
			const m = slab(shape, z0, z0 + 0.16, mat, M.lacquer, { bevel: 0.02, uv: { ox: -span / 2, oy: -span / 2, size: span }, smooth: false });
			g.add(m);
			g.add(arbor(M, 0.3, -1.4, z0 + 0.2));
			const part = add({
				id: i === 0 ? 'ageTens' : 'ageUnits',
				name: i === 0 ? 'Age disc (tens)' : 'Age disc (units)',
				info: i === 0 ? 'Tens of years. Carried by a single finger on the units disc when it passes from 9 to 0.' : `Years of age. Jumps once a year, at midnight on ${birthdayLabel(config.birth)}.`,
				group: 'counters',
				layer: 7.8 + (i === 0 ? 0.35 : 0),
				object: g,
			});
			part.update = ({ state, dt }) => {
				const digit = i === 0 ? Math.floor(state.ageYears / 10) % 10 : state.ageYears % 10;
				g.rotation.z = jumps.get(part.id, -(digit / 10) * TAU, TAU, dt, SNAP * 0.8);
			};
		};
		agePart(0);
		agePart(1);

		const circumference = TAU * DAYS_DRUM_R;
		const drumTex = drawDrum(circumference, DAYS_DRUM_W);
		const drumMat = M.lacquer.clone();
		drumMat.map = drumTex;
		const drumZ = -0.1 - DAYS_DRUM_R;
		const drums = new THREE.Group();
		const drumGroups: THREE.Group[] = [];
		DAYS_WINDOW.xs.forEach((x) => {
			const g = new THREE.Group();
			g.position.set(x, DAYS_WINDOW.y, drumZ);
			const geo = new THREE.CylinderGeometry(DAYS_DRUM_R, DAYS_DRUM_R, DAYS_DRUM_W, 72, 1, true);
			geo.rotateZ(-Math.PI / 2);
			g.add(mesh(geo, drumMat));
			// Carry gear and locking ring on the drum's flank.
			const gearShape = polyShape(gearOutline({ teeth: 20, module: (DAYS_DRUM_R * 1.7) / 20, mate: 8 }));
			const gear = slab(gearShape, 0, 0.09, M.steel, M.steel, { bevel: 0.015, smooth: false });
			gear.rotation.y = Math.PI / 2;
			gear.position.x = DAYS_DRUM_W / 2 - 0.02;
			g.add(gear);
			const endCap = new THREE.Mesh(new THREE.CircleGeometry(DAYS_DRUM_R, 48), M.lacquer);
			endCap.rotation.y = -Math.PI / 2;
			endCap.position.x = -DAYS_DRUM_W / 2;
			g.add(endCap);
			drums.add(g);
			drumGroups.push(g);
		});
		const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 5.4, 12), M.steel);
		axle.rotation.z = Math.PI / 2;
		axle.position.set(0, DAYS_WINDOW.y, drumZ);
		drums.add(axle);
		const part = add({
			id: 'daysDrums',
			name: 'Days drums',
			info: 'Days since the last birthday, 000 to 365. An odometer: each drum carries the next through a transfer pinion, and a heart-cam hammer returns all three to zero on the birthday.',
			group: 'counters',
			layer: 7.1,
			object: drums,
		});
		part.update = ({ state, dt }) => {
			const days = state.daysSinceBirthday;
			const digits = [Math.floor(days / 100) % 10, Math.floor(days / 10) % 10, days % 10];
			drumGroups.forEach((g, k) => {
				const target = -(TAU * (digits[k] + 0.5)) / 10;
				g.rotation.x = jumps.get(`drum${k}`, target, TAU, dt, SNAP * 0.7);
			});
		};
	}

	// ---------------------------------------------------------------- dial
	{
		const winHole = (x: number, y: number, w: number, h: number, r: number): SDF => box(x, y, w / 2, h / 2, 0, r);
		const { x: mx, y: my } = SUBDIALS.seconds;
		// Classic aperture: the moon's orbit arc above the subdial centre, with two
		// humps at the new-moon positions. Their radius makes the hump edge cross
		// the moon's centre exactly at first and last quarter.
		const hump = 2 * MOON_ORBIT_R * Math.sin(Math.PI / 8);
		const moonAperture: SDF = subtract(
			intersect(circle(mx, my, MOON_ORBIT_R + MOON_R + 0.1), (_, y) => my - y),
			circle(mx - MOON_ORBIT_R, my, hump),
			circle(mx + MOON_ORBIT_R, my, hump),
			circle(mx, my, MOON_ORBIT_R - MOON_R - 0.05),
		);
		const holes: SDF[] = [
			...AGE_WINDOW.xs.map((x) => winHole(x, AGE_WINDOW.y, AGE_WINDOW.w, AGE_WINDOW.h, 0.28)),
			...DAYS_WINDOW.xs.map((x) => winHole(x, DAYS_WINDOW.y, DAYS_WINDOW.w, DAYS_WINDOW.h, 0.16)),
			moonAperture,
			circle(0, 0, 1.3),
			circle(SUBDIALS.day.x, SUBDIALS.day.y, 0.42),
			circle(SUBDIALS.month.x, SUBDIALS.month.y, 0.42),
			circle(SUBDIALS.seconds.x, SUBDIALS.seconds.y, 0.3),
		];
		const sdf = subtract(circle(0, 0, DIAL_R), ...holes);
		const shapes = sdfShapes(sdf, { minX: -DIAL_R, minY: -DIAL_R, maxX: DIAL_R, maxY: DIAL_R }, 0.03);
		const mat = M.enamel.clone();
		mat.map = drawDial(config.signature, 4096);
		const m = slab(shapes, Z.dial, Z.dialTop, mat, M.enamelEdge, { bevel: 0.06, curveSegments: 3, smooth: true });
		m.receiveShadow = true;
		add({
			id: 'dial',
			name: 'Enamel dial',
			info: 'Grand feu enamel. Read together, the counters and hands give the owner’s exact age: years, days, hours, minutes and seconds.',
			group: 'dial',
			layer: 9,
			object: m,
		});
	}

	// ---------------------------------------------------------------- hands
	const handMesh = (sdf: SDF, bounds: { minX: number; minY: number; maxX: number; maxY: number }, z: number, mat: THREE.Material, thickness = 0.08) => {
		const shapes = sdfShapes(sdf, bounds, 0.018);
		const m = slab(shapes, z, z + thickness, mat, mat, { bevel: 0.02, smooth: true });
		m.castShadow = true;
		return m;
	};
	const hand = (id: string, name: string, info: string, object: THREE.Object3D, layer: number, angle: (s: WatchState, dt: number) => number, x = 0, y = 0) => {
		const g = new THREE.Group();
		g.position.set(x, y, 0);
		g.add(object);
		const part = add({ id, name, info, group: 'hands', layer, object: g });
		part.update = ({ state, dt }) => {
			g.rotation.z = angle(state, dt);
		};
		return g;
	};

	const hourSdf = smoothUnion(
		0.12,
		circle(0, 0, 1.0),
		capsule(0, 0, 0, 6.45, 0.36, 0.2),
		ring(0, 7.38, 0.8, 0.34),
		capsule(0, 8.1, 0, 10.55, 0.25, 0.025),
	);
	const minuteSdf = smoothUnion(
		0.1,
		circle(0, 0, 0.78),
		capsule(0, 0, 0, 12.05, 0.27, 0.15),
		ring(0, 12.78, 0.58, 0.26),
		capsule(0, 13.3, 0, 15.9, 0.18, 0.02),
	);
	const dateSdf = smoothUnion(
		0.08,
		circle(0, 0, 1.28),
		capsule(0, -3.3, 0, 15.4, 0.11, 0.09),
		circle(0, -3.3, 0.5),
		// Crescent pointing into the date track.
		intersect(ring(0, 15.95, 0.5, 0.15), (_, y) => 15.7 - y),
		capsule(0, 16.4, 0, 17.2, 0.13, 0.02),
	);
	const subSdf = (len: number, tail: number) =>
		smoothUnion(0.08, circle(0, 0, 0.42), capsule(0, -tail, 0, len, 0.12, 0.03), circle(0, -tail, 0.24));

	hand('dateHand', 'Date hand', 'Gold, on the date star’s pipe. It points to the day of the month on the outer track.', handMesh(dateSdf, { minX: -1.4, minY: -3.9, maxX: 1.4, maxY: 17.4 }, 0.62, M.gold), 10.4, (s, dt) => {
		updateCalendar(s, dt);
		return cal.date;
	});
	hand('hourHand', 'Hour hand', 'Breguet “pomme” hand in flame-blued steel.', handMesh(hourSdf, { minX: -1.3, minY: -1.2, maxX: 1.3, maxY: 10.8 }, 0.86, M.blued), 10.9, (s) => -TAU * turns(s.trainBeats, BEATS_PER_TURN.hour));
	hand('minuteHand', 'Minute hand', 'Breguet hand in flame-blued steel.', handMesh(minuteSdf, { minX: -1, minY: -1, maxX: 1, maxY: 16.1 }, 1.1, M.blued), 11.4, (s) => -TAU * turns(s.trainBeats, BEATS_PER_TURN.centre));
	{
		const cap = new THREE.Group();
		const capGeo = new THREE.SphereGeometry(0.55, 24, 12, 0, TAU, 0, Math.PI / 2);
		capGeo.rotateX(Math.PI / 2);
		const cm = mesh(capGeo, M.blued);
		cm.position.z = 1.18;
		cap.add(cm);
		hand('handCap', 'Centre cap', 'A decorative blued cap over the hand pipes; the hands themselves are friction-fitted.', cap, 11.6, () => 0);
	}
	const sec = SUBDIALS.seconds;
	hand('secondsHand', 'Small seconds', 'On the fourth wheel’s arbor; it ticks five times a second.', handMesh(subSdf(3.95, 1.1), { minX: -0.6, minY: -1.5, maxX: 0.6, maxY: 4.2 }, 0.5, M.blued, 0.06), 10.0, (s) => -TAU * turns(s.trainBeats, BEATS_PER_TURN.fourth), sec.x, sec.y);
	const day = SUBDIALS.day;
	hand('dayHand', 'Day hand', 'On the day star.', handMesh(subSdf(3.55, 0.9), { minX: -0.6, minY: -1.3, maxX: 0.6, maxY: 3.8 }, 0.5, M.blued, 0.06), 10.0, (s, dt) => {
		updateCalendar(s, dt);
		return cal.day;
	}, day.x, day.y);
	const mon = SUBDIALS.month;
	hand('monthHand', 'Month hand', 'On the month star.', handMesh(subSdf(3.55, 0.9), { minX: -0.6, minY: -1.3, maxX: 0.6, maxY: 3.8 }, 0.52, M.blued, 0.06), 10.0, (s, dt) => {
		updateCalendar(s, dt);
		return cal.month;
	}, mon.x, mon.y);
	hand('leapHand', 'Leap-year hand', 'On the 48-month cam: one turn every four years; L marks the leap year.', handMesh(smoothUnion(0.08, circle(0, 0, 0.36), capsule(0, 0, 0, 1.75, 0.13, 0.05)), { minX: -0.5, minY: -0.5, maxX: 0.5, maxY: 1.9 }, 0.44, M.blued, 0.06), 9.8, (s, dt) => {
		updateCalendar(s, dt);
		return cal.leap;
	}, mon.x, mon.y);

	return { parts };
}
