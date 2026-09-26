import * as THREE from 'three';
import {
	AGE_WINDOW,
	CARTOUCHE,
	DAYS_WINDOW,
	DIAL_R,
	MOON_ORBIT_R,
	MOON_R,
	SUB_R,
	SUBDIALS,
} from './layout';
import { MONTHS, WEEKDAYS } from './time';

// The dial artwork is painted once into a canvas in dial millimetres and
// mapped onto the enamel with planar UVs (x, y ∈ [-20, 20]).

const SPAN = 40;
import { SANS, SERIF } from './fonts';

export const INK = '#17171c';
export const RED = '#9b1c1f';
const ENAMEL = '#fbf8f0';

type Ctx = CanvasRenderingContext2D;

/** Canvas in dial millimetres: origin at the centre, +y up. */
function mmCanvas(size: number) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const s = size / SPAN;
	ctx.setTransform(s, 0, 0, -s, size / 2, size / 2);
	return { canvas, ctx, pxPerMm: s };
}

function text(
	ctx: Ctx,
	str: string,
	x: number,
	y: number,
	size: number,
	opts: { font?: string; weight?: number; angle?: number; color?: string; spacing?: number } = {},
) {
	ctx.save();
	ctx.translate(x, y);
	ctx.rotate(opts.angle ?? 0);
	ctx.scale(1, -1);
	ctx.fillStyle = opts.color ?? INK;
	ctx.font = `${opts.weight ?? 400} ${size}px ${opts.font ?? SERIF}`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	if (opts.spacing) {
		// letterSpacing is in CSS px of the canvas; express it in mm here.
		(ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${opts.spacing}px`;
	}
	ctx.fillText(str, 0, 0);
	ctx.restore();
}

/** Text whose baseline points to the centre, placed on a radius at a clock angle. */
function radialText(ctx: Ctx, str: string, cx: number, cy: number, r: number, clockAngle: number, size: number, opts = {}) {
	const a = Math.PI / 2 - clockAngle;
	text(ctx, str, cx + r * Math.cos(a), cy + r * Math.sin(a), size, { ...opts, angle: -clockAngle });
}

function ticks(ctx: Ctx, cx: number, cy: number, n: number, r0: number, r1: number, width: number, every = 1, skip?: (i: number) => boolean) {
	ctx.lineWidth = width;
	ctx.beginPath();
	for (let i = 0; i < n; i += every) {
		if (skip?.(i)) continue;
		const a = Math.PI / 2 - (i / n) * Math.PI * 2;
		ctx.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a));
		ctx.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a));
	}
	ctx.stroke();
}

function ringStroke(ctx: Ctx, cx: number, cy: number, r: number, width: number) {
	ctx.lineWidth = width;
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.stroke();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.roundRect(x - w / 2, y - h / 2, w, h, r);
}

/** Subdial with a fine circular azurage and a slightly cooler tone. */
function subdialGround(ctx: Ctx, cx: number, cy: number, r: number) {
	ctx.save();
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.clip();
	ctx.fillStyle = '#f3f0e8';
	ctx.fill();
	ctx.strokeStyle = 'rgba(40, 36, 30, 0.07)';
	ctx.lineWidth = 0.028;
	for (let rr = 0.12; rr < r; rr += 0.085) ringStroke(ctx, cx, cy, rr, 0.028);
	ctx.restore();
	ctx.strokeStyle = INK;
	ringStroke(ctx, cx, cy, r, 0.05);
}

/** Roman numerals the way enamel painters drew them: tall, radial, fine serifs. */
const ROMAN = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

export function drawDial(signature: string, size = 4096) {
	const { canvas, ctx } = mmCanvas(size);

	// Enamel ground with a very soft falloff towards the edge.
	ctx.fillStyle = '#e9e4d8';
	ctx.fillRect(-SPAN / 2, -SPAN / 2, SPAN, SPAN);
	const g = ctx.createRadialGradient(0, 0, 0, 0, 0, DIAL_R);
	g.addColorStop(0, ENAMEL);
	g.addColorStop(0.85, '#f8f4ea');
	g.addColorStop(1, '#efe9dc');
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.arc(0, 0, DIAL_R, 0, Math.PI * 2);
	ctx.fill();

	ctx.strokeStyle = INK;
	ctx.fillStyle = INK;

	// Outer date track 1–31, in red, for the central date hand.
	const dateR = 17.72;
	ringStroke(ctx, 0, 0, 18.5, 0.06);
	ringStroke(ctx, 0, 0, 16.95, 0.05);
	for (let d = 1; d <= 31; d++) {
		const a = ((d - 1) / 31) * Math.PI * 2;
		radialText(ctx, String(d), 0, 0, dateR, a, 0.92, { color: RED, weight: 600, font: SANS });
		const b = a + Math.PI / 31;
		const x = Math.sin(b);
		const y = Math.cos(b);
		ctx.fillStyle = RED;
		ctx.beginPath();
		ctx.arc(x * dateR, y * dateR, 0.08, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.fillStyle = INK;

	// Railway minute track.
	ringStroke(ctx, 0, 0, 16.55, 0.045);
	ringStroke(ctx, 0, 0, 16.05, 0.045);
	ticks(ctx, 0, 0, 60, 16.05, 16.55, 0.05);
	ticks(ctx, 0, 0, 60, 15.85, 16.75, 0.16, 5);

	// Roman hours.
	for (let h = 0; h < 12; h++) {
		const a = (h / 12) * Math.PI * 2;
		const r = 14.4;
		const numeral = ROMAN[h];
		radialText(ctx, numeral, 0, 0, r, a, 2.75, { weight: 400, spacing: 0.02 });
	}

	// Signature under the cartouche.
	// Long names get a smaller, tighter signature so they fit under XII.
	const sigSize = signature.length > 14 ? Math.max(0.5, 0.78 * (14 / signature.length)) : 0.78;
	text(ctx, signature, 0, 11.95, sigSize, { font: SANS, weight: 600, spacing: signature.length > 14 ? 0.08 : 0.16 });

	// Cartouche for the life counters: years and days of age.
	ctx.lineWidth = 0.05;
	roundRect(ctx, 0, CARTOUCHE.y, CARTOUCHE.w, CARTOUCHE.h, 0.7);
	ctx.stroke();
	roundRect(ctx, 0, CARTOUCHE.y, CARTOUCHE.w - 0.32, CARTOUCHE.h - 0.32, 0.55);
	ctx.lineWidth = 0.025;
	ctx.stroke();
	// Bar between the two age windows, as on a big date.
	ctx.fillStyle = INK;
	ctx.fillRect(-0.05, AGE_WINDOW.y - AGE_WINDOW.h / 2 - 0.1, 0.1, AGE_WINDOW.h + 0.2);
	for (const x of AGE_WINDOW.xs) {
		roundRect(ctx, x, AGE_WINDOW.y, AGE_WINDOW.w + 0.22, AGE_WINDOW.h + 0.22, 0.18);
		ctx.lineWidth = 0.07;
		ctx.stroke();
	}
	for (const x of DAYS_WINDOW.xs) {
		roundRect(ctx, x, DAYS_WINDOW.y, DAYS_WINDOW.w + 0.18, DAYS_WINDOW.h + 0.18, 0.12);
		ctx.lineWidth = 0.05;
		ctx.stroke();
	}
	text(ctx, 'YEARS', 0, 7.78, 0.56, { font: SANS, weight: 600, spacing: 0.1 });
	text(ctx, 'DAYS', 0, 5.05, 0.5, { font: SANS, weight: 600, spacing: 0.1 });

	// Day of week at 9.
	{
		const { x, y } = SUBDIALS.day;
		subdialGround(ctx, x, y, SUB_R);
		ticks(ctx, x, y, 7, SUB_R - 0.55, SUB_R - 0.12, 0.09);
		ticks(ctx, x, y, 28, SUB_R - 0.35, SUB_R - 0.12, 0.035, 1, (i) => i % 4 === 0);
		WEEKDAYS.forEach((d, i) => {
			const a = (i / 7) * Math.PI * 2;
			radialText(ctx, d, x, y, SUB_R - 1.22, a, 0.66, {
				font: SANS,
				weight: 600,
				color: i === 0 ? RED : INK,
				spacing: 0.04,
			});
		});
	}

	// Month at 3, with the four-year leap cycle in the centre.
	{
		const { x, y } = SUBDIALS.month;
		subdialGround(ctx, x, y, SUB_R);
		ticks(ctx, x, y, 12, SUB_R - 0.5, SUB_R - 0.12, 0.08);
		MONTHS.forEach((m, i) => {
			const a = ((i + 0.5) / 12) * Math.PI * 2;
			radialText(ctx, m, x, y, SUB_R - 1.05, a, 0.5, { font: SANS, weight: 600, spacing: 0.02 });
		});
		ringStroke(ctx, x, y, 2.2, 0.04);
		ctx.fillStyle = '#ebe6da';
		ctx.beginPath();
		ctx.arc(x, y, 2.18, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = INK;
		ticks(ctx, x, y, 4, 1.95, 2.18, 0.06);
		['1', '2', '3', 'L'].forEach((l, i) => {
			const a = ((i + 0.5) / 4) * Math.PI * 2;
			radialText(ctx, l, x, y, 1.45, a, 0.62, { font: SANS, weight: 600, color: l === 'L' ? RED : INK });
		});
	}

	// Small seconds at 6, around the moon aperture.
	{
		const { x, y } = SUBDIALS.seconds;
		subdialGround(ctx, x, y, SUB_R);
		ticks(ctx, x, y, 60, SUB_R - 0.42, SUB_R - 0.12, 0.035);
		ticks(ctx, x, y, 60, SUB_R - 0.7, SUB_R - 0.12, 0.085, 5);
		for (const [s, label] of [
			[15, '15'],
			[30, '30'],
			[45, '45'],
		] as const) {
			const a = (s / 60) * Math.PI * 2;
			radialText(ctx, label, x, y, SUB_R - 1.2, a, 0.7, { font: SANS, weight: 600 });
		}
		// Gold-leaf frame around the moon aperture is part of the dial geometry.
	}

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	texture.generateMipmaps = true;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	return texture;
}

/**
 * Numerals printed around a counter drum, 10 per turn. The canvas has square
 * texels: u runs around the circumference, v along the drum's axis.
 */
export function drawDrum(circumference: number, width: number, pxPerMm = 190) {
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(circumference * pxPerMm);
	canvas.height = Math.round(width * pxPerMm);
	const ctx = canvas.getContext('2d')!;
	ctx.fillStyle = '#f6f2e9';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	const cell = canvas.width / 10;
	ctx.fillStyle = INK;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.font = `600 ${cell * 0.92}px ${SERIF}`;
	for (let i = 0; i < 10; i++) {
		ctx.save();
		ctx.translate((i + 0.5) * cell, canvas.height / 2);
		// Seen through the window, the circumference runs vertically.
		ctx.rotate(-Math.PI / 2);
		ctx.fillText(String(i), 0, cell * 0.05);
		ctx.restore();
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

/**
 * Big-date style disc: ten numerals around the rim. Digit i is printed at
 * `windowAngle + i·36°`, turned so it stands upright once the disc has been
 * rotated clockwise by i·36° into the window.
 */
export function drawAgeDisc(windowAngle: number, digitRadius: number, discR: number, size = 1536) {
	const span = discR * 2 + 0.4;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const s = size / span;
	ctx.setTransform(s, 0, 0, -s, size / 2, size / 2);
	ctx.fillStyle = '#f7f3ea';
	ctx.fillRect(-span / 2, -span / 2, span, span);
	for (let i = 0; i < 10; i++) {
		const a = windowAngle + (i * Math.PI) / 5;
		text(ctx, String(i), digitRadius * Math.cos(a), digitRadius * Math.sin(a), 2.05, { weight: 600, angle: (i * Math.PI) / 5 });
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return { texture, span };
}

/** Champlevé enamel band: sky-blue enamel with a black meander between gold fillets. */
export function drawMeander(enamel = '#35a9d4', tileW = 256, tileH = 128) {
	const canvas = document.createElement('canvas');
	canvas.width = tileW;
	canvas.height = tileH;
	const ctx = canvas.getContext('2d')!;
	ctx.clearRect(0, 0, tileW, tileH);
	const m = tileH * 0.16; // gold fillets top and bottom stay transparent
	ctx.fillStyle = enamel;
	ctx.fillRect(0, m, tileW, tileH - 2 * m);
	// Subtle depth variation in the enamel.
	const g = ctx.createLinearGradient(0, m, 0, tileH - m);
	g.addColorStop(0, 'rgba(255,255,255,0.12)');
	g.addColorStop(0.5, 'rgba(255,255,255,0)');
	g.addColorStop(1, 'rgba(0,30,60,0.18)');
	ctx.fillStyle = g;
	ctx.fillRect(0, m, tileW, tileH - 2 * m);
	// Greek key, one period per tile.
	const h = tileH - 2 * m;
	const u = h / 5;
	ctx.strokeStyle = '#111317';
	ctx.lineWidth = u * 0.62;
	ctx.lineCap = 'square';
	ctx.lineJoin = 'miter';
	const period = tileW;
	for (let k = 0; k < 1; k++) {
		const x0 = k * period + u * 0.8;
		const y0 = m + u * 0.6;
		const w = period - u * 1.6;
		const p = (fx: number, fy: number): [number, number] => [x0 + fx * w, y0 + fy * (h - u * 1.2)];
		ctx.beginPath();
		const path: [number, number][] = [
			[0, 1], [0, 0], [0.8, 0], [0.8, 0.75], [0.3, 0.75], [0.3, 0.35], [0.55, 0.35],
		];
		path.forEach(([fx, fy], i) => (i === 0 ? ctx.moveTo(...p(fx, fy)) : ctx.lineTo(...p(fx, fy))));
		ctx.moveTo(...p(0, 1));
		ctx.lineTo(...p(1.08, 1));
		ctx.stroke();
		// Small diamond between keys, like the box's enamel.
		ctx.fillStyle = '#111317';
		const [cx, cy] = p(0.99, 0.42);
		ctx.beginPath();
		ctx.moveTo(cx, cy - u * 0.9);
		ctx.lineTo(cx + u * 0.6, cy);
		ctx.lineTo(cx, cy + u * 0.9);
		ctx.lineTo(cx - u * 0.6, cy);
		ctx.closePath();
		ctx.fill();
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.RepeatWrapping;
	texture.anisotropy = 8;
	return texture;
}

/** Engraved inscription around the case back ring. */
export function drawCasebackRing(rOuter: number, rInner: number, inscription: string, size = 2048) {
	const span = rOuter * 2;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const s = size / span;
	ctx.setTransform(s, 0, 0, -s, size / 2, size / 2);
	ctx.clearRect(-span, -span, span * 2, span * 2);
	const r = (rOuter + rInner) / 2;
	const chars = inscription.split('');
	const total = Math.PI * 2;
	ctx.fillStyle = '#6b4a12';
	chars.forEach((ch, i) => {
		const a = Math.PI / 2 - (i / chars.length) * total;
		text(ctx, ch, r * Math.cos(a), r * Math.sin(a), (rOuter - rInner) * 0.5, { weight: 600, angle: a - Math.PI / 2, font: SANS });
	});
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

/** Night-sky moon disc: deep enamel blue, gilt stars, two moons. */
export function drawMoonDisc(size = 1024) {
	const { canvas, ctx } = mmCanvas(size);
	// This canvas spans 40 mm; the disc only needs ±4 mm, so zoom in.
	const zoom = SPAN / 8;
	ctx.scale(zoom, zoom);
	const bg = ctx.createRadialGradient(0, 0, 0.5, 0, 0, 4);
	bg.addColorStop(0, '#17306e');
	bg.addColorStop(1, '#0b1a45');
	ctx.fillStyle = bg;
	ctx.fillRect(-4, -4, 8, 8);
	let seed = 7;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	ctx.fillStyle = '#e8c878';
	for (let i = 0; i < 70; i++) {
		const a = rnd() * Math.PI * 2;
		const r = 0.4 + rnd() * 3.3;
		const x = r * Math.cos(a);
		const y = r * Math.sin(a);
		// Keep stars off the moons.
		const onMoon = [0, Math.PI].some((m) => Math.hypot(x - MOON_ORBIT_R * Math.cos(m + Math.PI / 2), y - MOON_ORBIT_R * Math.sin(m + Math.PI / 2)) < MOON_R + 0.2);
		if (onMoon) continue;
		star(ctx, x, y, 0.05 + rnd() * 0.08);
	}
	for (const m of [Math.PI / 2, -Math.PI / 2]) {
		const x = MOON_ORBIT_R * Math.cos(m);
		const y = MOON_ORBIT_R * Math.sin(m);
		const mg = ctx.createRadialGradient(x - 0.3, y + 0.3, 0.1, x, y, MOON_R);
		mg.addColorStop(0, '#fbe7a6');
		mg.addColorStop(0.7, '#e2b75a');
		mg.addColorStop(1, '#b98a33');
		ctx.fillStyle = mg;
		ctx.beginPath();
		ctx.arc(x, y, MOON_R, 0, Math.PI * 2);
		ctx.fill();
		// A few soft maria.
		ctx.fillStyle = 'rgba(150, 105, 35, 0.22)';
		for (const [dx, dy, r] of [
			[-0.25, 0.2, 0.28],
			[0.2, -0.15, 0.2],
			[0.3, 0.35, 0.14],
			[-0.1, -0.4, 0.16],
		]) {
			ctx.beginPath();
			ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

function star(ctx: Ctx, x: number, y: number, r: number) {
	ctx.beginPath();
	for (let i = 0; i < 10; i++) {
		const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
		const rr = i % 2 === 0 ? r : r * 0.42;
		ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
	}
	ctx.closePath();
	ctx.fill();
}
