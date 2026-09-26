// Kept free of three.js so the page shell can load fonts before the 3D chunk arrives.

export const SERIF = '"Source Serif 4", Georgia, serif';
export const SANS = '"Source Sans 3", "Helvetica Neue", sans-serif';

const GOOGLE_FONTS =
	'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap';

/** Add the two families from Google Fonts unless the page already provides them. */
export function ensureFonts(): Promise<void> {
	if (typeof document === 'undefined') return Promise.resolve();
	const existing = document.querySelector<HTMLLinkElement>('link[data-life-watch-fonts]');
	if (existing) return (existing as HTMLLinkElement & { _ready?: Promise<void> })._ready ?? Promise.resolve();
	const has = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].some((l) => l.href.includes('Source+Serif+4'));
	if (has) return Promise.resolve();
	const link = document.createElement('link') as HTMLLinkElement & { _ready?: Promise<void> };
	link.rel = 'stylesheet';
	link.href = GOOGLE_FONTS;
	link.dataset.lifeWatchFonts = '';
	link._ready = new Promise((resolve) => {
		link.onload = () => resolve();
		link.onerror = () => resolve();
		setTimeout(resolve, 4000);
	});
	document.head.appendChild(link);
	return link._ready;
}

/** Make sure the dial's faces are ready before painting it into a texture. */
export async function prepareFonts(load: boolean) {
	if (load) await ensureFonts();
	await loadDialFonts();
}

export async function loadDialFonts() {
	if (typeof document === 'undefined' || !document.fonts) return;
	try {
		await Promise.all([
			document.fonts.load(`400 64px ${SERIF}`),
			document.fonts.load(`600 64px ${SERIF}`),
			document.fonts.load(`600 64px ${SANS}`),
			document.fonts.load(`400 64px ${SANS}`),
		]);
	} catch {
		// Fall back to system fonts; the dial still reads fine.
	}
}
