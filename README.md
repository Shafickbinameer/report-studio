# Report Studio

Design paginated reports in the browser, then render them in your app.

Zero runtime dependencies. No framework. The engine is ~1.4 kB gzipped and
imports nothing.

```bash
npm install report-studio
```

---

## The two halves

**Designing** happens at development time, in a browser, against a local server
that reads and writes JSON files in a folder you choose.

**Rendering** happens in your application, from that JSON plus your data.

The file in between is the whole interface. The designer writes it; your app
reads it.

---

## Design a report

```bash
npx report-studio design --dir ./reports
```

That starts a local server, opens the designer, and lists whatever is already in
`./reports`. Save, and it writes `<name>.json` there — a real file you commit
alongside your code.

| Option | | |
|---|---|---|
| `--dir <path>` | where report files live | `./reports` |
| `--port <n>` | port to listen on | `5177` |
| `--host <addr>` | address to bind | `127.0.0.1` |
| `--no-open` | do not open a browser | |

It binds to loopback and serves a write endpoint. It is a design-time tool —
do not run it in production.

### Already using Vite?

A plugin mounts the same routes on your existing dev server, so you do not run a
second process:

```js
// vite.config.js
import { reportStudio } from 'report-studio/vite';

export default {
  plugins: [reportStudio({ dir: 'reports' })]
};
```

The plugin binds only in `vite` (dev) — never in `vite build` or `vite preview`.

---

## Render a report

```js
import { buildPages, render } from 'report-studio';
import 'report-studio/report.css';          // ← the report needs this

const layout = await fetch('/reports/invoice.json').then(r => r.json());
const data   = await fetch('/api/invoice/2041').then(r => r.json());

document.getElementById('out').innerHTML = render(buildPages(layout, data));
```

**Link the stylesheet.** Two of its rules are not decoration: without
`table-layout: fixed` your column widths are ignored, and without `p { margin: 0 }`
the browser's default paragraph margin pushes every text item off its position.
A report drawn without it is wrong, not merely plain. It carries its own colours,
so it needs nothing else.

With a bundler that is all of it.

### Without a bundler

A browser resolves imports by URL — there is no `node_modules` lookup — so a
bare name has to be mapped to one. That is the whole of what a bundler was doing
for you here; the package is plain ESM with nothing else to map.

```html
<link rel="stylesheet"
      href="./node_modules/report-studio/src/render/report.css">

<script type="importmap">
{
  "imports": {
    "report-studio": "./node_modules/report-studio/dist/index.js"
  }
}
</script>

<script type="module" src="./main.js"></script>
```

Two things that catch people out: the import map must come **before** the module
that uses it, and ES modules do not load over `file://` — any static server will
do (`npx serve`, `python -m http.server`).

`buildPages(layout, data)` returns a page list: an array of pages holding
positioned items with absolute page coordinates and every placeholder already
resolved. `render` turns that into HTML, but nothing stops you consuming the
page list yourself — search, CSV export and printing all read only that.

---

## Or mount the whole viewer

`render` gives you a report. `createViewer` gives you a report with page
navigation, zoom, search, print and CSV export — the screen the designer links
to, in your own page.

```js
import { buildPages, createViewer } from 'report-studio';
import 'report-studio/viewer.css';          // includes report.css

createViewer({
  mount: '#report',
  paginated: buildPages(layout, data),
  title: 'Invoices'
});
```

```html
<div id="report" style="height: 80vh"></div>
```

One empty element is the whole of it — the viewer builds its toolbar, pager and
export dialog inside. It fills whatever you give it, so it embeds in a panel
beside your own chrome rather than taking over the window.

The handle it returns drives everything the toolbar does:

```js
const viewer = createViewer({ mount: '#report', paginated });

viewer.next();  viewer.prev();  viewer.show(3);
viewer.setZoom(1.5);  viewer.fitWidth();
viewer.find('Anand');
viewer.print();  viewer.downloadCSV();
viewer.destroy();          // gives the element back as it found it
```

---

## The layout file

```json
{
  "version": 1,
  "name": "Sales Summary",
  "page": {
    "width": 794,
    "height": 1123,
    "margin": { "top": 40, "right": 40, "bottom": 40, "left": 40 }
  },
  "dataset": "sales",
  "groupBy": "region",
  "bands": [ ... ]
}
```

Pixels throughout. A4 is 794 × 1123, Letter is 816 × 1056 — the sizes browser
print produces.

### Bands

A band is a horizontal strip. Bands do not flow: each owns a zone of the page,
so a page whose rows ran short still prints its footer on the bottom edge. One
band of each type, at most.

| Type | Appears |
|---|---|
| `reportHeader` | First page only |
| `pageHeader` | Every page |
| `groupHeader` | Before each group |
| `detail` | The rows |
| `groupFooter` | After each group |
| `reportFooter` | Last page only |
| `pageFooter` | Every page, on the bottom edge |

`height` is a number of pixels or a percentage of the printable height
(`"10%"`). The `detail` band takes whatever the others leave.

### Items

**Text** carries a `value` with placeholders in braces. **Table** carries
`columns`; its height is the header plus its rows, so it declares none.

`x` and `y` are relative to the band, not the page. The engine converts.

### Placeholders

| Form | Resolves to | Where |
|---|---|---|
| `{field}` | a key on the data object | any band |
| `{field}` | a field on the group's rows | `groupHeader`, `groupFooter` |
| `{customer.name}` | a nested path from the root | any band |
| `{page}` `{totalPages}` | the page number and the count | any band |
| `{today}` | the date the report was run | any band |
| `{sum(f)}` `{avg(f)}` `{min(f)}` `{max(f)}` `{count()}` | over the group's rows | `groupFooter`, `reportFooter` |

Two rules that are easy to get the wrong way round:

**A bare `{name}` is a key on the data object**, in every band except the group
bands — including the detail band. If you want a row's field printed as text,
that only happens inside a `groupHeader` or `groupFooter`, which are the bands
with a group to be inside of. Elsewhere, a row's fields reach the page through a
table's columns.

**Aggregates only resolve in a footer.** Nowhere else has a group to work over.

The designer knows both, and the field tool puts things in a band where they
will actually print.

---

## Data

Your data is a plain object. Arrays are datasets; everything else is reachable
by path.

```json
{
  "report":  { "period": "June 2026" },
  "sales": [
    { "date": "2026-06-01", "customer": "Orbit Systems", "amount": 5600 }
  ]
}
```

The designer works out what a report is asking for — every placeholder, every
column, the dataset and the grouping field — and writes a `<name>.data.json`
beside it the first time you save. Fill in real values over the samples; it is
never overwritten once it exists.

The package never fetches your data. You supply it.

---

## What is in the box

```js
import {
  buildPages, render, createViewer, search, toCSV, validateLayout
} from 'report-studio';

import { createDesigner } from 'report-studio/designer';
import { reportStudio }  from 'report-studio/vite';

import 'report-studio/report.css';   // if you use render()
import 'report-studio/viewer.css';   // if you use createViewer() - includes the above
```

`validateLayout(layout)` returns a list of what is wrong with a layout, naming
the band and the field — worth calling on anything hand-written.

---

## Limits

- **Browser only.** The engine may use browser APIs; text is measured with
  canvas `measureText`, which is what removes font-metric libraries entirely.
- **Web-safe fonts.** A font the browser does not have is measured as a
  fallback, and then paginates to a different page count than it prints.
- **One level of grouping.**
- **Text and tables.** Images, lines, rectangles and charts are not in this
  version.
- **~20,000 rows.** Everything runs in the browser.
- **PDF is browser print.** Which matches the preview exactly, because it is the
  preview.

---

## Licence

MIT
