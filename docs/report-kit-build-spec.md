# Report Kit — Build Specification

A frontend npm package for designing and viewing reports in the browser.

Version 0.1 · Build spec for a single developer

---

## 1. What this is

An npm package that gives a React application two screens:

- **Designer** — a user drags text and tables onto a page, styles them, and saves the layout as a JSON file.
- **Preview** — the application loads a saved layout file, passes in data as JSON, and the finished report is rendered with page navigation, search, and download.

The layout file is the handoff between the two. The designer writes it; the preview reads it.

The consuming application writes code only to mount the components and supply data. It never writes code to design a report.

### 1.1 Scope

**In scope for v0.1**

- Designer screen: text and table components, drag, resize, style properties, save.
- Preview screen: paginated render, page navigation, zoom, search, print, CSV download.
- A layout engine that turns a layout file plus data into a list of positioned pages.
- Published as a single npm package with React components and a framework-free engine.

**Out of scope for v0.1** (deliberately deferred)

- Charts, images, lines, rectangles.
- Nested grouping (one level only).
- Formulas, conditionals, date and string functions.
- XLSX and DOCX export.
- YAML input.
- Vue, Angular, or other framework bindings.
- Server-side rendering.
- Any storage, database, authentication, or backend of any kind.

### 1.2 Constraints

- **Browser only.** No Node runtime target. The engine may call browser APIs.
- **React only** for the UI in this version.
- **Zero runtime dependencies.** React is a peer dependency. Nothing else.
- **Free and open source.**

---

## 2. Architecture

### 2.1 The one rule

**The engine is framework-free. Only the screens are React.**

```
                framework-free                    React
   ┌──────────────────────────────────┐   ┌──────────────────┐
   │  engine/                         │   │  react/          │
   │    resolve → group → measure     │   │    <Designer />  │
   │    → paginate → PAGE LIST        │──▶│    <Preview />   │
   │                                  │   │                  │
   │  render/                         │   │  drag, resize,   │
   │    item → style decisions        │   │  panels, events  │
   └──────────────────────────────────┘   └──────────────────┘
```

Nothing under `engine/` or `render/` imports React. No hooks, no components, no
React types. The engine is functions operating on plain objects.

This is worth protecting because it is what makes a Vue version later a
one-week wrapper instead of a rewrite. Enforce it by writing engine tests that
run with no React import at all — if a test fails because React is missing,
something has leaked.

### 2.2 The page list is the seam

The engine's output is a plain array of pages, each holding positioned items
with absolute page coordinates. Everything downstream consumes only this:

| Consumer | Reads |
|---|---|
| Preview screen | page list |
| Search | page list |
| CSV export | page list |
| Print / PDF | page list |

None of them know anything about grouping, measurement, or pagination. Keep
this seam clean and the project stays easy. Let the preview screen do its own
layout work and the same bug has to be fixed in three places forever.

### 2.3 `render/` is logic, not elements

Drawing to the screen means producing elements, and elements are
framework-specific. So `render/` holds the *decisions* — for a given item, what
position, font size, colour, alignment, and CSS properties — as plain objects.
Each framework's screen turns those into actual elements.

This keeps the per-framework code thin: loops and event handlers, no layout
logic. If a height calculation or a wrapping decision appears inside `react/`,
pull it back into core.

---

## 3. The layout file

The layout file is the centre of the whole product. Everything is built against
it, so it is specified first and specified concretely.

### 3.1 Structure

```json
{
  "version": 1,
  "name": "Invoice",
  "page": {
    "width": 794,
    "height": 1123,
    "margin": { "top": 40, "right": 40, "bottom": 40, "left": 40 }
  },
  "dataset": "items",
  "groupBy": null,
  "bands": [ ... ]
}
```

| Field | Meaning |
|---|---|
| `version` | Format version. Integer. Present from day one, unused for now. |
| `page.width` / `page.height` | Page size in pixels. A4 = 794 × 1123. Letter = 816 × 1056. |
| `page.margin` | Content area inset on all four sides. |
| `dataset` | Which key of the data object drives detail rows. |
| `groupBy` | Field name to group by, or `null`. One level only in v0.1. |
| `bands` | Ordered array of bands. |

### 3.2 Bands

A band is a horizontal strip of the report. Bands stack vertically. Nothing
floats, nothing nests. This constraint is what makes pagination tractable.

```json
{
  "type": "pageHeader",
  "height": 80,
  "items": [ ... ]
}
```

Band types and when they appear:

| Type | Appears |
|---|---|
| `reportHeader` | First page only |
| `pageHeader` | Every page, including continuation pages |
| `groupHeader` | Before each group; repeats at the top of a continuation page |
| `detail` | Once per data row, or once for a table that spans rows |
| `groupFooter` | After each group's rows |
| `reportFooter` | Last page only |
| `pageFooter` | Every page |

`height` is a fixed band height in pixels. Bands containing a table are the
exception — their height is computed from the row count.

### 3.3 Items

Two item types in v0.1.

**Text**

```json
{
  "id": "t1",
  "type": "text",
  "x": 0, "y": 0, "w": 300, "h": 30,
  "value": "Invoice #{invoice.number}",
  "style": {
    "fontFamily": "Helvetica, Arial, sans-serif",
    "fontSize": 14,
    "fontWeight": "normal",
    "fontStyle": "normal",
    "color": "#000000",
    "align": "left",
    "background": null,
    "border": null,
    "padding": 4
  }
}
```

**Table**

```json
{
  "id": "tbl1",
  "type": "table",
  "x": 0, "y": 0, "w": 714,
  "dataset": "items",
  "rowHeight": 28,
  "headerHeight": 32,
  "showHeader": true,
  "columns": [
    { "field": "name",  "label": "Item",  "width": 400, "align": "left" },
    { "field": "qty",   "label": "Qty",   "width": 100, "align": "right" },
    { "field": "price", "label": "Price", "width": 214, "align": "right" }
  ],
  "style": { "fontSize": 12, "color": "#000000", "borderColor": "#cccccc" }
}
```

`x` and `y` are relative to the band's top-left corner, not the page. The
engine converts to absolute page coordinates in its output.

A table has no `h` — its height is `headerHeight + rows × rowHeight`, computed
at layout time.

### 3.4 Placeholders

Text `value` may contain placeholders in curly braces.

| Form | Resolves to | Valid in |
|---|---|---|
| `{field}` | Field on the current row, else root data | Any band |
| `{customer.name}` | Nested path from root data | Any band |
| `{page}` | Current page number | Any band |
| `{totalPages}` | Total page count | Any band |
| `{today}` | Current date | Any band |
| `{sum(field)}` | Sum over current scope | `groupFooter`, `reportFooter` |
| `{count()}` | Row count in current scope | `groupFooter`, `reportFooter` |
| `{avg(field)}` `{min(field)}` `{max(field)}` | As named | `groupFooter`, `reportFooter` |

No arithmetic, no conditionals, no function composition. A placeholder is a
lookup or a named aggregate, nothing more. Anything unresolvable renders as an
empty string and logs a warning.

### 3.5 Data payload

```json
{
  "invoice": { "number": "INV-2041", "date": "2026-07-25" },
  "customer": { "name": "Anand Traders", "city": "Kozhikode" },
  "items": [
    { "name": "Cable 2m",   "qty": 4,  "price": 120 },
    { "name": "Adapter",    "qty": 2,  "price": 450 }
  ]
}
```

A plain object. Arrays are datasets; everything else is available to
placeholders by path. The package never fetches data — the host application
supplies it.

---

## 4. The engine

Signature:

```
buildPages(layout, data) → PageList
```

Four stages, in order. Each is a pure function and independently testable.

### 4.1 Resolve

Walk every text value and replace placeholders with real values, using the
current row and the root data. Aggregates are deferred to the group stage,
which knows the scope.

### 4.2 Group

If `groupBy` is set: sort rows by that field, split into groups, and emit a
`groupHeader` band before each group and a `groupFooter` band after it.
Aggregates in footer bands resolve against that group's rows. Aggregates in
`reportFooter` resolve against all rows.

If `groupBy` is null, this stage passes rows through unchanged.

Output is a flat, ordered sequence of bands ready for measurement — group
structure has been flattened away.

### 4.3 Measure

Compute the rendered height of every band.

Text height comes from the browser's canvas 2D `measureText`. Create one
offscreen canvas, set the font string, measure. Wrapping is greedy: add words
until the measured width exceeds the item width, then break. Cache measurements
by `text + font` — the same strings recur constantly and this is the difference
between instant and sluggish.

Table height is `headerHeight + rows × rowHeight`.

Band height is the fixed `height` field, or the computed table height where a
band contains a table.

**Using the browser to measure is the single largest benefit of the browser-only
decision.** It removes font metric libraries, embedded font files, and an entire
class of measurement bugs.

### 4.4 Paginate

The only genuinely difficult code in the project. Roughly 200 lines.

```
reserve pageHeader height and pageFooter height up front
available = page.height - margins - reserved

for each band in sequence:
    if band fits in remaining space:
        place it, advance y
    else if band contains a table and more than one row fits:
        place the rows that fit
        start a new page
        repeat pageHeader and any active groupHeader
        continue with remaining rows
    else:
        start a new page
        repeat pageHeader and any active groupHeader
        place the band
```

Three rules that keep it correct:

1. **Reserve the footer before placing anything.** Subtract its height at the
   start. Filling downward and remembering the footer later means you have
   already overflowed.
2. **Only tables split.** Everything else moves whole to the next page. No
   exceptions in v0.1.
3. **Page one has less room.** The report header consumes space from it, so
   available height is computed per page, never assumed constant.

### 4.5 Output

```json
{
  "pageCount": 3,
  "pageSize": { "width": 794, "height": 1123 },
  "pages": [
    {
      "index": 0,
      "items": [
        {
          "id": "t1",
          "type": "text",
          "x": 40, "y": 40, "w": 300, "h": 30,
          "text": "Invoice #INV-2041",
          "style": { "fontSize": 14, "color": "#000000", "align": "left" }
        },
        {
          "id": "tbl1",
          "type": "table",
          "x": 40, "y": 120, "w": 714,
          "columns": [ ... ],
          "rows": [ ["Cable 2m", "4", "120"], ["Adapter", "2", "450"] ],
          "style": { ... }
        }
      ]
    }
  ]
}
```

Coordinates are absolute page coordinates. Placeholders are already resolved —
`text` is the final string. A renderer needs no knowledge of the layout file at
all.

---

## 5. Screens

### 5.1 Preview

```jsx
<Preview layout={layoutJson} data={dataJson} />
```

| Requirement | Detail |
|---|---|
| Render | One container per page at `pageSize`, items absolutely positioned |
| Navigation | Page forward / back, jump to page, current page indicator |
| Zoom | Fit width, fit page, 50–200% |
| Search | Scan the page list for matching text, highlight, scroll to match, next/previous |
| Print | `window.print()` with print stylesheets that break pages correctly |
| CSV | Extract table rows from the page list, download as a file |
| Large reports | Only mount pages near the viewport |

Search is nearly free here — the page list is flat, and every text item has its
final string and its page number. This is the payoff for the seam in §2.2.

### 5.2 Designer

```jsx
<Designer
  layout={layoutJson}
  onSave={(layout) => saveItSomewhere(layout)}
/>
```

| Requirement | Detail |
|---|---|
| Canvas | One page shown at the configured size, with band strips marked |
| Add | Palette to insert a text box or a table |
| Select | Click to select; outline and eight resize handles |
| Move | Pointer drag; snap to a 10px grid |
| Resize | Drag any handle; respect a minimum size |
| Properties | Right panel: position, size, font, weight, colour, alignment, and the `value` string |
| Table config | Add and remove columns, set field, label, width, alignment |
| Bands | Add and remove bands, set band type and height |
| Group | Set `groupBy` field, or none |
| Undo/redo | Snapshot the layout object on each change; array plus index |
| Live preview | Toggle to the preview with sample data |
| Save | Call `onSave` with the layout object |

**Drag and resize are written by hand.** The logic is small: on pointer down
record the start position, on move apply the delta, snap with
`Math.round(x / 10) * 10`. Libraries in this space are 50KB or more, impose
their own DOM structure, and fight you. This is also the interaction users judge
the product on — full control is worth having.

**The designer canvas uses the same drawing code as the preview.** It adds only
selection outlines and handles on top. One rendering path means the design
always looks like the output. Two paths drift.

**No canvas library.** Absolutely-positioned HTML elements. Text wrapping in a
`<canvas>` is painful and would be reimplementing what the browser already does
for free.

---

## 6. Technology

| Concern | Choice | Reason |
|---|---|---|
| Language | JavaScript (TypeScript optional) | Author's preference; types can be added later via JSDoc or `.d.ts` |
| Build | Vite, library mode | One tool for the library build and the dev playground |
| UI | React 18+ | Peer dependency, never bundled |
| Text measurement | Canvas 2D `measureText` | Built in, no library |
| Drag / resize | Hand-written pointer events | ~200 lines, full control |
| Undo / redo | Array of layout snapshots | No state library needed |
| PDF | `window.print()` | Free, and matches the preview exactly because it *is* the preview |
| CSV | Hand-written | ~20 lines |
| Tests | Vitest | Pairs with Vite, no config |
| Module format | ESM only | Browser-only target; no CommonJS build needed |

**Runtime dependencies: zero.**

### 6.1 Explicitly not used

| Package | Why not |
|---|---|
| Konva / Fabric | Canvas text wrapping is painful; two rendering paths |
| pdf-lib / jsPDF | Browser print covers v0.1 |
| exceljs / SheetJS | XLSX is deferred; make it an optional peer if added |
| js-yaml | JSON only |
| Zod | A hand-written validator gives better errors for this file shape |
| moveable / interact.js | Heavier than the code they replace |

### 6.2 Units

**Pixels throughout.** A4 is 794 × 1123 pixels, which is A4 at standard screen
resolution and matches what browser print produces. One unit everywhere, no
conversion, no rounding drift.

---

## 7. Repository and packaging

### 7.1 Layout

```
report-kit/
├── src/
│   ├── engine/              framework-free, no React
│   │   ├── resolve.js
│   │   ├── group.js
│   │   ├── measure.js
│   │   ├── paginate.js
│   │   ├── validate.js
│   │   └── index.js
│   ├── render/              framework-free style decisions
│   │   └── item-style.js
│   ├── react/
│   │   ├── Preview.jsx
│   │   ├── Designer.jsx
│   │   ├── designer/        canvas, handles, panels
│   │   └── index.js
│   └── index.js             engine entry point
├── dev/                     Vite playground app
├── fixtures/                hand-written layout files + sample data
├── test/
├── vite.config.js
└── package.json
```

One package. Not a monorepo. Splitting later is moving folders; splitting early
costs tooling complexity every day.

`dev/` imports from `src/` directly — instant feedback, no build step during
development. It later doubles as the demo.

### 7.2 Manifest

```json
{
  "name": "report-kit",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist"],
  "exports": {
    ".": "./dist/index.js",
    "./react": "./dist/react.js"
  },
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest",
    "prepublishOnly": "npm run build"
  }
}
```

`files` keeps source, tests, and the playground out of the published tarball.
`peerDependencies` prevents a second copy of React reaching the consumer.
`prepublishOnly` makes it impossible to publish stale output.

### 7.3 Build config

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: { index: 'src/index.js', react: 'src/react/index.js' },
      formats: ['es']
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime']
    }
  }
});
```

`external` is load-bearing. Without it, React is bundled into the output — huge
and broken.

### 7.4 Consumer usage

```jsx
import { buildPages } from 'report-kit';
import { Designer, Preview } from 'report-kit/react';
```

Because the entry points are separate, a consumer importing only the engine
never downloads the React code.

### 7.5 Verification before publishing

```bash
npm pack --dry-run     # list exactly what would ship
npm pack               # produce the tarball
cd ../scratch-app && npm install ../report-kit/report-kit-0.1.0.tgz
```

Then import it in that scratch app. This catches missing export paths, files
left out of `files`, and React accidentally bundled — the failures that
otherwise arrive as a stranger's bug report.

### 7.6 Publishing

```bash
npm login
npm publish            # add --access public if using a scope
```

Check name availability first. If taken, use `@yourname/report-kit`.

Stay in `0.x` while the layout file format is still moving — breaking changes
are expected there, which gives room to rename fields. Move to `1.0.0` when the
format is settled.

---

## 8. Build process

Order matters here. The preview is built before the designer, and layout files
are hand-written before either.

### Step 0 — Prove the packaging (half a day, week one)

Publish a deliberately trivial version: one file exporting one function.
Install it in a scratch project. Confirm it imports.

Doing this before there is real code means that when something worth publishing
exists, the packaging is already proven and only the library is being debugged.

### Step 1 — Hand-write three layout files (1–2 days)

No code. Open a text editor and write out, by hand, the layout file for three
real reports: an invoice, a sales summary grouped by region with subtotals, and
one other.

Every field written is a decision that would otherwise be made badly. Is `x`
relative to the page or the band? Does a band declare its height or grow to fit?
Do columns carry widths or share space evenly?

The grouped report will expose gaps the invoice does not. That friction is the
point — each moment of "I don't know how to express this" is a bug avoided.

These three files become the test fixtures for the rest of the project.

### Step 2 — Engine (weeks 1–3)

Build in stage order: resolve, then group, then measure, then paginate. Test
each against the fixtures before moving on. Snapshot the page list output —
layout regressions then show up as a diff.

Budget the most time for pagination. It is the hard part and it is normal for it
to take longer than expected.

### Step 3 — Preview (week 4)

Render the page list. Navigation, zoom, search, print, CSV.

**At the end of this week there is something demoable.** Record it.

### Step 4 — Designer (weeks 5–7)

Canvas, palette, drag, resize, properties panel, table config, band editing,
undo/redo, save.

By this point the layout file format has been stable for a month, so the
designer is building against something known to work.

### Step 5 — Package and publish (week 8)

README, one working example, `npm pack` verification, publish `0.1.0`.

### Timeline

| Week | Deliverable |
|---|---|
| 0 | Packaging proven; three layout files hand-written |
| 1 | Resolve and group, tested against fixtures |
| 2 | Measure; text wrapping and caching |
| 3 | Paginate; page list output correct for all three fixtures |
| 4 | Preview screen — **first demoable milestone** |
| 5–7 | Designer |
| 8 | Package, docs, publish `0.1.0` |

Roughly two months to something real.

---

## 9. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | A 5,000-row report paginates in under two seconds |
| Data size | Documented ceiling of ~20,000 rows; everything runs in the browser |
| Rendering | Only pages near the viewport are mounted |
| Measurement | Cached by text and font; repeated strings measured once |
| Errors | Validation failures name the field and the band; never a bare undefined crash |
| Bundle | Engine under 30KB gzipped; React screens under 60KB |
| Browsers | Current Chrome, Firefox, Safari, Edge |
| Determinism | The same layout and data always produce the same page count |

### 9.1 Validation

Before rendering, check the loaded layout and report what is wrong in terms the
user understands — "band 2 (`detail`) is missing `height`" rather than a crash
deep inside pagination.

This is about sixty lines and it is not architecture. It matters because users
hand-write these files and will typo a field. If the engine renders a blank page
instead of saying what is wrong, they will conclude the library is broken.

---

## 10. Open decisions

Settle these before the week they block.

**Where the designer's output goes.** A browser cannot write to disk. Three
options: trigger a file download; call an `onSave` callback the host wires to
its own storage; or write to `localStorage`. The callback is the real answer and
download is a reasonable fallback; `localStorage` is a demo, not a product.
Needed before step 4.

**Whether TypeScript comes back.** The source can stay JavaScript and still ship
types via a hand-written `.d.ts` or JSDoc annotations. Worth doing eventually —
consumers hand-writing layout files get editor autocomplete on band types and
required fields. Not urgent.

**Package name.** Check npm availability early. A scope is always available.

**Row ceiling.** Confirm the documented maximum. Stating it honestly in the
README prevents bug reports that cannot be fixed.

**Fonts.** Which font stack the designer offers. Web-safe families only avoids
loading and embedding entirely.

---

## 11. Deferred to later versions

Listed so they are not accidentally built early.

| Feature | Version |
|---|---|
| Image component | 0.2 |
| Line and rectangle components | 0.2 |
| Chart component | 0.3 |
| Nested grouping | 0.3 |
| Real PDF generation (`pdf-lib`) | 0.3, only if print proves insufficient |
| XLSX export | 0.4, optional peer dependency |
| Formula expressions | 0.4 |
| Vue bindings | On request |
| Web component version | 1.0, if framework reach matters |

Each of these is a week or more, and none is needed for someone to install the
package and understand what it does.
