/* What changed, and when.

   Newest first. `version` is the build number the service worker reports, so a
   device can work out what it has not seen yet and show exactly that.

   Kinds are 'new', 'better' and 'fixed', which is as much taxonomy as a release
   note needs. Write them for the person using the app, not for the diff: what
   they can now do, or what has stopped going wrong.
*/
window.CHANGELOG = [
  {
    version: 31, date: '2026-10-28', title: 'Lock notes with a password',
    changes: [
      { kind: 'new', text: 'Lock a note with a password: open it and tap the padlock. The text is encrypted on your device before it is saved or synced, so it stays unreadable everywhere — in sync and in backups too. The title stays visible so you can find it.' },
      { kind: 'new', text: 'A locked note asks for its password each time you open it, and locks again when you leave it or after a couple of minutes in the background. You can add a hint, change the password, or remove the lock.' },
      { kind: 'better', text: 'There is no way to reset a forgotten password — not for you, not for anyone. That is what keeps the note private, so choose one you will remember.' }
    ]
  },
  {
    version: 30, date: '2026-10-28', title: 'Folders, any size, device to device',
    changes: [
      { kind: 'new', text: 'Send to a device takes whole folders too, with no size limit: pick the device, press Choose a folder, and both say Ready as usual. It arrives as one .zip that opens back into the folder with a tap.' },
      { kind: 'better', text: 'Zipping a folder of photos or videos is much quicker: files that are already compressed go in as they are instead of being squeezed for nothing.' },
      { kind: 'better', text: 'Folders past 4 GB zip properly, in the larger format every computer and phone still opens.' }
    ]
  },
  {
    version: 29, date: '2026-10-27', title: 'Send a whole folder',
    changes: [
      { kind: 'new', text: 'Leave a whole folder for your other devices to collect: drag it onto Transfer, or press Choose a folder. It is zipped into one file on the way — subfolders and all — and opens back into the same folder with a tap on Windows, Mac, iPhone or iPad.' },
      { kind: 'better', text: 'The 50 MB limit applies to the zipped folder, so text and documents often fit even when the folder itself is bigger. Waiting folders show as “Folder · 12 files”.' },
      { kind: 'better', text: 'iPhone and iPad cannot pick a folder from a web page, so Transfer says how to do it there instead: Compress it in Files, then send the .zip.' }
    ]
  },
  {
    version: 28, date: '2026-10-20', title: 'Clearing out a date range',
    changes: [
      { kind: 'new', text: 'Delete events in a date range, from the menu. Pick the first and last day, see how many events that is before anything goes, and tick “Only events that came from an imported calendar” to leave your own alone — handy if you imported the wrong one.' },
      { kind: 'new', text: 'Changed your mind? Undo puts everything back, as long as the window is still open.' }
    ]
  },
  {
    version: 27, date: '2026-10-13', title: 'Patch notes, first thing',
    changes: [
      { kind: 'better', text: 'After an update, these notes are the first thing you see when the app opens — every update, on every device, once. Close them with the X.' },
      { kind: 'fixed', text: 'The notes no longer wait on the offline cache to say which build is running, so they turn up even where it is slow, blocked or switched off.' }
    ]
  },
  {
    version: 26, date: '2026-10-13', title: 'Drag, type, and say what you mean',
    changes: [
      { kind: 'new', text: 'Drag events and tasks to another day in Week and Month. Day view is now a timeline: drag an event up or down to change its time, or pull its bottom edge to change how long it runs. On a phone, hold it for a moment first.' },
      { kind: 'new', text: 'Events can have an end time.' },
      { kind: 'new', text: 'Type it how you would say it: “Lunch with Sam fri 1pm” in the Calendar box, or “Pay rent every month on the 1st !high” in Tasks. The box shows what it understood before you press Enter.' },
      { kind: 'new', text: 'Tasks have a priority, a list of steps to tick off, and their own reminder time. Sort the list by due date, priority or newest.' },
      { kind: 'new', text: 'Notes understand Markdown — headings, bold, italic, lists, links — with a Preview button and a small formatting bar. Checkboxes can be ticked right in the preview.' },
      { kind: 'new', text: 'Attach pictures to a note. They are kept in your own sync project and stay viewable offline once seen.' },
      { kind: 'new', text: 'Meeting notes: open an event and press Add notes for a note tied to it (to that day, for a repeating one). Events with notes show a 📝.' },
      { kind: 'new', text: 'Files you leave for later can be kept for however many minutes, hours or days you type — or set never to expire.' },
      { kind: 'better', text: 'Moving one day of a repeating event moves only that day, and says so.' },
      { kind: 'fixed', text: 'Folders used behind the scenes no longer show up as files waiting to be picked up.' }
    ]
  },
  {
    version: 25, date: '2026-09-17', title: 'Every font your device has',
    changes: [
      { kind: 'new', text: 'Font is now a searchable list of around seventy faces instead of four. Type to narrow it down, and every name is drawn in its own font so you can see what you are choosing.' },
      { kind: 'new', text: 'Installed a font yourself? Type its name and the app will offer it, whether or not it is on the list.' },
      { kind: 'better', text: 'The list only offers what your device actually has, so nothing quietly falls back to a face you did not pick — which is why the phone and the PC show different lists.' }
    ]
  },
  {
    version: 24, date: '2026-09-17', title: 'A calendar you can look at',
    changes: [
      { kind: 'new', text: 'The calendar switches between Day, Week, Month, Year and Agenda. Week gives every day its own column, and Year lays out all twelve months with a dot on the days something is on.' },
      { kind: 'new', text: 'Back and forward now step by whatever you are looking at: one day, one week, one month or a whole year.' },
      { kind: 'new', text: 'App settings can change the font: System, Rounded, Serif or Mono.' },
      { kind: 'new', text: 'Today knows the time. A line marks where you are in the day, what has already happened is dimmed, and the next thing is picked out.' },
      { kind: 'better', text: 'On a wide screen Today runs in two columns instead of one long one.' },
      { kind: 'better', text: 'Event colours now show on the home screen and across every calendar view, not just in the editor.' },
      { kind: 'better', text: 'Things fade and slide in rather than appearing all at once — and hold still if your device asks for less motion.' },
      { kind: 'fixed', text: 'The date navigation sat inside the month grid, so Day view had no way to move between days. It now sits above the whole calendar, where every view can reach it.' },
      { kind: 'fixed', text: 'A week label read “13 – September 19, 2026”. It now reads properly, in whatever order your language puts the day, month and year.' },
      { kind: 'fixed', text: 'Week view on a phone showed empty columns. It shows what is on each day again.' }
    ]
  },
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
