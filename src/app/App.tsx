import { useEffect, useMemo, useState } from 'react';
import { configFromParams, configToParams, ENAMELS, LifeWatch, LifeWatchEmbed, parseBirth, type LifeWatchConfig, type Metal } from '../lib';

const REPO = 'https://github.com/AdrianKrebs/life-watch';
const EXAMPLE: LifeWatchConfig = { name: 'Jane Doe', born: '1990-06-15' };

function useSearchParams() {
	const [params, setParams] = useState(() => new URLSearchParams(window.location.search));
	useEffect(() => {
		const on = () => setParams(new URLSearchParams(window.location.search));
		window.addEventListener('popstate', on);
		return () => window.removeEventListener('popstate', on);
	}, []);
	const navigate = (p: URLSearchParams | null) => {
		const url = p && [...p.keys()].length ? `?${p}` : window.location.pathname;
		window.history.pushState(null, '', url);
		setParams(new URLSearchParams(window.location.search));
		window.scrollTo(0, 0);
	};
	return [params, navigate] as const;
}

function useDebounced<T>(value: T, ms: number) {
	const [v, setV] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return v;
}

export default function App() {
	const [params, navigate] = useSearchParams();
	const config = useMemo(() => configFromParams(params), [params]);
	if (config && !params.has('edit')) {
		return <WatchPage config={config} onEdit={() => navigate(new URLSearchParams([...configToParams(config), ['edit', '1']]))} onNew={() => navigate(null)} />;
	}
	return <Maker initial={config ?? undefined} onOpen={(c) => navigate(configToParams(c))} />;
}

function WatchPage({ config, onEdit, onNew }: { config: LifeWatchConfig; onEdit: () => void; onNew: () => void }) {
	const [copied, setCopied] = useState(false);
	const share = async () => {
		const url = window.location.href;
		if (navigator.share) {
			try {
				await navigator.share({ title: `${config.name}'s life watch`, url });
				return;
			} catch {
				// fall through to copying
			}
		}
		await navigator.clipboard.writeText(url);
		setCopied(true);
		setTimeout(() => setCopied(false), 1800);
	};
	useEffect(() => {
		document.title = `${config.name}'s life watch`;
	}, [config.name]);
	return (
		<div className="page watch-page">
			<header className="bar">
				<button type="button" className="brand" onClick={onNew}>
					Life watch
				</button>
				<nav>
					<button type="button" onClick={onEdit}>
						Edit
					</button>
					<button type="button" onClick={share}>
						{copied ? 'Link copied' : 'Share'}
					</button>
					<button type="button" className="primary" onClick={onNew}>
						Make your own
					</button>
				</nav>
			</header>
			<LifeWatch config={config} className="app-stage" />
		</div>
	);
}

const METALS: { id: Metal; label: string; swatch: string }[] = [
	{ id: 'yellow', label: 'Yellow gold', swatch: 'linear-gradient(135deg,#f6dc93,#c49a3c)' },
	{ id: 'rose', label: 'Rose gold', swatch: 'linear-gradient(135deg,#f5c3ad,#b9725a)' },
	{ id: 'white', label: 'White gold', swatch: 'linear-gradient(135deg,#f1f1f3,#9fa1a8)' },
];

function Maker({ initial, onOpen }: { initial?: LifeWatchConfig; onOpen: (c: LifeWatchConfig) => void }) {
	const [name, setName] = useState(initial?.name ?? '');
	const [born, setBorn] = useState(initial?.born ?? '');
	const [place, setPlace] = useState(initial?.place ?? '');
	const [metal, setMetal] = useState<Metal>(initial?.metal ?? 'yellow');
	const [enamel, setEnamel] = useState(initial?.enamel ?? ENAMELS.sky);
	const today = new Date().toISOString().slice(0, 10);

	const valid = name.trim().length > 0 && !!parseBirth(born);
	const config: LifeWatchConfig = useMemo(
		() => (valid ? { name: name.trim(), born, place: place.trim() || undefined, metal, enamel } : { ...EXAMPLE, metal, enamel }),
		[valid, name, born, place, metal, enamel],
	);
	const preview = useDebounced(config, 700);
	const age = valid ? new Date().getFullYear() - Number(born.slice(0, 4)) : 0;

	return (
		<div className="page maker">
			<header className="bar">
				<span className="brand">Life watch</span>
				<nav>
					<a href={REPO}>GitHub</a>
				</nav>
			</header>

			<section className="hero">
				<div className="hero-copy">
					<h1>A mechanical watch that counts your life.</h1>
					<p className="lede">
						A procedural pocket watch with a perpetual calendar. Under XII it counts your years and the days since your last birthday; with the hands it reads your exact age. Take it apart to see every wheel, lever and jewel at work.
					</p>

					<form
						className="form"
						onSubmit={(e) => {
							e.preventDefault();
							if (valid) onOpen(config);
						}}
					>
						<label>
							<span>Your name</span>
							<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" autoComplete="name" maxLength={40} required />
						</label>
						<label>
							<span>Birthday</span>
							<input type="date" value={born} max={today} min="1900-01-01" onChange={(e) => setBorn(e.target.value)} required />
						</label>
						<label>
							<span>
								Place <em>optional</em>
							</span>
							<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Switzerland" maxLength={40} />
						</label>
						<fieldset>
							<legend>Case</legend>
							<div className="swatches">
								{METALS.map((m) => (
									<button key={m.id} type="button" className={`swatch ${metal === m.id ? 'on' : ''}`} onClick={() => setMetal(m.id)} aria-pressed={metal === m.id} title={m.label}>
										<i style={{ background: m.swatch }} />
										<span>{m.label}</span>
									</button>
								))}
							</div>
						</fieldset>
						<fieldset>
							<legend>Enamel</legend>
							<div className="swatches">
								{Object.entries(ENAMELS).map(([id, c]) => (
									<button key={id} type="button" className={`swatch dot ${enamel === c ? 'on' : ''}`} onClick={() => setEnamel(c)} aria-pressed={enamel === c} title={id}>
										<i style={{ background: c }} />
									</button>
								))}
								<label className="swatch dot custom" title="Custom colour">
									<input type="color" value={enamel} onChange={(e) => setEnamel(e.target.value)} />
								</label>
							</div>
						</fieldset>
						{age >= 100 && <p className="hint">The age discs count to 99 — congratulations.</p>}
						<button type="submit" className="cta" disabled={!valid}>
							Open my life watch
						</button>
						<p className="hint">Nothing is stored: your watch lives in its link.</p>
					</form>
				</div>
				<div className="hero-preview">
					<div className="preview-frame">
						<LifeWatchEmbed config={preview} />
					</div>
					<p className="caption">{valid ? `${name.trim()}'s life watch` : 'Example: Jane Doe, born 15 June 1990'}</p>
				</div>
			</section>

			<Embed config={valid ? config : EXAMPLE} />

			<section className="notes">
				<h2>How it works</h2>
				<ul>
					<li>
						<strong>Nothing is keyframed.</strong> Every part is a function of one instant, so the watch can run live, in slow motion or at a month per second and always be right.
					</li>
					<li>
						<strong>A real going train.</strong> An 18,000 vph Swiss lever escapement steps the fourth, third and centre wheels (70/7, 60/8, 80/10) and the barrel, with cycloidal teeth that mesh.
					</li>
					<li>
						<strong>A grand-lever perpetual calendar.</strong> A 24-hour snail cocks the lever all day; at midnight it falls, and on the last day of a short month the 48-month cam lets the date star skip two, three or four teeth.
					</li>
					<li>
						<strong>All generated in the browser.</strong> Bridges and levers are smooth unions of distance fields, extruded with polished bevels; Côtes de Genève and perlage are baked into anisotropic highlights. Built with three.js and react-three-fiber.
					</li>
				</ul>
				<p className="credits">
					Inspired by Bartosz Ciechanowski’s <a href="https://ciechanow.ski/mechanical-watch/">Mechanical Watch</a> and a Patek Philippe singing-bird box of 1866. Made by <a href="https://adriankrebs.ch">Adrian Krebs</a> · <a href={REPO}>Source on GitHub</a>
				</p>
			</section>
		</div>
	);
}

function Embed({ config }: { config: LifeWatchConfig }) {
	const [tab, setTab] = useState<'html' | 'react'>('html');
	const [copied, setCopied] = useState(false);
	const attrs = [`name="${config.name}"`, `born="${config.born}"`, config.metal && config.metal !== 'yellow' ? `metal="${config.metal}"` : '', config.enamel && config.enamel !== ENAMELS.sky ? `enamel="${config.enamel}"` : '']
		.filter(Boolean)
		.join(' ');
	const code =
		tab === 'html'
			? `<script type="module" src="https://cdn.jsdelivr.net/npm/life-watch/dist/life-watch.js"></script>\n\n<!-- The full watch (give it a height) -->\n<life-watch ${attrs} style="height: 720px"></life-watch>\n\n<!-- Or a compact live picture -->\n<life-watch ${attrs} variant="embed"></life-watch>`
			: `npm install life-watch three @react-three/fiber\n\nimport { LifeWatch } from 'life-watch';\nimport 'life-watch/style.css';\n\n<LifeWatch config={{ name: '${config.name}', born: '${config.born}'${config.metal && config.metal !== 'yellow' ? `, metal: '${config.metal}'` : ''} }} />`;
	return (
		<section className="embed">
			<h2>Put it on your own site</h2>
			<p>One script tag for any page, or a React component.</p>
			<div className="tabs" role="tablist">
				<button type="button" role="tab" aria-selected={tab === 'html'} className={tab === 'html' ? 'on' : ''} onClick={() => setTab('html')}>
					HTML
				</button>
				<button type="button" role="tab" aria-selected={tab === 'react'} className={tab === 'react' ? 'on' : ''} onClick={() => setTab('react')}>
					React
				</button>
				<button
					type="button"
					className="copy"
					onClick={async () => {
						await navigator.clipboard.writeText(code);
						setCopied(true);
						setTimeout(() => setCopied(false), 1500);
					}}
				>
					{copied ? 'Copied' : 'Copy'}
				</button>
			</div>
			<pre>
				<code>{code}</code>
			</pre>
		</section>
	);
}
