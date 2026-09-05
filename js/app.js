/* App shell: the hamburger menu, switching between the two views, backups and
   the service worker. */
(function () {
  'use strict';

  var VIEWS = {
    calendar: { title: 'Calendar', action: 'Today' },
    notes: { title: 'Notes', action: 'New note' }
  };

  var menuButton, menu, scrim, viewTitle, actionButton, toastEl;
  var currentView = 'calendar';
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

  function showView(name) {
    if (!VIEWS[name]) name = 'calendar';
    currentView = name;

    document.getElementById('view-calendar').hidden = name !== 'calendar';
    document.getElementById('view-notes').hidden = name !== 'notes';
    viewTitle.textContent = VIEWS[name].title;
    actionButton.textContent = VIEWS[name].action;

    Array.prototype.forEach.call(menu.querySelectorAll('[data-view]'), function (item) {
      var isCurrent = item.dataset.view === name;
      item.classList.toggle('is-current', isCurrent);
      item.setAttribute('aria-current', isCurrent ? 'page' : 'false');
    });

    if (name === 'calendar') CalendarView.render();
    else NotesView.render();

    window.scrollTo(0, 0);
  }

  function routeFromHash() {
    var name = (location.hash || '').replace('#', '');
    showView(VIEWS[name] ? name : 'calendar');
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

    CalendarView.init();
    NotesView.init();

    menuButton.addEventListener('click', function () {
      if (menuIsOpen()) closeMenu(true);
      else openMenu();
    });
    menu.addEventListener('click', handleMenuClick);
    scrim.addEventListener('click', function () { closeMenu(false); });

    actionButton.addEventListener('click', function () {
      if (currentView === 'calendar') CalendarView.goToday();
      else NotesView.newNote();
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
      else if (CalendarView.isModalOpen()) CalendarView.closeModal();
      else if (NotesView.isEditorOpen()) NotesView.closeEditor();
    });

    window.addEventListener('hashchange', routeFromHash);
    routeFromHash();

    Store.subscribe(function () {
      if (currentView === 'calendar') CalendarView.render();
      else NotesView.render();
    });

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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
