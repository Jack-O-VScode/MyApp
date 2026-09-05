# Calendar & Notes

A calendar, a task list and a notepad in one personal app. It is a Progressive
Web App (PWA): one website that installs as a real app on **Windows** and as a
home-screen app on **iPhone/iPad**, works offline, and keeps everything on the
device — with optional sync between them.

The hamburger button (☰) at the top left opens a dropdown for switching between
**Today**, **Calendar**, **Tasks**, **Notes** and **Transfer**.

## Features

**Today** — the home screen
- Today's events, anything due or overdue, and your most recent notes on one page.
- One search box across *everything*: events, tasks and notes at once. Hits open
  straight into the right editor.
- Add an event, task or note without leaving the screen.

**Calendar**
- Month grid with today highlighted; ‹ › to page through months, **Today** to jump back.
- **Add event** for a title, date, optional time and details. Untimed events show
  as "All day".
- **Repeating events** — daily, weekly, monthly or yearly, with an optional end
  date. Editing or deleting one asks whether you mean *this day* or *the whole
  series*, so moving a single standup doesn't disturb the rest.
- Tasks due on a day appear on the grid in orange, and under the day's schedule.

**Tasks**
- Type in the quick-add box and press Enter, or use **New task** for a due date
  and notes.
- Due-date shortcuts: Today, Tomorrow, Next week.
- Overdue items are flagged in red; finished ones sink to the bottom and can be
  cleared in one go.
- The number due today shows next to Today and Tasks in the menu, and on the app
  icon itself where the platform supports badges.

**Notes**
- Create, edit and delete notes; the editor saves as you type.
- **Pin** the ones you keep coming back to, and **tag** them — the tag chips
  above the list filter it.
- A note left completely blank is discarded instead of cluttering the list.

**Transfer**
- Send a file from one of your devices to another — drag it in on a PC, or pick
  it from Files/Photos on an iPhone or iPad.
- It appears on your other devices within seconds; **Save** puts it in Downloads
  on Windows or through the share sheet on iOS.
- A courier, not a filing cabinet: everything is deleted 24 hours after it is
  sent, collected or not, and **Remove** clears one sooner.

**Everywhere**
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

## Setting up sync and transfer (complete walkthrough)

Both features are off until you do this once. They run on a free
[Supabase](https://supabase.com) project **you own** — your data sits in your own
database and passes through no server of mine.

Budget about ten minutes. You only do steps 1–3 once, ever; steps 4–5 are
repeated on each device.

### Step 1 — Create the project

1. Go to **supabase.com** and sign up (GitHub sign-in is the quickest).
2. Click **New project**.
3. Fill in:
   - **Name** — anything, e.g. `my-app`.
   - **Database password** — click Generate. You will not need it for this app,
     but save it somewhere; it is the master password for the database.
   - **Region** — pick the one nearest you; it decides how fast sync feels.
4. Click **Create new project** and wait a minute or two while it provisions.

### Step 2 — Create the table and the file bucket

1. In the left sidebar, open **SQL Editor** and click **New query**.
2. Paste the block below and press **Run** (or Ctrl/Cmd + Enter). You should see
   *Success. No rows returned*. The script is safe to run more than once — it drops
   each policy and trigger before recreating it, so a second run repairs a
   half-finished first one instead of failing.

```sql
-- Records: events, tasks and notes.
create table if not exists public.sync_records (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  deleted    boolean not null default false,
  created_at bigint not null,
  updated_at bigint not null,
  synced_at  timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.sync_records enable row level security;

drop policy if exists "own rows" on public.sync_records;
create policy "own rows" on public.sync_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists sync_records_cursor
  on public.sync_records (user_id, synced_at);

create or replace function public.touch_synced_at() returns trigger as $$
begin
  new.synced_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sync_records_touch on public.sync_records;
create trigger sync_records_touch before insert or update
  on public.sync_records for each row execute function public.touch_synced_at();

-- File transfer: a private bucket, with each user confined to their own folder.
insert into storage.buckets (id, name, public)
values ('transfers', 'transfers', false)
on conflict (id) do nothing;

drop policy if exists "own transfer files" on storage.objects;
create policy "own transfer files" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'transfers'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'transfers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
```

The same SQL is inside the app, with a **Copy** button:
*Menu → Sync → "Where do I find these?"*.

### Step 3 — Copy your project URL and key

1. Open **Project Settings** (the gear) → **API**. Newer dashboards split this
   into **API** and **API Keys** — the two things you need are on one of those
   pages either way.
2. Copy the **Project URL** — it looks like `https://abcdefgh.supabase.co`.
3. Copy the **anon public** key — a long string starting `eyJ…`. Some dashboards
   now call this the **publishable** key; it is the same thing. Do **not** use
   the `service_role` / secret key.

> The anon key is designed to be public. The row-level security policies from
> step 2 are what keep your rows readable only by your own account.

### Step 4 — Connect your first device

1. Open the app and choose **Sync** from the ☰ menu.
2. Paste the **Project URL** and the **anon public** key, then **Save**.
3. Enter an email and a password (at least 6 characters) and click
   **Create account**.
4. New projects have *Confirm email* switched on, so Supabase emails you a link.
   Click it, come back, and press **Sign in**.
   - To skip confirmation entirely: in Supabase, **Authentication → Sign In /
     Providers → Email**, turn off **Confirm email**, then create the account again.
5. The Sync panel should say *Up to date*, and the menu chip should read **On**.

### Step 5 — Connect every other device

On each of your other devices — second PC, iPhone, iPad — do exactly the same
except **Sign in** instead of Create account, with the same email and password.
Each one pulls the full history within a second or two.

Use the **same URL** for the app on every device (your GitHub Pages address), and
install it there: *install icon in the address bar* on Windows, *Share → Add to
Home Screen* on iOS.

### Step 6 — Check it works

1. Add a task on one device.
2. Open the app on another; it should appear within a couple of seconds.
3. Open **Transfer**, send a small file, and check it shows up on the other device.

### If something goes wrong

| What you see | What it means |
| --- | --- |
| *Invalid login credentials* | Wrong password, or the account was never confirmed — check your email for the confirmation link. |
| *Email not confirmed* | Click the link Supabase emailed, or turn off **Confirm email** as in step 4. |
| Sync chip stuck on **Error** | Open Sync and read the message. A "relation sync_records does not exist" means step 2 did not run. |
| *No "transfers" bucket…* | The storage half of step 2 did not run. Re-run just that part. |
| *…violates row-level security policy* | The policies did not get created. Re-run step 2. |
| *policy "own rows" … already exists* | An older copy of this script was not re-runnable. Use the current block, which drops each policy and trigger before recreating it. |
| Everything hangs offline | The project may be paused (see below); open the dashboard to resume it. |

### Living with the free tier

- Roughly 500 MB of database and 1 GB of file storage on the free plan, with a
  monthly bandwidth allowance. Text records use almost none of it; the file
  bucket is the part to keep an eye on, which is why transfers self-delete.
- Uploads are capped at **50 MB per file** by default. Raise it under
  **Storage → Buckets → transfers → Settings**, within your plan's limit.
- Free projects **pause after about a week with no activity**. Opening the
  dashboard resumes them. Daily use never hits this.
- Check Supabase's current limits before relying on the exact numbers above.

## Sync: how it behaves

- Local first: every view reads from the device, so the app is exactly as fast
  and as offline-capable as before. Sync happens in the background.
- Changes upload about a second after you stop typing, and download when you
  open the app, switch back to it, or every 15 seconds while it is in front.
- Offline edits queue up and go out when the connection returns.
- Deletes are tracked, so deleting on one device does not come back from the other.
- A repeating event syncs as the single rule it is, not as hundreds of copies;
  skipping one occurrence syncs too.
- Conflicts resolve last-write-wins per item, using device clocks. Editing the
  *same* note on two devices at once keeps the later save and drops the earlier
  one; separate items never conflict.
- Any number of devices works — they all sign in with the same email.
- **Disconnect** stops syncing on that device and leaves its data in place.

## Transfer: how it behaves

- Files go to a private `transfers` bucket in your project, under a folder named
  after your account, which is what the storage policy locks down.
- Sending is drag-and-drop or a file picker; on iOS the picker offers Files,
  Photos and the camera.
- **Save** downloads normally on Windows. On iPhone and iPad it opens the share
  sheet, so you can Save to Files, AirDrop it onward, or open it in another app.
- Nothing is deleted automatically when you save it — with four devices, one
  collecting a file should not snatch it from the rest. Everything expires 24
  hours after being sent, and the list sweeps stale files whenever it loads.
- Files are encrypted in transit and sit in your own project, but they are not
  end-to-end encrypted: someone with access to your Supabase dashboard could
  read them within that 24-hour window.

## Where the data lives

Events, tasks and notes are stored in the browser's `localStorage` for the
site's origin, and mirrored to your Supabase project only if you turn sync on.
Transferred files never touch local storage — they live in the bucket until they
are removed or expire.

Consequences worth knowing:
- Without sync, the PC and the phone hold separate data — use Export/Import.
- Clearing site data for this site (or "Clear History and Website Data" in
  Safari) deletes the local copy, so keep an occasional backup.

## Project layout

```
index.html              markup for all five views, the menu and the dialogs
css/app.css             all styling, including the light/dark palette
js/store.js             data layer: events, tasks, notes, recurrence, search
js/calendar.js          month grid, day panel, event editor
js/tasks.js             task list, task editor, shared task-row renderer
js/notes.js             note list, tags, note editor
js/today.js             the Today screen and cross-app search
js/transfers.js         device-to-device file transfer via Supabase Storage
js/sync.js              optional Supabase sync: auth, pull/push, merge
js/app.js               menu, view switching, badge, sync panel, backups
sw.js                   offline cache for the app shell
manifest.webmanifest    name, icons, colours, Windows jump-list shortcuts
icons/                  generated PNG icons (Windows tiles, iOS home screen)
tools/make_icons.py     regenerates icons/ — run after editing the artwork
tools/serve.js          zero-dependency static server for local use
```

After changing any cached file, bump `CACHE` in `sw.js` so installed copies pick
the update up.
