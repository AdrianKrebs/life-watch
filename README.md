# Life watch

A mechanical pocket watch that counts your life, rendered live in the browser.

![Life watch](public/poster.jpg)

Under XII it counts your years and the days since your last birthday; with the hands it reads your exact age. Around it: a perpetual calendar (day, date, month, leap year, moon). Press **Explode** to take the movement apart, or speed up time to watch the calendar work.

## Make your own

Enter your name and birthday on the site and get your own watch as a link:
`/?name=Jane+Doe&born=1990-06-15&metal=rose`. Nothing is stored.

## Embed it

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/life-watch/dist/life-watch.js"></script>
<life-watch name="Jane Doe" born="1990-06-15" style="height: 720px"></life-watch>
```

Attributes: `name`, `born` (YYYY-MM-DD), `metal` (`yellow`, `rose`, `white`), `enamel` (`#rrggbb`), `place`, `signature`, `inscription`, `variant="embed"` for a compact picture.

React:

```tsx
import { LifeWatch } from 'life-watch';
import 'life-watch/style.css';

<LifeWatch config={{ name: 'Jane Doe', born: '1990-06-15' }} />
```

## Develop

```bash
npm install
npm run dev     # maker site
npm run build   # library, <life-watch> script and site
```

Built with three.js and react-three-fiber. Every part is procedural and a pure function of time: an 18,000 vph Swiss lever escapement, a cycloidal going train and a grand-lever perpetual calendar.

Inspired by Bartosz Ciechanowski's [Mechanical Watch](https://ciechanow.ski/mechanical-watch/). Made by [Adrian Krebs](https://adriankrebs.ch). MIT licensed.
