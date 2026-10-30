# Report Studio demo

A Vite app with the report viewer and the designer in one page.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/Shafickbinameer/report-studio/tree/main/examples/demo?file=src%2Fmain.js)

* **Report** shows `reports/sales-summary.json` filled with the data in
  `src/data.js`.
* **Designer** edits the same file. Save with Ctrl+S, switch back to Report,
  and the change is there.

Run it locally:

```sh
npm install
npm run dev
```

The files worth reading:

| File | What it does |
| --- | --- |
| `vite.config.js` | adds the `report-studio/vite` plugin, which serves the designer's save routes |
| `src/main.js` | builds the pages and mounts the viewer and the designer |
| `src/data.js` | the app's own data, keyed by dataset name |
| `reports/sales-summary.json` | the layout the designer saved |
