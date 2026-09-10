/* App settings: how the app looks.

   Both choices live in the synced settings record, so picking a colour on the
   Windows PC reaches the iPad too. The colour work itself is all in js/theme.js
   — this screen only collects the two values and hands them over.
*/
window.SettingsView = (function () {
  'use strict';

  var els = {};
  // Colour inputs fire `input` continuously while a wheel is being dragged.
  // The screen follows every one of those; only the write to storage waits, so
  // a slow drag does not turn into hundreds of synced revisions.
  var saveTimer = null;
  var pending = null;
  var SAVE_DELAY = 400;

  // What the screen should be showing. While a write is still queued that is
  // the colour in hand, not the one in storage — reading storage mid-drag would
  // snap the wheel back to where it started.
  function settings() {
    var stored = Store.getSettings();
    return pending ? Object.assign({}, stored, pending) : stored;
  }

  function save(patch) {
    pending = patch;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      pending = null;
      Store.saveSettings(patch);
    }, SAVE_DELAY);
  }

  // Anything that is not a drag lands straight away, carrying whatever colour
  // was still in flight with it.
  function saveNow(patch) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    var merged = pending ? Object.assign({}, pending, patch) : patch;
    pending = null;
    Store.saveSettings(merged);
  }

  /* -------------------------------------------------------------- colours -- */

  // What the two wheels should be showing: the chosen colour, or the colour
  // the app is using anyway when nothing has been chosen.
  function shown(values) {
    var fallback = Theme.fallback();
    return {
      bg: Theme.normalise(values.themeBg) || fallback.bg,
      bar: Theme.normalise(values.themeBar) || fallback.bar
    };
  }

  function renderColours() {
    var values = settings();
    var visible = shown(values);

    els.bg.value = visible.bg;
    els.bar.value = visible.bar;
    els.bgValue.textContent = visible.bg.toUpperCase();
    els.barValue.textContent = visible.bar.toUpperCase();

    var custom = !!(Theme.normalise(values.themeBg) || Theme.normalise(values.themeBar));
    els.reset.hidden = !custom;
    els.followNote.hidden = custom;

    Array.prototype.forEach.call(els.presets.children, function (button) {
      var on = button.dataset.bg === (Theme.normalise(values.themeBg) || '') &&
               button.dataset.bar === (Theme.normalise(values.themeBar) || '');
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      // The System swatch shows whatever the device is giving us right now.
      button.style.setProperty('--dot-bg', button.dataset.bg || visible.bg);
      button.style.setProperty('--dot-bar', button.dataset.bar || visible.bar);
    });
  }

  // Each wheel owns one colour. Touching the background must not quietly
  // commit whatever the bar wheel happened to be displaying — left alone, the
  // bar keeps following the page.
  function setColours(patch, immediate) {
    var merged = Object.assign({}, settings(), patch);
    var write = {
      themeBg: Theme.normalise(merged.themeBg),
      themeBar: Theme.normalise(merged.themeBar)
    };
    // Repaint from the values in hand rather than waiting for the debounce,
    // so dragging the wheel recolours the app as it moves.
    Theme.apply(write.themeBg, write.themeBar);
    if (immediate) saveNow(write);
    else save(write);
    renderColours();
  }

  function buildPresets() {
    els.presets.innerHTML = '';
    Theme.PRESETS.forEach(function (preset) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.bg = preset.bg;
      button.dataset.bar = preset.bar;
      button.innerHTML = '<span class="preset-dot" aria-hidden="true"></span>' +
        '<span></span>';
      button.lastChild.textContent = preset.label;
      els.presets.appendChild(button);
    });
  }

  /* ----------------------------------------------------------------- icon -- */

  function buildIcons() {
    els.icons.innerHTML = '';
    Theme.ICONS.forEach(function (icon) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'icon-choice';
      button.dataset.icon = icon.id;
      button.setAttribute('role', 'radio');
      button.innerHTML =
        '<img alt="" width="68" height="68" loading="lazy">' +
        '<span class="icon-label"></span>' +
        '<span class="icon-tick">In use</span>';
      button.querySelector('img').src = 'icons/' + icon.id + '/icon-192.png';
      button.querySelector('.icon-label').textContent = icon.label;
      button.setAttribute('aria-label', icon.label + ' app icon');
      els.icons.appendChild(button);
    });
  }

  function renderIcon() {
    var chosen = settings().appIcon || Theme.DEFAULT_ICON;
    Array.prototype.forEach.call(els.icons.children, function (button) {
      var on = button.dataset.icon === chosen;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  /* ----------------------------------------------------------------- wire -- */

  function init() {
    els.bg = document.getElementById('theme-bg');
    els.bar = document.getElementById('theme-bar');
    els.bgValue = document.getElementById('theme-bg-value');
    els.barValue = document.getElementById('theme-bar-value');
    els.reset = document.getElementById('theme-reset');
    els.followNote = document.getElementById('theme-follow-note');
    els.presets = document.getElementById('theme-presets');
    els.icons = document.getElementById('icon-choices');

    buildPresets();
    buildIcons();

    ['input', 'change'].forEach(function (type) {
      els.bg.addEventListener(type, function () {
        setColours({ themeBg: this.value }, type === 'change');
      });
      els.bar.addEventListener(type, function () {
        setColours({ themeBar: this.value }, type === 'change');
      });
    });

    els.reset.addEventListener('click', function () {
      setColours({ themeBg: '', themeBar: '' }, true);
      App.toast('Back to the system colours.');
    });

    els.presets.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('.preset');
      if (!button) return;
      setColours({ themeBg: button.dataset.bg, themeBar: button.dataset.bar }, true);
    });

    els.icons.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('.icon-choice');
      if (!button) return;
      saveNow({ appIcon: button.dataset.icon });
      Theme.applyIcon(button.dataset.icon);
      renderIcon();
      App.toast('Icon set — reinstall the app to see it on your Home Screen.');
    });
  }

  function render() {
    renderColours();
    renderIcon();
  }

  return { init: init, render: render };
})();
