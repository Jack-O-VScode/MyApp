# Working on this app

Plain static PWA — no build step. Every change a user would notice ships as a
new build, and every build announces itself:

1. Bump `CACHE` in `sw.js` (`calendar-notes-vN` → `vN+1`). Installed copies only
   pick up changes when this changes.
2. Add an entry for that same number at the **top** of `window.CHANGELOG` in
   `js/changelog.js`: `version`, `date`, `title`, and `changes` of kind `new`,
   `better` or `fixed`, written for the person using the app, not the diff.
   The app pops these up, with an X to close, the first time each device opens
   a build it has not seen.
3. Any new script goes in both `index.html` and the `SHELL` list in `sw.js`.

`npm run check` fails if any of that is missing; `npm test` runs the unit tests.
Both run in CI on every push. Neither needs `npm install`.
