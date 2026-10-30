# Report Studio

**Design paginated reports visually. Zero runtime dependencies. Works in plain
JS or React.**

![Adding a text box in the designer, saving, and running the report](https://raw.githubusercontent.com/Shafickbinameer/report-studio/main/.github/demo.gif)

**[Try it live on StackBlitz](https://stackblitz.com/github/Shafickbinameer/report-studio/tree/main/examples/demo?file=src%2Fmain.js)**: the viewer and the designer in a Vite app, nothing to install.

You draw the report once in a visual designer — headers, footers, groups,
tables, text, images — and it is saved as a plain JSON file. At runtime your
app feeds that layout its own data and gets back a page-by-page report viewer,
with navigation, zoom, search, print and CSV export.

* **Zero runtime dependencies.** The renderer is plain DOM. No server to run,
  no framework required.
* **Layouts are plain JSON.** Commit them, diff them, load them with `fetch`.
* **React components included**, for both the viewer and the designer.
* **Vite plugin.** One line in `vite.config.js` and your existing dev server
  hosts the designer's save routes.
* **TypeScript types included.**

## Installation

```sh
npm install report-studio
```

Requires Node 18.3 or newer for the designer command. The viewer itself runs in
the browser and needs nothing.

## Designer setup

Start the designer from your project folder:

```sh
npx report-studio design --dir ./reports
```

`--dir` is the folder your reports are read from and saved to. It is created
for you if it does not exist. The command prints a URL and opens a browser
window on it.

Other options:

| Option | Default | What it does |
| --- | --- | --- |
| `--dir <path>` | `./reports` | where report files live |
| `--port <n>` | `5177` | port to listen on |
| `--host <addr>` | `127.0.0.1` | address to bind |
| `--tab` | — | open a normal browser tab instead of an app window |
| `--no-open` | — | do not open a browser at all |

Press `Ctrl+C` to stop it.

Saving a report called *Sales Summary* writes two files into `--dir`:

* `sales-summary.json` — the layout: page size, bands, fields, styles.
* `sales-summary.data.json` — sample data, so the designer has something to
  preview with.

The sample file is written from the layout itself, so it covers everything the
report asks for: a key for every text placeholder, a row array for every table,
and the fields your totals are taken over. Read it as the answer to "what does
my app have to supply?" — it is the shape, filled in with placeholder values.

It is created the first time a report is saved. Later saves only *add* to it,
for anything the layout has asked for since: a new table's rows, a new
placeholder's key, a new image field. Values already in the file, including
real figures you have typed in, are never changed. Your app never reads this
file; it passes its own data to `buildPages`.

The designer is a design-time tool. It reads and writes files inside `--dir`
and nowhere else — keep it on localhost and do not run it in production.

### Already using Vite?

Skip the separate command. The plugin mounts the same read-and-write routes in
the dev server you already run:

```js
import { defineConfig } from 'vite';
import { reportStudio } from 'report-studio/vite';

export default defineConfig({
    plugins: [reportStudio({ dir: 'reports' })]
});
```

Dev only, deliberately: it writes files, and mounting that in front of a
production build would be a hole rather than a feature. The CLI stays the
default because it works in any project, Vite or not.

## Preview setup

Two files: an HTML page with one empty element, and a module that fills it.

**index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Reports</title>

    <!-- the viewer's stylesheet; the report's own styles are included in it -->
    <link rel="stylesheet"
          href="./node_modules/report-studio/src/preview/styles.css">

    <!--
        A browser resolves imports by URL and has no node_modules lookup, so the
        bare name has to be mapped to a path. If you use a bundler (Vite,
        webpack, …) it does this for you: drop the import map and the link
        above, and import the stylesheet by name instead - see below.
    -->
    <script type="importmap">
    {
      "imports": {
        "report-studio": "./node_modules/report-studio/dist/index.js"
      }
    }
    </script>

    <style>
        html, body { height: 100%; margin: 0; }
    </style>
</head>
<body>
    <!-- one empty element; the viewer builds everything inside it -->
    <div id="out" style="height: 100vh"></div>

    <script type="module" src="./main.js"></script>
</body>
</html>
```

**main.js**

```js
import { buildPages, createViewer } from 'report-studio';

// the layout file the designer saved
const layout = await fetch('./reports/sales-summary.json').then(r => r.json());

// your data, keyed by dataset name. The designer shows you the shape it
// expects; sales-summary.data.json is an example of it.
const data = {
    report: { period: 'June 2026', currency: 'USD' },
    sales: [
        { date: '2026-06-01', customer: 'Acme',  region: 'North', amount: 250 },
        { date: '2026-06-02', customer: 'Globex', region: 'South', amount: 500 }
    ]
};

createViewer({
    mount: '#out',
    paginated: buildPages(layout, data),
    title: layout.name
});
```

That is the whole integration:

* `buildPages(layout, data)` turns the layout plus your data into a page list.
* `createViewer({ mount, paginated, title })` mounts the full report viewer
  into the element you give it and returns a handle for paging, zoom, search,
  print, export and `destroy()`.

To open the report in a window of its own instead of inside your page, use
`openViewerWindow({ paginated, title })` — same viewer, called from a click or
a keypress so the browser does not block the window.

### Several tables

A report can hold any number of tables. Each one reads the dataset named in
its *Dataset* property, or the report's dataset if it names none, so each gets
its own array in your data:

```js
buildPages(layout, {
    orders:  [ { item: 'Widget', qty: 2, amount: 50 } ],
    refunds: [ { item: 'Gadget', qty: 1, amount: 20 } ]
});
```

Tables in the same band are stacked, one under another. Each splits across
pages on its own, and a table below another moves down by however far the one
above really ran. Two tables side by side are refused, because they would print
one after the other rather than together.

Totals can name the dataset they add up:

| Placeholder | Means |
| --- | --- |
| `{sum(orders.amount)}` | `amount` summed over every row of `orders` |
| `{count(refunds)}` | the number of rows in `refunds` |
| `{sum(amount)}` | `amount` over the first table's rows, as before |

The named dataset does not need a table of its own. Any array in the data can
be totalled this way.

One table per report can be grouped. Set *Group by* on that table. A layout
with a report-wide *Group by* still groups its first table. The group header
and footer bands are shared, which is why only one table can use them.

For CSV, the viewer's export writes every table in the order they print. From
code, `toCSV(pages, { table: 'refunds' })` writes one table, and
`reportTables(pages)` lists the tables a report has.

### Images

An image item can get its picture in two ways:

* **Stored in the layout.** In the designer, click *Upload* in the image's
  properties. The picture is saved inside the layout JSON as a `data:` URI, so
  keep it small: files over 200 KB show a warning and files over 1 MB are
  refused. PNG, JPEG, GIF and WebP are accepted.
* **Read from your data.** Set *From data* to a path such as `company.logo`,
  and supply that path's URL in the data you pass to `buildPages`:

```js
buildPages(layout, {
    company: { logo: 'https://cdn.example.com/acme.png' },
    sales: [ /* ... */ ]
});
```

If an image has both, the data wins, so a stored picture works as a default
that your data can replace per customer. *Fit* controls how the picture sits in
its box: `contain` (fit inside), `cover` (fill and crop) or `fill` (stretch).

Image URLs may be `http:`, `https:`, `blob:`, relative paths, or `data:` URIs
for PNG, JPEG, GIF, WebP, AVIF and BMP. Anything else, including `javascript:`
and SVG `data:` URIs, is not drawn. Remote images must be reachable from the
viewer's page. The viewer waits for images to finish loading before it prints.

### With a bundler

Vite, webpack and the rest resolve bare names themselves, so there is no import
map and no path into `node_modules`. Import the stylesheet by name too:

```js
import { buildPages, createViewer } from 'report-studio';
import 'report-studio/viewer.css';
```

| Import | What it is |
| --- | --- |
| `report-studio` | the engine and the viewer |
| `report-studio/designer` | the designer, which most apps do not ship |
| `report-studio/viewer.css` | the viewer's styles, the report's included |
| `report-studio/designer.css` | the designer's styles, likewise |
| `report-studio/report.css` | the report alone, for drawing pages with no chrome |

The stylesheets style only what the viewer and designer draw. Your page's
fonts, margins and CSS variables are left alone. The toolbar rearranges itself
when the viewer is narrow, whether it is on a phone or in a side panel.

## React

React components are included. React itself is not bundled: install it
yourself (version 18 or newer). Apps that don't use React never load it.

```jsx
import { ReportViewer } from 'report-studio/react';
import 'report-studio/viewer.css';

function SalesReport({ layout, sales }) {
    return (
        <ReportViewer
            layout={layout}
            data={{ report: { period: 'June 2026' }, sales }}
            title={layout.name}
            style={{ height: '100vh' }}
        />
    );
}
```

* Pass `layout` and `data`, or `paginated` if you've already called
  `buildPages`.
* Give the component a height. The viewer fills it and scrolls inside it.
* When `data` changes, the report is rebuilt and the reader stays on the same
  page and zoom level. Passing the same objects again rebuilds nothing, so keep
  `data` stable (state or `useMemo`) rather than building a new object on every
  render.
* A layout or data the engine can't use throws a `ReportError` while
  rendering. Wrap the component in an error boundary to show it.
* A `ref` gives you the viewer's controls: `next()`, `prev()`, `show(index)`,
  `find(text)`, `print()`, `downloadCSV()`, `setZoom(n)`, `fitWidth()`, and
  `page`, `pageCount` and `zoom`.

The designer is a separate import, like the plain-JS one:

```jsx
import { ReportDesigner } from 'report-studio/react/designer';
import 'report-studio/designer.css';

// a new report: no layout, the designer starts blank
<ReportDesigner store={store} style={{ height: '100vh' }} />

// reopening a saved report: pass it, with its id so Save writes back to it
<ReportDesigner id="sales-summary" layout={savedLayout} store={store}
    style={{ height: '100vh' }} />
```

`layout` and `id` are optional. Leave both out for a new report, and Save asks
for a name the first time.

`layout` is only where the designer *starts*, like an input's `defaultValue`.
From then on the designer owns it, so edits, selection and undo history
survive your component re-rendering. `onChange` is called after every edit,
undo and redo. It receives the designer's own object, so clone it before
storing it. To open a different report, change `id` (or the component's
`key`). `store` works as described under *Designing inside your own app*.
`createDesigner` also takes the same `onChange` option.

## Designing inside your own app

The command above is the usual way in, and it is a whole application. If you
would rather put the designer in a page of your own — an admin screen where
your users build their own reports — mount it the same way you mount the
viewer: one empty element, and it builds the rest inside it.

```js
import { createDesigner } from 'report-studio/designer';
import 'report-studio/designer.css';

const designer = createDesigner({
    mount: '#design',
    layout,                 // a saved layout, or omit for a blank report
    id: 'sales-summary',    // its filename stem, if it has one
    store                   // where Open and Save read and write; see below
});
```

`store` is how the designer reaches your reports. Leave it out and it talks to
the dev server the CLI runs, which is what the bundled designer page does.
Supply your own to save through your API instead:

```js
const api = '/api/reports';
const json = { 'content-type': 'application/json' };

const store = {
    // required: Open, and Save
    list: async () => fetch(api).then(r => r.json()),
    load: async (id) => fetch(`${api}/${id}`).then(r => r.json()),
    save: async (id, layout) => fetch(`${api}/${id}`,
        { method: 'PUT', headers: json, body: JSON.stringify(layout) }),

    // optional: the sample data the designer previews with. Without these two
    // the preview falls back to data derived from the layout, which is a
    // working designer - just one that never remembers your figures.
    loadData: async (id) => fetch(`${api}/${id}/data`)
        .then(r => (r.ok ? r.json() : null)),
    saveData: async (id, data) => fetch(`${api}/${id}/data`,
        { method: 'PUT', headers: json, body: JSON.stringify(data) }),

    // optional: Delete, in the report picker
    remove: async (id) => fetch(`${api}/${id}`, { method: 'DELETE' })
};
```

`list` returns `{ id, name }` objects — the picker shows the name and opens the
id. `loadData` must resolve to `null`, not throw, when a report has no data
file yet: that is an ordinary state, not a failure.

Give the mount element a height, as you do for the viewer. The designer fills
it, so your own header or tabs can sit above it. An element with no height
gets the full window.

`createDesigner` returns a handle with the current `layout`, `redraw()` and
`destroy()`. `openDesignerWindow(options)` opens the same designer in a window
of its own, for the same reason `openViewerWindow` does.

## TypeScript

Type declarations ship with the package, for every entry point. Nothing to
install. The layout file has types of its own, so a layout loaded from JSON can
be checked:

```ts
import { buildPages, createViewer, type Layout } from 'report-studio';

const layout: Layout = await fetch('./reports/sales-summary.json')
    .then(r => r.json());
```

`Layout`, `ReportItem`, `PaginatedReport`, `ViewerHandle`, `ReportStore`,
`DesignerHandle` and the component props are all exported as types.

## Licence

MIT