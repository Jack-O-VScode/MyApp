# Calendar & Notes

A calendar and a notepad in one app. It is a Progressive Web App (PWA): one
website that installs as a real app on **Windows** and as a home-screen app on
**iPhone/iPad**, works offline, and keeps everything on the device.

The hamburger button (☰) at the top left opens a dropdown for switching between
**Calendar** and **Notes**.

## Features

**Calendar**
- Month grid with today highlighted; ‹ › to page through months, **Today** to jump back.
- Tap a day to see everything on it; **Add event** for a title, date, optional
  time and details. Untimed events show as "All day".
- Tap an event to edit or delete it. Days with events show their first few
  entries on desktop and dots on a phone.

**Notes**
- Create, edit and delete notes; the editor saves as you type.
- Search across every title and body.
- A note left completely blank is discarded instead of cluttering the list.

**Both**
- Works with no connection at all once it has loaded once.
- Light and dark themes follow the system setting.
- **Export backup** / **Import backup** in the menu move data between devices.
  Importing merges by entry, so re-importing the same file changes nothing.

## Install it

### iPhone / iPad
1. Open the site in **Safari** (Chrome on iOS cannot add to the home screen).
2. Tap **Share** → **Add to Home Screen** → **Add**.

It then launches full screen with its own icon, no Safari chrome.

### Windows
1. Open the site in **Edge** or **Chrome**.
2. Click the install icon in the address bar, or browser menu → **Apps** /
   **Cast, save and share** → **Install this site as an app**.

It gets a Start-menu entry and its own window. The in-app menu also has an
**Install app** item when the browser offers one.

> Both browsers only offer installation over `https://` or from `localhost`.

## Put it online

The app is plain static files — no build step, no server code.

**GitHub Pages:** repository **Settings → Pages**, source *Deploy from a
branch*, pick this branch and the `/ (root)` folder. The site then lives at
`https://<user>.github.io/<repo>/`. Every path in the app is relative, so a
subfolder like this works fine.

Any other static host (Netlify, Vercel, Cloudflare Pages, a plain web server)
works the same way: upload the folder.

## Run it locally

Needs [Node.js](https://nodejs.org) only for the tiny dev server:

```
node tools/serve.js          # then open http://localhost:8080
```

On Windows you can double-click **`start-windows.cmd`**, which does the same and
opens the browser for you.

Opening `index.html` straight from the file system also works for a quick look,
but browsers disable service workers and app installation on `file://`, so use
the server (or a real host) for the full thing.

## Where the data lives

Events and notes are stored in the browser's `localStorage` for the site's
origin. Nothing is uploaded and there is no account.

Consequences worth knowing:
- Data does **not** sync between your PC and your phone — use Export/Import.
- Clearing site data for this site (or "Clear History and Website Data" in
  Safari) deletes it, so keep an occasional backup.

## Project layout

```
index.html              markup for both views, the menu and the dialogs
css/app.css             all styling, including the light/dark palette
js/store.js             localStorage data layer for events and notes
js/calendar.js          month grid, day panel, event editor
js/notes.js             note list, search, note editor
js/app.js               menu, view switching, backups, service worker setup
sw.js                   offline cache for the app shell
manifest.webmanifest    name, icons, colours, Windows jump-list shortcuts
icons/                  generated PNG icons (Windows tiles, iOS home screen)
tools/make_icons.py     regenerates icons/ — run after editing the artwork
tools/serve.js          zero-dependency static server for local use
```

After changing any cached file, bump `CACHE` in `sw.js` so installed copies pick
the update up.
