// <life-watch> for any web page, no build step needed:
//
//   <script type="module" src="https://cdn.jsdelivr.net/npm/life-watch/dist/life-watch.js"></script>
//   <life-watch name="Ada Lovelace" born="1815-12-10"></life-watch>
//
// Attributes: name, born (YYYY-MM-DD), place, signature, inscription,
// metal (yellow | rose | white), enamel (#rrggbb), variant (full | embed).

import { createRoot, type Root } from 'react-dom/client';
import { parseBirth, type LifeWatchConfig, type Metal } from './config';
import LifeWatch from './LifeWatch';
import LifeWatchEmbed from './LifeWatchEmbed';
import css from './life-watch.css?inline';

const ATTRS = ['name', 'born', 'place', 'signature', 'inscription', 'metal', 'enamel', 'variant'] as const;

let styleInjected = false;
function injectStyle() {
	if (styleInjected || typeof document === 'undefined') return;
	styleInjected = true;
	const style = document.createElement('style');
	style.dataset.lifeWatch = '';
	style.textContent = `life-watch{display:block;position:relative}life-watch[variant="embed"]{aspect-ratio:1360/880;border-radius:8px;overflow:hidden;background:#f4eee6}${css}`;
	document.head.appendChild(style);
}

class LifeWatchElement extends HTMLElement {
	static observedAttributes = [...ATTRS];
	private root: Root | null = null;

	connectedCallback() {
		injectStyle();
		this.root ??= createRoot(this);
		this.render();
	}

	disconnectedCallback() {
		this.root?.unmount();
		this.root = null;
	}

	attributeChangedCallback() {
		if (this.root) this.render();
	}

	private render() {
		const name = this.getAttribute('name');
		const born = this.getAttribute('born');
		if (!name || !born || !parseBirth(born)) {
			this.root?.render(<p style={{ font: '14px system-ui', color: '#8a2b2b' }}>life-watch: set a "name" and a past "born" date as YYYY-MM-DD.</p>);
			return;
		}
		const metal = this.getAttribute('metal') as Metal | null;
		const config: LifeWatchConfig = {
			name,
			born,
			place: this.getAttribute('place') ?? undefined,
			signature: this.getAttribute('signature') ?? undefined,
			inscription: this.getAttribute('inscription') ?? undefined,
			metal: metal ?? undefined,
			enamel: this.getAttribute('enamel') ?? undefined,
		};
		this.root!.render(this.getAttribute('variant') === 'embed' ? <LifeWatchEmbed config={config} /> : <LifeWatch config={config} />);
	}
}

if (typeof customElements !== 'undefined' && !customElements.get('life-watch')) {
	customElements.define('life-watch', LifeWatchElement);
}

export { LifeWatchElement };
