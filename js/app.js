/* App shell: the hamburger menu, switching between views, the app-icon badge,
   backups and the service worker. */
(function () {
  'use strict';

  var VIEWS = {
    today: { title: 'Today', action: '' },
    calendar: { title: 'Calendar', action: 'Today' },
    clocks: { title: 'Timezones', action: '' },
    tasks: { title: 'Tasks', action: 'New task' },
    notes: { title: 'Notes', action: 'New note' },
    transfer: { title: 'Transfer', action: '' },
    settings: { title: 'App settings', action: '' }
  };

  var menuButton, menu, scrim, viewTitle, actionButton, toastEl;
  var currentView = 'today';
  var toastTimer = null;
  var installPrompt = null;

  /* ---------------------------------------------------------------- menu -- */

  function openMenu() {
    menu.hidden = false;
    scrim.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
    var first = menu.querySelector('.menu-item:not([hidden])');
    if (first) first.focus();
  }

  function closeMenu(refocus) {
    menu.hidden = true;
    scrim.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    if (refocus) menuButton.focus();
  }

  function menuIsOpen() {
    return !menu.hidden;
  }

  /* -------------------------------------------------------------- routing -- */

  var RENDER = {
    today: function () { TodayView.render(); },
    calendar: function () { CalendarView.render(); },
    clocks: function () { ClocksView.render(); },
    tasks: function () { TasksView.render(); },
    notes: function () { NotesView.render(); },
    transfer: function () { TransfersView.render(); },
    settings: function () { SettingsView.render(); }
  };

  function showView(name) {
    if (!VIEWS[name]) name = 'today';
    if (name !== 'today') TodayView.clearSearch();
    currentView = name;

    Object.keys(VIEWS).forEach(function (key) {
      document.getElementById('view-' + key).hidden = key !== name;
    });
    viewTitle.textContent = VIEWS[name].title;
    actionButton.textContent = VIEWS[name].action;
    actionButton.hidden = !VIEWS[name].action;

    Array.prototype.forEach.call(menu.querySelectorAll('[data-view]'), function (item) {
      var isCurrent = item.dataset.view === name;
      item.classList.toggle('is-current', isCurrent);
      item.setAttribute('aria-current', isCurrent ? 'page' : 'false');
    });

    RENDER[name]();
    window.scrollTo(0, 0);
  }

  function routeFromHash() {
    var name = (location.hash || '').replace('#', '');
    showView(VIEWS[name] ? name : 'today');
  }

  function navigate(name) {
    if (location.hash === '#' + name) showView(name);
    else location.hash = name;
  }

  /* -------------------------------------------------------------- backups -- */

  function timestampedName() {
    var now = new Date();
    var stamp = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    return 'calendar-notes-backup-' + stamp + '.json';
  }

  function exportBackup() {
    var text = JSON.stringify(Store.exportData(), null, 2);
    var name = timestampedName();
    var file = null;

    try {
      file = new File([text], name, { type: 'application/json' });
    } catch (err) {
      file = null;   // Older Safari has no File constructor.
    }

    // iOS has no real downloads folder, so offer the share sheet there and fall
    // back to a plain download everywhere else.
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: 'Calendar & Notes backup' }).catch(function () {});
      return;
    }

    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Backup saved');
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var result = Store.importData(JSON.parse(String(reader.result)));
        CalendarView.render();
        NotesView.render();
        toast('Imported ' + result.added + ' new, updated ' + result.updated);
      } catch (err) {
        toast(err.message || 'That file could not be read.');
      }
    };
    reader.onerror = function () { toast('That file could not be read.'); };
    reader.readAsText(file);
  }

  /* ----------------------------------------------------------------- sync -- */

  var syncEls = {};
  var showProjectFields = false;

  function syncStateText(info) {
    if (!info.configured) return 'Add a project below to sync with your other devices.';
    if (!info.signedIn) {
      return Sync.hasBuiltIn() && !showProjectFields
        ? 'Sign in with the same email you use on your other devices.'
        : 'Project saved. Sign in to start syncing.';
    }
    switch (info.state) {
      case 'syncing': return 'Syncing…';
      case 'offline': return 'Offline — changes will go up when the connection returns.';
      case 'error': return info.message || 'Sync failed.';
      case 'signed-out': return info.message || 'Sign in again.';
      default:
        return info.lastSyncedAt
          ? 'Up to date · last synced ' + relativeTime(info.lastSyncedAt)
          : 'Connected.';
    }
  }

  function syncChipText(info) {
    if (!info.configured || !info.signedIn) return 'Off';
    if (info.state === 'syncing') return 'Syncing';
    if (info.state === 'offline') return 'Offline';
    if (info.state === 'error' || info.state === 'signed-out') return 'Error';
    return 'On';
  }

  function relativeTime(stamp) {
    var seconds = Math.round((Date.now() - stamp) / 1000);
    if (seconds < 60) return 'just now';
    var minutes = Math.round(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.round(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    return new Date(stamp).toLocaleDateString();
  }

  function renderSync() {
    var info = Sync.getStatus();

    syncEls.chip.textContent = syncChipText(info);
    syncEls.chip.dataset.state = info.state;
    syncEls.state.textContent = syncStateText(info);
    syncEls.state.dataset.state = info.state;

    // Only one of the three steps is ever on screen. With a project built in,
    // the first step is skipped entirely unless it is asked for.
    var needsProject = !info.configured || showProjectFields;
    syncEls.stepServer.hidden = !needsProject;
    syncEls.stepAccount.hidden = needsProject || info.signedIn;
    syncEls.stepConnected.hidden = needsProject || !info.signedIn;
    syncEls.email.textContent = info.email || '';
    syncEls.revert.hidden = !Sync.hasBuiltIn();
  }

  function syncError(message) {
    syncEls.error.textContent = message;
    syncEls.error.hidden = !message;
  }

  function busy(button, isBusy, label) {
    button.disabled = isBusy;
    if (isBusy) {
      button.dataset.label = button.textContent;
      button.textContent = label;
    } else if (button.dataset.label) {
      button.textContent = button.dataset.label;
    }
  }

  function authenticate(button, action, email, password) {
    if (!email || !password) return syncError('Enter your email and password.');
    if (password.length < 6) return syncError('Supabase needs a password of at least 6 characters.');
    syncError('');
    busy(button, true, 'Working…');
    action(email, password).then(function () {
      syncEls.password.value = '';
      renderSync();
      toast('Sync is on.');
    }).catch(function (err) {
      syncError(err.message || 'That did not work.');
    }).then(function () {
      busy(button, false);
      renderSync();
    });
  }

  // Clipboard access can be refused (or missing on older Safari); selecting the
  // text at least leaves the user one tap from copying it.
  function selectSql() {
    var block = document.getElementById('sync-sql');
    var range = document.createRange();
    range.selectNodeContents(block);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function openSync() {
    showProjectFields = false;
    var stored = Sync.getConfig();
    syncEls.url.value = stored.url;
    syncEls.key.value = stored.anonKey;
    syncError('');
    renderSync();
    syncEls.modal.hidden = false;
  }

  function setupSync() {
    syncEls = {
      modal: document.getElementById('sync-modal'),
      chip: document.getElementById('sync-chip'),
      state: document.getElementById('sync-state'),
      error: document.getElementById('sync-error'),
      stepServer: document.getElementById('sync-step-server'),
      stepAccount: document.getElementById('sync-step-account'),
      stepConnected: document.getElementById('sync-step-connected'),
      url: document.getElementById('sync-url'),
      key: document.getElementById('sync-key'),
      emailInput: document.getElementById('sync-email-input'),
      revert: document.getElementById('sync-use-builtin'),
      password: document.getElementById('sync-password'),
      email: document.getElementById('sync-email')
    };

    document.getElementById('sync-save').addEventListener('click', function () {
      var url = syncEls.url.value.trim();
      var key = syncEls.key.value.trim();
      if (!/^https?:\/\//.test(url)) return syncError('The project URL should start with https://');
      if (!key) return syncError('Paste the anon public key too.');
      syncError('');
      Sync.configure(url, key);
      showProjectFields = false;
      renderSync();
      syncEls.emailInput.focus();
    });

    document.getElementById('sync-copy-sql').addEventListener('click', function () {
      var button = this;
      var sql = document.getElementById('sync-sql').textContent;
      var done = function () {
        button.textContent = 'Copied';
        setTimeout(function () { button.textContent = 'Copy'; }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sql).then(done, selectSql);
      } else {
        selectSql();
      }
    });

    document.getElementById('sync-signin').addEventListener('click', function () {
      authenticate(this, Sync.signIn, syncEls.emailInput.value.trim(), syncEls.password.value);
    });
    document.getElementById('sync-signup').addEventListener('click', function () {
      authenticate(this, Sync.signUp, syncEls.emailInput.value.trim(), syncEls.password.value);
    });
    document.getElementById('sync-change-server').addEventListener('click', function () {
      Sync.forget();
      openSync();
      showProjectFields = true;
      renderSync();
    });

    syncEls.revert.addEventListener('click', function () {
      Sync.useBuiltIn();
      showProjectFields = false;
      syncError('');
      renderSync();
      syncEls.emailInput.focus();
    });
    document.getElementById('sync-now').addEventListener('click', function () {
      Sync.syncNow().then(renderSync);
    });
    document.getElementById('sync-disconnect').addEventListener('click', function () {
      if (!window.confirm('Stop syncing on this device? Your events and notes stay here.')) return;
      Sync.signOut();
      renderSync();
      toast('Sync turned off on this device.');
    });

    Array.prototype.forEach.call(syncEls.modal.querySelectorAll('[data-sync-close]'), function (button) {
      button.addEventListener('click', function () { syncEls.modal.hidden = true; });
    });
    syncEls.modal.addEventListener('mousedown', function (clickEvent) {
      if (clickEvent.target === syncEls.modal) syncEls.modal.hidden = true;
    });

    Sync.subscribe(renderSync);
    Sync.init();
    renderSync();
  }

  /* ------------------------------------------------------------ reminders -- */

  var remEls = {};

  function reminderStateText() {
    var settings = Store.getSettings();
    if (!Reminders.supported()) return 'This browser cannot show notifications.';
    if (!Sync.getStatus().signedIn) return 'Turn on sync first — reminders use the same project.';
    if (!Reminders.vapidKey()) return 'Paste your project’s public reminder key below.';
    if (Reminders.permission() === 'denied') {
      return 'Notifications are blocked for this site. Allow them in your browser settings.';
    }
    return settings.remindersOn
      ? 'On for this device.'
      : 'Ready — turn them on for this device.';
  }

  function renderReminders() {
    var settings = Store.getSettings();
    var on = settings.remindersOn && Reminders.permission() === 'granted';

    remEls.chip.textContent = on ? 'On' : 'Off';
    remEls.chip.dataset.state = on ? 'ok' : '';
    remEls.state.textContent = reminderStateText();
    remEls.digestTime.value = settings.digestTime;
    remEls.digestOn.checked = !!settings.digestOn;
    remEls.defaultRemind.value = String(settings.defaultRemind);
    remEls.key.value = settings.vapidPublicKey || '';
    // The key ships with the app, so the field is only for a different project.
    remEls.setup.hidden = !!(window.APP_CONFIG || {}).vapidPublicKey && !settings.vapidPublicKey;
    remEls.enable.hidden = on;
    remEls.disable.hidden = !on;
    remEls.test.hidden = !on;
  }

  function reminderError(message) {
    remEls.error.textContent = message || '';
    remEls.error.hidden = !message;
  }

  function openReminders() {
    reminderError('');
    renderReminders();
    remEls.modal.hidden = false;
  }

  function setupReminders() {
    remEls = {
      modal: document.getElementById('reminders-modal'),
      chip: document.getElementById('reminders-chip'),
      state: document.getElementById('reminders-state'),
      error: document.getElementById('reminders-error'),
      key: document.getElementById('reminders-key'),
      setup: document.getElementById('reminders-setup'),
      digestTime: document.getElementById('reminders-digest-time'),
      digestOn: document.getElementById('reminders-digest-on'),
      defaultRemind: document.getElementById('reminders-default'),
      enable: document.getElementById('reminders-enable'),
      disable: document.getElementById('reminders-disable'),
      test: document.getElementById('reminders-test')
    };

    remEls.key.addEventListener('change', function () {
      Store.saveSettings({ vapidPublicKey: this.value.trim() });
      renderReminders();
    });
    remEls.digestTime.addEventListener('change', function () {
      Store.saveSettings({ digestTime: this.value || '08:00' });
    });
    remEls.digestOn.addEventListener('change', function () {
      Store.saveSettings({ digestOn: this.checked });
    });
    remEls.defaultRemind.addEventListener('change', function () {
      Store.saveSettings({ defaultRemind: Number(this.value) });
    });

    remEls.enable.addEventListener('click', function () {
      var button = this;
      reminderError('');
      busy(button, true, 'Asking…');
      Reminders.enable().then(function () {
        toast('Reminders are on for this device.');
      }).catch(function (err) {
        reminderError(err.message);
      }).then(function () {
        busy(button, false);
        renderReminders();
      });
    });

    remEls.disable.addEventListener('click', function () {
      Reminders.disable().then(function () {
        toast('Reminders are off for this device.');
        renderReminders();
      });
    });

    remEls.test.addEventListener('click', function () {
      var button = this;
      reminderError('');
      busy(button, true, 'Sending…');
      Reminders.sendTest().then(function () {
        toast('Test queued — it should arrive within a minute.');
      }).catch(function (err) {
        reminderError(err.message);
      }).then(function () {
        busy(button, false);
      });
    });

    Array.prototype.forEach.call(remEls.modal.querySelectorAll('[data-reminders-close]'), function (button) {
      button.addEventListener('click', function () { remEls.modal.hidden = true; });
    });
    remEls.modal.addEventListener('mousedown', function (clickEvent) {
      if (clickEvent.target === remEls.modal) remEls.modal.hidden = true;
    });

    Store.subscribe(renderReminders);
    Sync.subscribe(renderReminders);
    Reminders.init();
    renderReminders();
  }

  /* --------------------------------------------------------------- counts -- */

  // Outstanding work shows up in two places: next to Today and Tasks in the
  // menu, and on the app icon itself where the platform allows it.
  function renderCounts() {
    var due = Store.tasksDue(Store.todayKey()).length;

    [document.getElementById('today-chip'), document.getElementById('tasks-chip')]
      .forEach(function (chip) {
        chip.textContent = due;
        chip.hidden = due === 0;
        chip.dataset.state = due ? 'due' : '';
      });

    // Supported by installed PWAs on Windows and iOS; simply absent elsewhere.
    if (!navigator.setAppBadge) return;
    try {
      if (due) navigator.setAppBadge(due);
      else if (navigator.clearAppBadge) navigator.clearAppBadge();
    } catch (err) {
      // A badge is a nicety; never let it break a render.
    }
  }

  /* ----------------------------------------------------------- appearance -- */

  // Appearance is a synced setting, so it can change without anyone touching
  // this device — a pull from another one, or an imported backup. Re-apply only
  // on a real change; this runs on every commit.
  function applyAppearance() {
    var wanted = Store.getSettings();
    var live = Theme.current();
    if (Theme.normalise(wanted.themeBg) === live.bg &&
        Theme.normalise(wanted.themeBar) === live.bar &&
        Theme.normalise(wanted.themeAccent) === live.accent &&
        (wanted.textSize || Theme.DEFAULT_TEXT_SIZE) === live.textSize) {
      return;
    }
    Theme.apply({
      bg: wanted.themeBg,
      bar: wanted.themeBar,
      accent: wanted.themeAccent,
      textSize: wanted.textSize
    });
  }

  /* ---------------------------------------------------------------- toast -- */

  function toast(message) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }

  /* ----------------------------------------------------------------- init -- */

  function handleMenuClick(clickEvent) {
    var item = clickEvent.target.closest('.menu-item');
    if (!item) return;
    closeMenu(false);

    if (item.dataset.view) {
      navigate(item.dataset.view);
      return;
    }

    switch (item.dataset.action) {
      case 'reminders':
        openReminders();
        break;
      case 'sync':
        openSync();
        break;
      case 'export':
        exportBackup();
        break;
      case 'import':
        document.getElementById('import-file').click();
        break;
      case 'install':
        if (!installPrompt) return;
        installPrompt.prompt();
        installPrompt.userChoice.then(function () {
          installPrompt = null;
          menu.querySelector('[data-action="install"]').hidden = true;
        });
        break;
      case 'how-to-install':
        document.getElementById('help-modal').hidden = false;
        document.getElementById('help-close').focus();
        break;
    }
  }

  function init() {
    menuButton = document.getElementById('menu-button');
    menu = document.getElementById('menu');
    scrim = document.getElementById('menu-scrim');
    viewTitle = document.getElementById('view-title');
    actionButton = document.getElementById('appbar-action');
    toastEl = document.getElementById('toast');

    TasksView.init();
    CalendarView.init();
    NotesView.init();
    TodayView.init();
    ClocksView.init();
    TransfersView.init();
    SettingsView.init();
    setupSync();
    setupReminders();

    menuButton.addEventListener('click', function () {
      if (menuIsOpen()) closeMenu(true);
      else openMenu();
    });
    menu.addEventListener('click', handleMenuClick);
    document.getElementById('transfer-setup').addEventListener('click', function (clickEvent) {
      if (clickEvent.target.closest('[data-action="sync"]')) openSync();
    });
    scrim.addEventListener('click', function () { closeMenu(false); });

    actionButton.addEventListener('click', function () {
      if (currentView === 'calendar') CalendarView.goToday();
      else if (currentView === 'tasks') TasksView.newTask();
      else if (currentView === 'notes') NotesView.newNote();
    });

    document.getElementById('help-close').addEventListener('click', function () {
      document.getElementById('help-modal').hidden = true;
    });
    document.getElementById('help-modal').addEventListener('mousedown', function (clickEvent) {
      if (clickEvent.target.id === 'help-modal') clickEvent.currentTarget.hidden = true;
    });

    document.getElementById('import-file').addEventListener('change', function () {
      if (this.files && this.files[0]) importBackup(this.files[0]);
      this.value = '';
    });

    // Escape unwinds whatever is on top.
    document.addEventListener('keydown', function (keyEvent) {
      if (keyEvent.key !== 'Escape') return;
      var help = document.getElementById('help-modal');
      if (menuIsOpen()) closeMenu(true);
      else if (!help.hidden) help.hidden = true;
      else if (!syncEls.modal.hidden) syncEls.modal.hidden = true;
      else if (!remEls.modal.hidden) remEls.modal.hidden = true;
      else if (CalendarView.isModalOpen()) CalendarView.closeModal();
      else if (TasksView.isModalOpen()) TasksView.closeModal();
      else if (NotesView.isEditorOpen()) NotesView.closeEditor();
    });

    window.addEventListener('hashchange', routeFromHash);
    routeFromHash();

    Store.subscribe(function () {
      applyAppearance();
      RENDER[currentView]();
      renderCounts();
    });
    renderCounts();

    if (!Store.isPersistent()) {
      toast('Storage is blocked, so changes will not be kept.');
    }

    // Windows/Android: Chrome and Edge offer a real install prompt.
    window.addEventListener('beforeinstallprompt', function (installEvent) {
      installEvent.preventDefault();
      installPrompt = installEvent;
      menu.querySelector('[data-action="install"]').hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      installPrompt = null;
      menu.querySelector('[data-action="install"]').hidden = true;
      toast('Installed — look for it in your Start menu.');
    });

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (err) {
          console.warn('Offline support unavailable:', err);
        });
      });
    }
  }

  // The task list uses this to confirm a repeating task moved on.
  window.App = { toast: function (message) { toast(message); } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
