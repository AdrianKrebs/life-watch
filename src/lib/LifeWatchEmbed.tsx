import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { resolveConfig, type LifeWatchConfig } from './config';
import { prepareFonts } from './fonts';
import { createWatchStore, WatchStoreContext } from './store';
import type { Shared } from './WatchCanvas';

const WatchCanvas = lazy(() => import('./WatchCanvas'));

/**
 * The life watch as a live picture on another page (the About page). It sits
 * over a static poster of the same shot and fades in once it's rendering;
 * there are no controls, so it never gets in the way of scrolling.
 */
export interface LifeWatchEmbedProps {
	config: LifeWatchConfig;
}

export default function LifeWatchEmbed({ config }: LifeWatchEmbedProps) {
	const resolved = useMemo(() => resolveConfig(config), [config]);
	const store = useMemo(() => createWatchStore(), []);
	const [fonts, setFonts] = useState(false);
	const [ready, setReady] = useState(false);
	const shared = useRef<Shared>({ state: null, labels: new Map(), leaders: new Map(), labelLayer: null });
	const active = useRef(false);

	useEffect(() => {
		let ok = false;
		try {
			ok = !!document.createElement('canvas').getContext('webgl2');
		} catch {
			ok = false;
		}
		if (!ok) return;
		prepareFonts(resolved.loadFonts).then(() => setFonts(true));
	}, [resolved.loadFonts]);

	return (
		<div
			aria-hidden="true"
			onPointerEnter={() => (active.current = true)}
			onPointerLeave={() => (active.current = false)}
			style={{ position: 'absolute', inset: 0, opacity: ready ? 1 : 0, transition: 'opacity 0.8s ease' }}
		>
			{fonts && (
				<WatchStoreContext.Provider value={store}>
					<Suspense fallback={null}>
						<WatchCanvas shared={shared} config={resolved} mode="embed" pointerActive={active} onReady={() => setReady(true)} />
					</Suspense>
				</WatchStoreContext.Provider>
			)}
		</div>
	);
}
