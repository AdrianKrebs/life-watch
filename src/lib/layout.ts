// Shared dimensions of the life watch, in millimetres.
// Coordinates are seen from the dial: +x towards 3 o'clock, +y towards 12,
// +z towards the viewer. The crown and bow sit at 12 (a Lépine pocket watch).

export const DIAL_R = 19;
export const MOVEMENT_R = 18.6;
export const CASE_R = 22.4;
export const SUB_DIST = 8.2;
export const SUB_R = 4.35;

export const SUBDIALS = {
	day: { x: -SUB_DIST, y: 0 },
	month: { x: SUB_DIST, y: 0 },
	seconds: { x: 0, y: -SUB_DIST },
} as const;

// Life counters in the 12 o'clock cartouche: years (two big-date discs) and
// days since the last birthday (three drums). With the hands, the watch
// reads its owner's exact age.
// The discs overlap, tens above units; centres and radius are chosen so
// each disc fills its own window and stays clear of the other one.
export const AGE_WINDOW = { y: 10.05, w: 1.8, h: 2.2, xs: [-1.55, 1.55] };
export const AGE_DISCS = [
	{ x: -4.6, y: 12.05, window: -1.55 },
	{ x: 4.6, y: 12.05, window: 1.55 },
];
export const AGE_DISC_R = 5.17;
export const DAYS_WINDOW = { y: 6.2, w: 1.12, h: 1.2, xs: [-1.34, 0, 1.34] };
export const DAYS_DRUM_R = 1.75;
export const DAYS_DRUM_W = 1.22;
export const CARTOUCHE = { y: 8.05, w: 7.6, h: 7.0 };

// Moon aperture inside the small seconds subdial, above its centre.
export const MOON_DISC_R = 3.75;
export const MOON_ORBIT_R = 2.3;
export const MOON_R = 0.98;

// Z levels (front → back).
export const Z = {
	crystalRim: 2.55,
	crystalApex: 4.35,
	bezelTop: 3.0,
	caseTop: 1.2,
	dialTop: 0.4,
	dial: 0,
	mainPlateFront: -2.6,
	mainPlateBack: -4.4,
	bridgesFront: -8.3,
	bridgesBack: -9.6,
	cockBack: -10.35,
	caseBack: -12.2,
};

/**
 * Going train for 18,000 vph (seen from the dial):
 * barrel 96 → centre pinion 12, centre 80 → third pinion 10,
 * third 60 → fourth pinion 8, fourth 70 → escape pinion 7, escape wheel 15.
 * Modules are chosen so the pitch circles of each pair touch exactly.
 */
export const TRAIN = {
	barrel: { x: -1.594, y: 9.04, teeth: 96, module: 0.17 },
	centre: { x: 0, y: 0, teeth: 80, module: 0.13, pinion: 12, pinionModule: 0.17 },
	third: { x: -2.734, y: -5.172, teeth: 60, module: 0.12, pinion: 10, pinionModule: 0.13 },
	fourth: { x: 0, y: -8.2, teeth: 70, module: 0.1, pinion: 8, pinionModule: 0.12 },
	escape: { x: 3.489, y: -9.827, teeth: 15, radius: 3.1, pinion: 7, pinionModule: 0.1 },
	// Pallet arbor at R / cos 30° from the escape wheel, on a 45° line of centres.
	pallet: { x: 6.02, y: -7.296 },
	// Balance on the same line, one lever length plus the impulse radius further.
	balance: { x: 9.138, y: -4.178, radius: 6.1 },
	impulseRadius: 0.83,
	lineOfCentres: Math.PI / 4,
};

// Beats per turn at 18,000 vph (5 beats per second).
export const BEATS_PER_TURN = {
	escape: 30, // 12° per beat, 15 teeth
	fourth: 300, // one turn per minute
	third: 2250, // 7.5 minutes
	centre: 18_000, // one hour
	barrel: 144_000, // eight hours
	hour: 216_000, // twelve hours
	day: 432_000, // 24 hours
};

// Motion works: cannon pinion 12 → minute wheel 36 / pinion 10 → hour wheel 40.
// The calendar is driven off the hour wheel through a 20-tooth idler into
// a 24-hour wheel of 80 teeth that carries the snail lifting the grand lever.
export const MOTION = {
	cannon: { teeth: 12, module: 0.15 },
	minuteWheel: { x: -3.383, y: 1.231, teeth: 36, module: 0.15, pinion: 10, pinionModule: 0.144 },
	hourWheel: { teeth: 40, module: 0.144 },
	idler: { x: -3.055, y: -3.055, teeth: 20, module: 0.144 },
	dayWheel: { x: -8.146, y: -8.146, teeth: 80, module: 0.144 },
};

export const CALENDAR = {
	dateStar: { teeth: 31, r: 4.25 },
	dayStar: { teeth: 7, r: 2.2, ...SUBDIALS.day },
	monthStar: { teeth: 12, r: 2.45, ...SUBDIALS.month },
	leapCam: { r: 3.3, ...SUBDIALS.month },
	grandLeverPivot: { x: -14.1, y: -3.2 },
};
