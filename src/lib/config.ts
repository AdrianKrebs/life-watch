// Everything that makes a life watch yours. Only `name` and `born` are
// required; the rest have sensible defaults derived from them.

export type Metal = 'yellow' | 'rose' | 'white';

export interface LifeWatchConfig {
	/** Owner's full name, e.g. "Ada Lovelace". */
	name: string;
	/** Birth date as YYYY-MM-DD. The age counters jump at local midnight on the birthday. */
	born: string;
	/** Place on the museum label, e.g. "Switzerland". */
	place?: string;
	/** Printed on the dial under XII. Defaults to "A. LOVELACE". */
	signature?: string;
	/** Engraved around the display back. */
	inscription?: string;
	/** Two lines engraved on the barrel bridge. */
	engraving?: [string, string];
	/** Case metal. */
	metal?: Metal;
	/** Colour of the champlevé enamel on the bezel and case band. */
	enamel?: string;
	/** Museum-style label shown with the full watch. */
	label?: {
		title?: string;
		subtitle?: string;
		lines?: string[];
		footnote?: string;
		inventory?: string;
	};
	/** Load Source Serif 4 / Source Sans 3 from Google Fonts if the page hasn't already. Default true. */
	loadFonts?: boolean;
}

export interface Birth {
	year: number;
	month: number; // 1..12
	day: number;
}

export interface ResolvedConfig {
	name: string;
	birth: Birth;
	born: string;
	place: string;
	signature: string;
	inscription: string;
	engraving: [string, string];
	metal: Metal;
	enamel: string;
	label: { title: string; subtitle: string; lines: string[]; footnote: string; inventory: string };
	loadFonts: boolean;
}

export const ENAMELS = {
	sky: '#35a9d4',
	lapis: '#1f4fa3',
	emerald: '#1f8a6a',
	oxblood: '#8c1c2b',
	black: '#1b1b20',
} as const;

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "24 September" */
export function birthdayLabel(b: Birth) {
	return `${b.day} ${MONTHS_LONG[b.month - 1]}`;
}

export function parseBirth(born: string): Birth | null {
	const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(born.trim());
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	const d = new Date(Date.UTC(year, month - 1, day));
	if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
	if (d.getTime() > Date.now()) return null;
	return { year, month, day };
}

/** "Ada Lovelace" → "A. LOVELACE"; single names stay as they are. */
export function defaultSignature(name: string) {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '';
	if (parts.length === 1) return parts[0].toUpperCase();
	const initials = parts
		.slice(0, -1)
		.map((p) => `${p[0].toUpperCase()}.`)
		.join(' ');
	return `${initials} ${parts[parts.length - 1].toUpperCase()}`;
}

export function resolveConfig(config: LifeWatchConfig): ResolvedConfig {
	const birth = parseBirth(config.born);
	if (!birth) throw new Error(`life-watch: "born" must be a past date as YYYY-MM-DD, got "${config.born}"`);
	const name = config.name.trim() || 'Anonymous';
	const signature = (config.signature ?? defaultSignature(name)).toUpperCase();
	const bornLong = `${birth.day} ${MONTHS_LONG[birth.month - 1]} ${birth.year}`;
	const place = config.place?.trim() ?? '';
	return {
		name,
		birth,
		born: config.born,
		place,
		signature,
		inscription: (config.inscription ?? `${name} · Born ${bornLong} · Life watch · Perpetual calendar`).toUpperCase(),
		engraving: config.engraving ?? [signature, `LIFE CALIBRE · Nº ${birth.year}`],
		metal: config.metal ?? 'yellow',
		enamel: config.enamel ?? ENAMELS.sky,
		label: {
			title: config.label?.title ?? 'Life watch with perpetual calendar',
			subtitle: config.label?.subtitle ?? `Made for ${name}`,
			lines: config.label?.lines ?? [place ? `${name} – ${place}` : name, `Movement ${birth.year}`],
			footnote: config.label?.footnote ?? 'Case 1, object 1',
			inventory: config.label?.inventory ?? `LW – ${String(birth.day).padStart(2, '0')}${String(birth.month).padStart(2, '0')}`,
		},
		loadFonts: config.loadFonts ?? true,
	};
}

/** A stable key for the parts of the config that change the model's geometry or textures. */
export function modelKey(c: ResolvedConfig) {
	return JSON.stringify([c.signature, c.inscription, c.engraving, c.metal, c.enamel]);
}

// Shareable links: ?name=Ada+Lovelace&born=1815-12-10&metal=rose&enamel=%23…

export function configFromParams(params: URLSearchParams): LifeWatchConfig | null {
	const name = params.get('name');
	const born = params.get('born');
	if (!name || !born || !parseBirth(born)) return null;
	const metal = params.get('metal');
	const enamel = params.get('enamel');
	return {
		name,
		born,
		place: params.get('place') ?? undefined,
		signature: params.get('signature') ?? undefined,
		inscription: params.get('inscription') ?? undefined,
		metal: metal === 'rose' || metal === 'white' || metal === 'yellow' ? metal : undefined,
		enamel: enamel && /^#[0-9a-f]{6}$/i.test(enamel) ? enamel : undefined,
	};
}

export function configToParams(c: LifeWatchConfig) {
	const p = new URLSearchParams();
	p.set('name', c.name);
	p.set('born', c.born);
	if (c.place) p.set('place', c.place);
	if (c.signature) p.set('signature', c.signature);
	if (c.inscription) p.set('inscription', c.inscription);
	if (c.metal && c.metal !== 'yellow') p.set('metal', c.metal);
	if (c.enamel && c.enamel !== ENAMELS.sky) p.set('enamel', c.enamel);
	return p;
}
