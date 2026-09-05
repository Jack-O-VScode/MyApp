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
- Optional **sync**: type on the PC, see it on the phone (setup below).
- Works with no connection at all once it has loaded once.
- Light and dark themes follow the system setting.
- **Export backup** / **Import backup** in the menu write and read a JSON file.
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

## Sync between devices

Off by default. With it on, an edit on the PC shows up on the phone (and the
other way round) without touching a file.

It syncs through a free [Supabase](https://supabase.com) project **you own** —
there is no server of mine in the middle, and your data sits in your own
database.

**Setting it up** (about five minutes, once):

1. Create a free Supabase account and start a new project.
2. In the project's **SQL Editor**, paste the block the app shows under
   *Menu → Sync → "Where do I find these?"* (there is a **Copy** button) and run it.
   It creates one table and locks it to the signed-in user with row-level security.
3. In **Project Settings → API**, copy the **Project URL** and the **anon public**
   key into the app's Sync panel, then **Save**.
4. **Create account** with any email and password. That account is yours alone.
   New projects have *Confirm email* switched on, so Supabase emails you a link
   first — click it, then **Sign in**. (To skip that, turn off
   **Authentication → Sign In / Providers → Confirm email** in the dashboard.)
5. On the other device, open the app, paste the same URL and key, and **Sign in**
   with the same email. Both devices converge within a second or two.

**How it behaves**
- Local first: every view reads from the device, so the app is exactly as fast
  and as offline-capable as before. Sync happens in the background.
- Changes upload about a second after you stop typing, and download when you
  open the app, switch back to it, or every 15 seconds while it is in front.
- Offline edits queue up and go out when the connection returns.
- Deletes are tracked, so deleting on one device does not come back from the other.
- Conflicts resolve last-write-wins per item, using device clocks. Editing the
  *same* note on two devices at once keeps the later save and drops the earlier
  one; separate items never conflict.
- **Disconnect** stops syncing on that device and leaves its data in place.

**Worth knowing:** the anon key is designed to be published — row-level security
is what protects the rows. Session tokens live in `localStorage` like any web
app, so treat a shared computer accordingly. Supabase pauses free projects after
a week of inactivity; opening the dashboard resumes them.

## Where the data lives

Events and notes are stored in the browser's `localStorage` for the site's
origin, and mirrored to your Supabase project only if you turn sync on.

Consequences worth knowing:
- Without sync, the PC and the phone hold separate data — use Export/Import.
- Clearing site data for this site (or "Clear History and Website Data" in
  Safari) deletes the local copy, so keep an occasional backup.

## Project layout

```
index.html              markup for both views, the menu and the dialogs
css/app.css             all styling, including the light/dark palette
js/store.js             localStorage data layer for events and notes
js/calendar.js          month grid, day panel, event editor
js/notes.js             note list, search, note editor
js/sync.js              optional Supabase sync: auth, pull/push, merge
js/app.js               menu, view switching, sync panel, backups, service worker
sw.js                   offline cache for the app shell
manifest.webmanifest    name, icons, colours, Windows jump-list shortcuts
icons/                  generated PNG icons (Windows tiles, iOS home screen)
tools/make_icons.py     regenerates icons/ — run after editing the artwork
tools/serve.js          zero-dependency static server for local use
```

After changing any cached file, bump `CACHE` in `sw.js` so installed copies pick
the update up.
