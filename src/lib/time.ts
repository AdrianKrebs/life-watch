// Pure time model for the life watch.
//
// Every moving part is a function of one number: the simulated instant.
// Nothing accumulates frame to frame, so scrubbing, fast-forwarding and
// slow motion are all just "evaluate the watch at a different instant".

import type { Birth } from './config';

// 18,000 vph: the balance swings 2.5 times per second, five beats per second.
export const BEATS_PER_SECOND = 5;
export const BALANCE_AMPLITUDE = (280 * Math.PI) / 180;
/** Balance lift: the arc during which the impulse pin is inside the fork slot. */
export const LIFT_ANGLE = (44 * Math.PI) / 180; // 10.25° fork travel × lever length / impulse radius
/** Fork travel bank to bank is 10.25°; it rests on a banking pin either side. */
export const FORK_BANKING = (5.125 * Math.PI) / 180;
/** Beats in one day; every train period divides it, so wheel phases stay exact. */
export const BEATS_PER_DAY = 432_000;

const DAY_MS = 86_400_000;
const SYNODIC_MONTH_DAYS = 29.530588853;
// A well-known new moon: 2000-01-06 18:14 UTC.
const NEW_MOON_REF_MS = Date.UTC(2000, 0, 6, 18, 14);

export interface WatchState {
	/** Balance angle in radians (sinusoid through the impulse point). */
	balance: number;
	/** Pallet fork angle in radians, between the banking pins. */
	fork: number;
	/** Going train position in beats, stepped like the real escapement. */
	trainBeats: number;
	/** Beat index since the local epoch, used for audio. */
	beatIndex: number;

	/** Local time of day in seconds (stepped with the train). */
	secondsOfDay: number;

	// Calendar, as cumulative counts so every star turns forwards only.
	/** Date star: 31 teeth per month, exactly one turn per calendar month. */
	dateSteps: number;
	/** Day star: one tooth per day. */
	daySteps: number;
	/** Month star: one tooth per month. */
	monthSteps: number;
	/** 48-month cam position (0..47) within the leap cycle. */
	leapCycleMonth: number;
	/** Moon phase, 0 = new, 0.5 = full. */
	moonPhase: number;

	year: number;
	month: number; // 1..12
	date: number; // 1..31
	weekday: number; // 0 = Sunday
	daysInMonth: number;
	yearInLeapCycle: number; // 0..3, 3 = leap year

	ageYears: number;
	daysLived: number;
	/** Days since the most recent birthday, 0 on the day itself. */
	daysSinceBirthday: number;
	/** Precise age in years (365.25-day years), matching the About page. */
	ageExact: number;
	/** Grand lever lift over the day (0 at midnight, 1 just before). */
	leverLift: number;
}

/** Milliseconds since 1970-01-01 in local wall-clock time. */
export function localMs(ms: number) {
	return ms - new Date(ms).getTimezoneOffset() * 60_000;
}

const smoothstep = (a: number, b: number, x: number) => {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Swiss lever phases (Playtner's club-tooth figures), as the escape wheel's
 * progress through one beat (0 → 1 = 12°) given the fork's progress q:
 * unlocking (lever 0 → 1.5°, the wheel recoils slightly from the draw),
 * impulse on the pallet (1.5 → 7°, wheel 0 → 6°), impulse on the tooth
 * (7 → 10°, wheel 6 → 10.5°), then the 1.5° drop onto the other pallet.
 */
function escapeProgress(q: number, dropT: number) {
	const lock = 1.5 / 10.25;
	const pallet = 7 / 10.25;
	const tooth = 10 / 10.25;
	if (q <= 0) return 0;
	if (q < lock) return -0.02 * Math.sin((q / lock) * Math.PI);
	if (q < pallet) return (6 / 12) * ((q - lock) / (pallet - lock));
	if (q < tooth) return 0.5 + (4.5 / 12) * ((q - pallet) / (tooth - pallet));
	return 0.875 + 0.125 * smoothstep(0, 1, dropT);
}

function daysInMonth(year: number, month: number) {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function dayNumber(year: number, month: number, day: number) {
	return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}


/**
 * Evaluate the watch at a simulated instant.
 * `freeBalanceMs`: when fast-forwarding the escapement can't be shown
 * truthfully, so the balance keeps swinging on real time instead and the
 * train runs continuously.
 */
export function watchState(simMs: number, birth: Birth, freeBalanceMs?: number): WatchState {
	const L = localMs(simMs);
	const beatsExact = (L / 1000) * BEATS_PER_SECOND;

	let trainBeats: number;
	let fork: number;
	let balance = 0;
	let beatIndex: number;

	if (freeBalanceMs === undefined) {
		// Beat n happens as the balance passes its dead point at u = n, swinging
		// in direction σ. φ is the balance angle measured along that swing.
		const n = Math.round(beatsExact);
		const sigma = n % 2 === 0 ? 1 : -1;
		const d = beatsExact - n; // -0.5 .. 0.5
		const phi = BALANCE_AMPLITUDE * Math.sin(Math.PI * d);
		balance = sigma * phi;
		const q = clamp01((phi + LIFT_ANGLE / 2) / LIFT_ANGLE);
		// The drop is a free fall lasting ~3° of balance rotation after the tooth leaves.
		const toothLeaves = -LIFT_ANGLE / 2 + (10 / 10.25) * LIFT_ANGLE;
		const dropT = clamp01((phi - toothLeaves) / ((3 * Math.PI) / 180));
		trainBeats = n - 1 + escapeProgress(q, dropT);
		// The fork follows the impulse pin, turning against the balance.
		fork = sigma * FORK_BANKING * (1 - 2 * q);
		beatIndex = q >= 0.5 ? n : n - 1;
	} else {
		trainBeats = beatsExact;
		const u = (freeBalanceMs / 1000) * BEATS_PER_SECOND;
		balance = BALANCE_AMPLITUDE * Math.sin(Math.PI * (u % 2));
		fork = -FORK_BANKING * Math.tanh(Math.sin(Math.PI * (u % 2)) * 8);
		beatIndex = Math.floor(beatsExact);
	}

	// Local calendar fields.
	const date = new Date(L);
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth() + 1;
	const day = date.getUTCDate();
	const weekday = date.getUTCDay();
	const dayNum = Math.floor(L / DAY_MS);
	const monthIndex = (year - 1970) * 12 + (month - 1);

	// Time of day, driven by the (stepped) train so hands and wheels agree.
	const trainSeconds = trainBeats / BEATS_PER_SECOND;
	const secondsOfDay = trainSeconds - dayNum * 86_400;

	let ageYears = year - birth.year;
	if (month < birth.month || (month === birth.month && day < birth.day)) ageYears -= 1;

	const birthMs = new Date(birth.year, birth.month - 1, birth.day).getTime();
	const ageExact = (simMs - birthMs) / (DAY_MS * 365.25);

	const yearInLeapCycle = (((year - 1) % 4) + 4) % 4;

	return {
		balance,
		fork,
		trainBeats,
		beatIndex,
		secondsOfDay,
		dateSteps: monthIndex * 31 + (day - 1),
		daySteps: dayNum,
		monthSteps: monthIndex,
		leapCycleMonth: yearInLeapCycle * 12 + (month - 1),
		moonPhase: ((((simMs - NEW_MOON_REF_MS) / DAY_MS / SYNODIC_MONTH_DAYS) % 1) + 1) % 1,
		year,
		month,
		date: day,
		weekday,
		daysInMonth: daysInMonth(year, month),
		yearInLeapCycle,
		ageYears,
		daysLived: dayNum - dayNumber(birth.year, birth.month, birth.day),
		daysSinceBirthday: daysSince(year, month, day, birth),
		ageExact,
		leverLift: secondsOfDay / 86_400,
	};
}

/**
 * Turns of an arbor given the train position and its beats per revolution.
 * Reduced modulo one day of beats first, which every period divides, so
 * meshing wheels stay in phase however large the beat count gets.
 */
export function turns(trainBeats: number, beatsPerTurn: number) {
	const whole = Math.floor(trainBeats);
	const frac = trainBeats - whole;
	const n = ((whole % BEATS_PER_DAY) + BEATS_PER_DAY) % BEATS_PER_DAY;
	return (n + frac) / beatsPerTurn;
}

/** The next local instant `secondsBefore` seconds ahead of the given local date/time. */
export function localInstant(year: number, month: number, day: number, h = 0, m = 0, s = 0) {
	return new Date(year, month - 1, day, h, m, s).getTime();
}

/** Days since the most recent birthday. */
function daysSince(year: number, month: number, day: number, birth: Birth) {
	const today = Date.UTC(year, month - 1, day);
	let y = year;
	let b = birthdayIn(y, birth);
	if (today < Date.UTC(y, b.month - 1, b.day)) {
		y -= 1;
		b = birthdayIn(y, birth);
	}
	return Math.round((today - Date.UTC(y, b.month - 1, b.day)) / DAY_MS);
}

/** Where the birthday falls in a given year: 29 February is kept on 1 March in common years. */
function birthdayIn(year: number, birth: Birth) {
	if (birth.month === 2 && birth.day === 29 && daysInMonth(year, 2) === 28) return { month: 3, day: 1 };
	return { month: birth.month, day: birth.day };
}

export function nextBirthdayEve(fromMs: number, birth: Birth, lead = 12) {
	const now = new Date(fromMs);
	let y = now.getFullYear();
	const at = (year: number) => {
		const b = birthdayIn(year, birth);
		return localInstant(year, b.month, b.day) - lead * 1000;
	};
	let t = at(y);
	if (t <= fromMs) t = at(y + 1);
	return t;
}

export function nextLeapDayEve(fromMs: number, lead = 12) {
	let y = new Date(fromMs).getFullYear();
	for (;;) {
		if (daysInMonth(y, 2) === 29) {
			const t = localInstant(y, 2, 29) - lead * 1000;
			if (t > fromMs) return t;
		}
		y += 1;
	}
}

/** Feb 28 → Mar 1 in a common year: the date star jumps four teeth, past 29, 30 and 31. */
export function nextShortFebruaryEnd(fromMs: number, lead = 12) {
	let y = new Date(fromMs).getFullYear();
	for (;;) {
		if (daysInMonth(y, 2) === 28) {
			const t = localInstant(y, 3, 1) - lead * 1000;
			if (t > fromMs) return t;
		}
		y += 1;
	}
}

export function nextMonthEnd(fromMs: number, lead = 12) {
	const d = new Date(fromMs);
	let t = localInstant(d.getFullYear(), d.getMonth() + 2, 1) - lead * 1000;
	if (t <= fromMs) t = localInstant(d.getFullYear(), d.getMonth() + 3, 1) - lead * 1000;
	return t;
}

export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
