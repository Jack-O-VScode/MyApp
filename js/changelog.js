/* What changed, and when.

   Newest first. `version` is the build number the service worker reports, so a
   device can work out what it has not seen yet and show exactly that.

   Kinds are 'new', 'better' and 'fixed', which is as much taxonomy as a release
   note needs. Write them for the person using the app, not for the diff: what
   they can now do, or what has stopped going wrong.
*/
window.CHANGELOG = [
  {
    version: 23, date: '2026-09-17', title: 'Patch notes',
    changes: [
      { kind: 'new', text: 'App settings shows what changed in each build, and every device shows the notes once, the first time it runs a new one.' }
    ]
  },
  {
    version: 22, date: '2026-09-17', title: 'Transfer fingerprints',
    changes: [
      { kind: 'new', text: 'Both devices show a short fingerprint of what they moved. If the two match, the file that arrived is byte-for-byte the one that was sent — which is how you tell a transfer problem from a problem the file already had.' }
    ]
  },
  {
    version: 21, date: '2026-09-17', title: 'Knowing what you are running',
    changes: [
      { kind: 'new', text: 'App settings shows which build this device is actually on.' },
      { kind: 'better', text: 'The app checks for a new build on every launch and reloads itself when one arrives, so closing and reopening twice is no longer needed.' },
      { kind: 'fixed', text: 'A received file is named from its own contents when nothing else says what it is, so a video always arrives as a video.' }
    ]
  },
  {
    version: 20, date: '2026-09-17', title: 'File names',
    changes: [
      { kind: 'fixed', text: 'A received file that arrived with no extension now gets the right one, so iOS will offer Save Video and Windows opens it with the right program.' }
    ]
  },
  {
    version: 19, date: '2026-09-17', title: 'Honest saving',
    changes: [
      { kind: 'fixed', text: 'Receiving a file on iPhone or iPad said “Saved” when nothing had been saved. It now waits at “Received — tap Save”, and only says saved once it is.' },
      { kind: 'better', text: 'Dismissing the share sheet, a blocked share and a finished download are each reported as themselves, and the file stays put so you can try again.' }
    ]
  },
  {
    version: 18, date: '2026-09-16', title: 'Calendar import',
    changes: [
      { kind: 'new', text: 'Import a calendar from the menu reads a .ics file — what Google Calendar, Outlook and Apple Calendar export, and what an airline emails you. Pick the file or paste it in.' },
      { kind: 'better', text: 'Importing the same file twice updates what is already there instead of doubling it, and the app says how many repeat rules it could not store rather than dropping them quietly.' }
    ]
  },
  {
    version: 17, date: '2026-09-16', title: 'Status at a glance',
    changes: [
      { kind: 'better', text: 'Sync and Reminders in the menu are green when on and red when off, and stay legible on any bar colour.' }
    ]
  },
  {
    version: 16, date: '2026-09-15', title: 'Glass',
    changes: [
      { kind: 'new', text: 'Buttons, chips, the top bar and the menu can be frosted glass, with the background blurred behind them. App settings switches between Glass and Solid.' }
    ]
  },
  {
    version: 15, date: '2026-09-13', title: 'Send a file of any size',
    changes: [
      { kind: 'new', text: 'Send to a device: pick which of your devices to send to, both press Ready, and it goes. No size limit.' },
      { kind: 'new', text: 'It connects the two devices directly when it can, which costs nothing and is far quicker on one Wi-Fi, and falls back to relaying a chunk at a time when it cannot.' },
      { kind: 'better', text: 'A transfer that loses its connection part way carries on from the last chunk that landed instead of starting again.' },
      { kind: 'better', text: 'The old drop-it-and-collect-later transfer is still there for when the other device is asleep.' }
    ]
  },
  {
    version: 14, date: '2026-09-13', title: 'Gradients',
    changes: [
      { kind: 'new', text: 'The background can be a gradient between two colours instead of one flat colour.' }
    ]
  },
  {
    version: 13, date: '2026-09-10', title: 'More to change',
    changes: [
      { kind: 'new', text: 'An accent colour for buttons, today’s date and the chips.' },
      { kind: 'new', text: 'Text size: Small, Normal or Large, scaling the whole app.' },
      { kind: 'new', text: 'Clock: follow each device, or hold every one of them to 12- or 24-hour.' }
    ]
  },
  {
    version: 12, date: '2026-09-10', title: 'App settings',
    changes: [
      { kind: 'new', text: 'An App settings screen, with a colour wheel for the page background and one for the top bar. Text and borders are worked out from what you pick, so nothing ends up unreadable.' }
    ]
  },
  {
    version: 9, date: '2026-09-08', title: 'Notification taps',
    changes: [
      { kind: 'fixed', text: 'Tapping a reminder opened the app’s source code instead of the app.' }
    ]
  },
  {
    version: 8, date: '2026-09-08', title: 'One less thing to type',
    changes: [
      { kind: 'better', text: 'A new device only needs an email and a password — the project address and keys ship with the app.' }
    ]
  },
  {
    version: 7, date: '2026-09-07', title: 'Timezones',
    changes: [
      { kind: 'new', text: 'A Timezones screen: search by city, country or state across 252 cities, and star the ones you care about to pin them to the top.' }
    ]
  },
  {
    version: 6, date: '2026-09-06', title: 'Reminders',
    changes: [
      { kind: 'new', text: 'Reminders that arrive with the app closed, on every device. Per-event reminders, and one daily summary of what is due.' }
    ]
  },
  {
    version: 5, date: '2026-09-06', title: 'Repeats, agenda and colours',
    changes: [
      { kind: 'new', text: 'Repeating tasks that roll forward when you tick them.' },
      { kind: 'new', text: 'An agenda view of the calendar, event colours, and checklists inside notes.' }
    ]
  },
  {
    version: 4, date: '2026-09-05', title: 'Transfer',
    changes: [
      { kind: 'new', text: 'Send a file from one device to another through your own project. It is deleted a day later whether it is collected or not.' }
    ]
  },
  {
    version: 3, date: '2026-09-05', title: 'Tasks and Today',
    changes: [
      { kind: 'new', text: 'Tasks with due dates, a Today home screen that pulls together what is on, and tags on notes.' },
      { kind: 'new', text: 'Repeating events — daily, weekly, monthly or yearly — stored once and expanded as needed.' }
    ]
  },
  {
    version: 2, date: '2026-09-05', title: 'Sync',
    changes: [
      { kind: 'new', text: 'Optional sync: type on the PC and see it on the phone. Everything still works with no connection at all.' }
    ]
  },
  {
    version: 1, date: '2026-09-05', title: 'The first one',
    changes: [
      { kind: 'new', text: 'A calendar and a notepad in one app, working offline and installable on Windows, iPhone and iPad.' }
    ]
  }
];
