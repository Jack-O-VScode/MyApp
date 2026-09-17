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
- **A sense of now**: a line marks where you are in the day, what has already
  happened is dimmed, and the next thing is picked out. It keeps itself right
  without you reloading, and stops counting while the app is in the background.
- On a wide screen it runs in two columns rather than one long one.
- One search box across *everything*: events, tasks and notes at once. Hits open
  straight into the right editor.
- Add an event, task or note without leaving the screen.

**Calendar**
- Five views — **Day**, **Week**, **Month**, **Year** and **Agenda** — with ‹ ›
  stepping by whatever you are looking at, and **Today** to jump back. Week gives
  each day its own column; Year lays out all twelve months and puts a dot on the
  days something is on, so a glance shows where the year is busy. The date and
  the arrows sit above the whole calendar, so every view can move.
- Today is highlighted, weekends are shaded, and every event carries its colour
  through all five views and onto the home screen.
- **Add event** for a title, date, optional time and details. Untimed events show
  as "All day".
- **Repeating events** — daily, weekly, monthly or yearly, with an optional end
  date. Editing or deleting one asks whether you mean *this day* or *the whole
  series*, so moving a single standup doesn't disturb the rest.
- Tasks due on a day appear on the grid in orange, and under the day's schedule.
- **Import a calendar** (in the menu) reads a `.ics` file — what Google
  Calendar, Outlook and Apple Calendar export, and what an airline or hotel
  emails you. Pick the file or paste its contents. It copies the events **once**;
  it does not stay connected, so anything added to the other calendar afterwards
  will not turn up here. Importing the same file again updates what is already
  here rather than making a second copy, because events are matched on the
  file's own IDs.
- The `.ics` repeat format says far more than this app stores — "the third
  Thursday of every month" has nowhere to live here — so anything that does not
  fit is kept as the single day it starts on, and the app tells you how many.

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

**Transfer** — two ways, for two different situations

*Send to a device* — any size, both ends present
- Pick which of your devices to send to; it lists the ones that are awake.
- Both sides press **Ready**, then it goes. That requirement is what makes the
  rest of it work.
- It tries a **direct** WebRTC connection first: nothing but the handshake
  touches the server, so there is no size limit and no bandwidth cost, and on
  one Wi-Fi it is far quicker. If no direct route exists it **relays** through
  the storage bucket instead — one 32 MB chunk at a time, deleted the moment the
  other end confirms it, so a file of any size fits inside the storage quota.
- If the direct route dies part way it drops to the relay and **carries on from
  the last chunk that landed**, rather than starting again.
- On a desktop browser it streams straight into the file you picked when you
  accepted, so when it finishes it is already on disk and the screen names it.
- iPhone and iPad have no such API. There the file is collected first and the
  transfer ends at **Received — tap Save**, with a Save button that opens the
  share sheet (Save to Files, Photos, AirDrop, anywhere). That button is not
  decoration: iOS only lets a page hand a file to the system while a tap is
  being processed, so it cannot be done automatically when the transfer
  happens to finish. Until you tap it the file lives only in the open page, and
  the screen says as much rather than claiming to have saved it.
- A file whose name carries no extension gets one matching what it actually is
  before being handed over. iOS decides what a file is from its name as much as
  from its type, and **Save Video** will not take something it cannot name.
- The app warns before accepting something that looks too big for the device.
- Both ends show a short **fingerprint** of what they moved — the same hash of
  the same chunks. Matching fingerprints mean the file that arrived is the file
  that was sent, which is what separates a transfer problem from a problem the
  file already had.

*Leave it for later* — up to 50 MB, no one has to be present
- Drop a file and it waits in the bucket; another device collects it whenever.
- Everything is deleted 24 hours after it is sent, collected or not, and
  **Remove** clears one sooner.
- 50 MB is Supabase's per-object ceiling on the free plan and cannot be raised
  there, which is exactly why *Send to a device* exists.

**App settings**
- **App theme colour** — colour wheels for the background (the page behind
  everything), the bar (the strip at the top and the menu that drops out of it)
  and the accent (buttons, today's date, the day you have picked, the chips).
  The background can be **Solid** — one colour — or a **Gradient** between two,
  running top to bottom.
  Everything else — text, muted text, borders, and what is written on a coloured
  button — is worked out from those, by contrast rather than by taste, so no
  combination can leave you with writing you cannot read. A gradient has one
  text colour over two ends, so ends far apart are pulled towards each other
  until both work; ends that already do are left alone. Nine presets are offered
  as starting points, and **Reset** hands the app back to your device's
  light/dark setting.
- **Buttons** — **Glass** frosts the buttons, chips, bar and menu and blurs
  whatever is behind them, which is worth having over a gradient background;
  **Solid** is the flat look. The translucency is part of the contrast maths,
  not a coat of paint on top: a see-through button is judged on the colour it
  actually ends up looking, over a card and over the page alike, so what is
  written on it stays legible either way. Where a browser cannot blur, or the
  system asks for reduced transparency, the solid style stands in.
- **Version** — which build this device is actually running, read from the
  service worker itself. When a new one takes over, the app says so and reloads,
  rather than leaving you to guess whether a fix has arrived.
- **See patch notes** lists every release and what changed in it. A device that
  starts a build it has not run before shows the notes for everything it missed,
  once, with an X to close. The mark of what has been seen is kept per device,
  so reading them on the PC does not rob the phone of them, and a first install
  shows nothing — there is no update to announce.
- **Font** — System, Rounded, Serif or Mono. All four are faces the platforms
  already ship, so nothing is downloaded, there is no flash of the wrong one,
  and it works with no connection.
- **Text size** — Small, Normal or Large, scaling the whole app.
- **Clock** — follow each device, or hold all of them to 12- or 24-hour. Events,
  tasks, notes and the Timezones screen all read from the one setting.
- All of it rides along with sync, so the app looks the same on every device.

**Reminders** (optional, extra setup)
- Per-event reminders, from "when it starts" to a day before.
- One daily summary of what is due, instead of a ping per task.
- They arrive with the app closed, on iPhone, iPad and Windows alike.

**Everywhere**
- Optional **sync**: type on the PC, see it on the phone (setup below).
- **Sync** and **Reminders** carry a status chip in the menu: green when on and
  working, red when off or broken, and the word says which. The colours are
  derived against whatever bar colour is in use, so they stay both legible and
  clearly green-or-red on any of them.
- Screens and menus fade and slide in rather than appearing all at once. A
  device that asks for reduced motion gets none of it.
- Works with no connection at all once it has loaded once.
- Light and dark themes follow the system setting until you pick your own in
  **App settings**.
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
-- Reminders: instants the app has worked out, and the devices to notify.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  label      text,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own devices" on public.push_subscriptions;
create policy "own devices" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.reminders (
  user_id  uuid not null references auth.users(id) on delete cascade,
  id       text not null,
  fire_at  timestamptz not null,
  title    text not null,
  body     text,
  url      text,
  sent_at  timestamptz,
  primary key (user_id, id)
);

alter table public.reminders enable row level security;

drop policy if exists "own reminders" on public.reminders;
create policy "own reminders" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists reminders_pending
  on public.reminders (fire_at) where sent_at is null;
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
>
> It ships in `js/config.js` so no device has to be told it. Once your own
> devices are enrolled, turn off **Allow new users to sign up** under
> *Authentication → Sign In / Providers* in Supabase: after that the published
> key is of no use to anyone else, since it can neither read data nor create an
> account.

### Step 4 — Connect your first device

The project this copy of the app belongs to lives in `js/config.js`, so there is
nothing to paste on any device — only an account to sign in with. (Use **Change
project** in the Sync panel, or blank those values out, to point a copy
somewhere else.)

1. Open the app and choose **Sync** from the ☰ menu.
2. Enter an email and a password (at least 6 characters) and click
   **Create account**.
4. New projects have *Confirm email* switched on, so Supabase emails you a link.
   Click it, come back, and press **Sign in**.
   - To skip confirmation entirely: in Supabase, **Authentication → Sign In /
     Providers → Email**, turn off **Confirm email**, then create the account again.
5. The Sync panel should say *Up to date*, and the menu chip should read **On**.

### Step 5 — Connect every other device

On each of your other devices — second PC, iPhone, iPad — open the app, go to
**Sync**, and press **Sign in** with the same email and password. That is the
whole setup for a new device.
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
- A single stored object is capped at **50 MB on the free plan** — that is the
  plan's ceiling, not a bucket setting, so it cannot be raised there. *Send to a
  device* works around it by chunking, and a direct transfer skips storage
  altogether.
- Egress counts every byte downloaded. A relayed 1 GB file spends 1 GB of the
  monthly allowance; a direct one spends none of it.
- Free projects **pause after about a week with no activity**. Opening the
  dashboard resumes them. Daily use never hits this.
- Check Supabase's current limits before relying on the exact numbers above.

## Send to a device: the extra setup

*Send to a device* needs three small tables on top of the sync setup. Paste
[`supabase/beam.sql`](supabase/beam.sql) into **SQL Editor → New query** in your
Supabase dashboard and run it. It is re-runnable, so running it twice is safe.

| Table | What it holds |
| --- | --- |
| `devices` | one row per device: its name and when it last said hello |
| `transfer_sessions` | one row per offered transfer, and how far it has got |
| `transfer_signals` | WebRTC offers, answers and candidates, in transit only |

Everything is scoped to `auth.uid()` by row-level security, so a device only
ever sees your own rows. Nothing here is worth keeping: `sweep_transfers()` is
included if you want to schedule a tidy-up alongside the reminder job, but stale
rows are harmless either way.

Two things worth knowing:

- **Both devices must be awake.** A device says hello every 15 seconds while the
  app is open, and counts as awake for 50 seconds after. Close the app and it
  drops off the list.
- **A direct connection is not always possible.** It uses public STUN servers to
  find a route, which works on the same network and across most home
  connections. Where it cannot, it falls back to relaying through storage
  automatically — you only notice because it says "Relayed" and counts against
  the bandwidth allowance. Getting a direct route in the hard cases would mean
  running a TURN relay, which is not included.

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

## Reminders: the extra setup

Reminders are the one feature that needs something running on a schedule, so
they take a few more steps than the rest. Everything else works without them.

**How it fits together:** the app works out exactly when each reminder should
fire — including the next occurrence of a repeating event — and writes those
instants to a `reminders` table. A small function in your project wakes once a
minute, asks "what is due?", and sends it. No recurrence logic on the server.

### 1. Tables

Already included in the setup SQL in the previous section (`push_subscriptions`
and `reminders`). If you ran that block before reminders existed, run it again —
it is safe to repeat.

### 2. Keys

Push needs a VAPID key pair: the public half identifies your sender to the
browser, the private half stays on the server. Generate a pair with:

```
npx web-push generate-vapid-keys
```

or ask me and I will generate one for you.

### 3. Deploy the function

The function lives at `supabase/functions/send-reminders/index.ts`.

**From the dashboard** (no tools to install): Supabase → **Edge Functions** →
**Deploy a new function** → name it `send-reminders`, paste the file's contents,
and turn **off** "Verify JWT" so the scheduler can reach it.

**Or with the CLI:**

```
supabase functions deploy send-reminders --no-verify-jwt
```

### 4. Secrets

Under **Edge Functions → Secrets** (or `supabase secrets set NAME=value`):

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | the public half of the pair |
| `VAPID_PRIVATE_KEY` | the private half — only here, never in the app |
| `VAPID_SUBJECT` | `mailto:` and your email address |
| `CRON_SECRET` | any long random string; the scheduler sends it back |

### 5. Schedule it

In the SQL Editor, with your own project ref and `CRON_SECRET` filled in:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('send-reminders')
  where exists (select 1 from cron.job where jobname = 'send-reminders');

select cron.schedule('send-reminders', '* * * * *', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', 'YOUR-CRON-SECRET'
    ),
    body := '{}'::jsonb
  );
$$);
```

Supabase's dashboard also has a **Cron** section that can schedule the same call
if you prefer clicking to SQL.

### 6. Turn them on, per device

Menu → **Reminders** → **Turn on here**. The public key ships in `js/config.js`,
so there is nothing to paste. Each device needs its own permission — a phone and a PC do not share one. On iPhone
and iPad the app must be on the Home Screen first; Safari does not allow push to
a page in a tab.

Then **Send a test**: it writes a reminder fifteen seconds out, so if the
notification arrives, the whole chain works.

### What you get

- **Per event**, opted in one at a time: none, at the start, or 10 / 30 minutes,
  1 / 2 hours, or a day before. New events pick up whatever default you set.
- **One daily summary** of what is due, at a time you choose, rather than a
  separate ping per task. Today's summary counts anything overdue.
- An all-day event has no clock time of its own, so its reminder uses the same
  time as the daily summary.

### If nothing arrives

- Check **Edge Functions → Logs** in Supabase; the function reports how many
  reminders it found and sent each run.
- `select * from cron.job_run_details order by start_time desc limit 5;` shows
  whether the schedule is actually firing.
- A blocked notification permission is silent. Check the site's permissions in
  the browser, or in iOS Settings → Notifications under the app's name.
- Reminders only exist while the schedule is fresh: the app rewrites it when
  data changes and when you open it, so a device that has not been opened for
  weeks contributes nothing new.

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
index.html              markup for every view, the menu and the dialogs
css/app.css             all styling, including the light/dark palette
js/config.js            which project this copy connects to, and the push key
js/changelog.js         what changed in each release, newest first
js/theme.js             derives the palette from the two chosen colours; runs
                        from <head> so a custom app never flashes the default
js/store.js             data layer: events, tasks, notes, recurrence, search
js/ics.js               reads .ics calendar files: folding, escapes, zones, rules
js/format.js            clock times, in whichever format App settings asks for
js/calendar.js          day, week, month, year and agenda views, event editor
js/tasks.js             task list, task editor, shared task-row renderer
js/notes.js             note list, tags, note editor
js/today.js             the Today screen and cross-app search
js/zones.js             the city list behind the Timezones screen
js/clocks.js            the Timezones screen: search, pinning, live clocks
js/devices.js           which devices this account has, and which are awake
js/beam.js              any-size transfer: WebRTC first, chunked relay as backup
js/beam-ui.js           the "Send to a device" half of the Transfer screen
js/transfers.js         the drop-it-and-collect-later half
js/reminders.js         works out when reminders fire and keeps the table current
js/settings.js          the App settings screen
supabase/functions/     the scheduled sender that turns those rows into pushes
supabase/beam.sql       tables for the device list, sessions and signalling
js/sync.js              optional Supabase sync: auth, pull/push, merge
js/app.js               menu, view switching, badge, sync panel, backups
sw.js                   offline cache for the app shell
manifest.webmanifest    name, icons, colours, Windows jump-list shortcuts
icons/                  generated PNG icons (Windows tiles, iOS home screen)
tools/make_icons.py     regenerates icons/ and the manifest — run after editing
                        the artwork or DEFAULT_THEME
tools/serve.js          zero-dependency static server for local use
```

After changing any cached file, bump `CACHE` in `sw.js` so installed copies pick
the update up.
