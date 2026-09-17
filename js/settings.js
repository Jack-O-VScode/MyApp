/* App settings: how the app looks and reads.

   Every choice here lives in the synced settings record, so picking one on the
   Windows PC reaches the iPad too. The colour work itself is all in js/theme.js
   — this screen only collects the values and hands them over.
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

  var CLOCKS = [
    { id: '', label: 'Device' },
    { id: '12', label: '12-hour' },
    { id: '24', label: '24-hour' }
  ];

  var BG_MODES = [
    { id: 'solid', label: 'Solid' },
    { id: 'gradient', label: 'Gradient' }
  ];

  var BUTTON_STYLES = [
    { id: 'glass', label: 'Glass' },
    { id: 'solid', label: 'Solid' }
  ];

  // What the screen should be showing. While a write is still queued that is
  // the value in hand, not the one in storage — reading storage mid-drag would
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

  // The shape js/theme.js wants, from the shape the store keeps. The second
  // colour is remembered while Solid is selected, and simply not passed on.
  function appearance(values) {
    return {
      bg: values.themeBg,
      bg2: values.themeBgMode === 'gradient' ? values.themeBg2 : '',
      bar: values.themeBar,
      accent: values.themeAccent,
      textSize: values.textSize,
      font: values.font,
      glass: values.buttonStyle !== 'solid'
    };
  }

  /* -------------------------------------------------------------- colours -- */

  // What the wheels should show: the chosen colour, or the colour the app is
  // using anyway when nothing has been chosen.
  function shown(values) {
    var fallback = Theme.fallback();
    var bg = Theme.normalise(values.themeBg) || fallback.bg;
    return {
      bg: bg,
      // An unset second colour starts from the first, so opening the gradient
      // begins somewhere sensible rather than at black.
      bg2: Theme.normalise(values.themeBg2) || bg,
      bar: Theme.normalise(values.themeBar) || fallback.bar,
      accent: Theme.normalise(values.themeAccent) || fallback.accent
    };
  }

  function renderColours() {
    var values = settings();
    var visible = shown(values);

    [['bg', els.bg, els.bgValue], ['bg2', els.bg2, els.bg2Value],
     ['bar', els.bar, els.barValue],
     ['accent', els.accent, els.accentValue]].forEach(function (row) {
      row[1].value = visible[row[0]];
      row[2].textContent = visible[row[0]].toUpperCase();
    });

    var gradient = values.themeBgMode === 'gradient';
    markSegmented(els.bgMode, 'mode', gradient ? 'gradient' : 'solid');
    els.bg2Field.hidden = !gradient;
    els.bgLabel.textContent = gradient ? 'Top' : 'Colour';

    var custom = !!(Theme.normalise(values.themeBg) ||
                    Theme.normalise(values.themeBar) ||
                    Theme.normalise(values.themeAccent));
    els.reset.hidden = !custom;
    els.followNote.hidden = custom;

    Array.prototype.forEach.call(els.presets.children, function (button) {
      var presetBg2 = button.dataset.bg2;
      var on = button.dataset.bg === (Theme.normalise(values.themeBg) || '') &&
               button.dataset.bar === (Theme.normalise(values.themeBar) || '') &&
               presetBg2 === (gradient ? Theme.normalise(values.themeBg2) || '' : '');
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      // The System swatch shows whatever the device is giving us right now.
      button.style.setProperty('--dot-bg', button.dataset.bg2 || button.dataset.bg || visible.bg);
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
      themeBg2: Theme.normalise(merged.themeBg2),
      themeBgMode: merged.themeBgMode === 'gradient' ? 'gradient' : 'solid',
      themeBar: Theme.normalise(merged.themeBar),
      themeAccent: Theme.normalise(merged.themeAccent)
    };
    // Repaint from the values in hand rather than waiting for the debounce,
    // so dragging the wheel recolours the app as it moves.
    Theme.apply(appearance(Object.assign({}, merged, write)));
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
      button.dataset.bg2 = preset.bg2 || '';
      button.dataset.bar = preset.bar;
      button.innerHTML = '<span class="preset-dot" aria-hidden="true"></span><span></span>';
      button.lastChild.textContent = preset.label;
      els.presets.appendChild(button);
    });
  }

  /* ------------------------------------------------------ text and times -- */

  function buildSegmented(host, options, attribute) {
    host.innerHTML = '';
    options.forEach(function (option) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset[attribute] = option.id;
      button.textContent = option.label;
      host.appendChild(button);
    });
  }

  function markSegmented(host, attribute, chosen) {
    Array.prototype.forEach.call(host.children, function (button) {
      var on = button.dataset[attribute] === chosen;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------- font picker -- */
  // Too many faces for a row of buttons, so: a button that opens a panel with a
  // search box over a list. Only what the device can actually render is offered,
  // and every name is drawn in its own face.

  var fontCatalogue = null;
  var fontShown = [];                 // what the list is showing, in order
  var fontAt = -1;                    // which of those the keyboard is on

  function catalogue() {
    if (fontCatalogue) return fontCatalogue;
    var all = Theme.availableFonts(settings().font);
    fontCatalogue = [];
    // Group order comes from Theme; a family the user named themselves has a
    // group of its own and goes after the rest.
    Theme.FONT_GROUPS.forEach(function (group) {
      all.forEach(function (font) { if (font.group === group) fontCatalogue.push(font); });
    });
    all.forEach(function (font) {
      if (Theme.FONT_GROUPS.indexOf(font.group) === -1) fontCatalogue.push(font);
    });
    return fontCatalogue;
  }

  function fontMatches(query) {
    var text = query.trim().toLowerCase();
    var list = catalogue().filter(function (font) {
      return !text || font.label.toLowerCase().indexOf(text) !== -1;
    });
    // Not in the list, but the device has a family by that name: offer it, so
    // nobody is held to this catalogue for a font they installed themselves.
    var own = text ? Theme.customFont(query) : null;
    var already = own && list.some(function (font) {
      return font.label.toLowerCase() === own.label.toLowerCase();
    });
    if (own && !already && Theme.hasFamily(own.label)) list.unshift(own);
    return list;
  }

  function tick() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'combo-tick');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'm5 12 4.5 4.5L19 7');
    svg.appendChild(path);
    return svg;
  }

  function renderFontList() {
    var chosen = settings().font || Theme.DEFAULT_FONT;
    fontShown = fontMatches(els.fontSearch.value);

    els.fontList.innerHTML = '';
    var fragment = document.createDocumentFragment();
    var group = '';

    fontShown.forEach(function (font, index) {
      if (font.group !== group) {
        group = font.group;
        var heading = document.createElement('li');
        heading.className = 'combo-group';
        heading.setAttribute('role', 'presentation');
        heading.textContent = group;
        fragment.appendChild(heading);
      }

      var option = document.createElement('li');
      option.className = 'combo-option';
      option.id = 'font-option-' + index;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', font.id === chosen ? 'true' : 'false');
      option.dataset.font = font.id;
      option.style.fontFamily = font.stack;
      if (font.id === chosen) option.classList.add('is-on');

      var name = document.createElement('span');
      name.textContent = font.label;
      option.appendChild(tick());
      option.appendChild(name);
      fragment.appendChild(option);
    });
    els.fontList.appendChild(fragment);

    els.fontEmpty.hidden = fontShown.length > 0;
    els.fontEmpty.textContent = 'No font called that on this device.';
    setFontAt(fontShown.length ? 0 : -1, false);
  }

  function setFontAt(index, scroll) {
    fontAt = index;
    var options = els.fontList.querySelectorAll('.combo-option');
    Array.prototype.forEach.call(options, function (option, at) {
      option.classList.toggle('is-active', at === index);
    });
    var active = index < 0 ? null : options[index];
    if (!active) {
      els.fontSearch.removeAttribute('aria-activedescendant');
      return;
    }
    els.fontSearch.setAttribute('aria-activedescendant', active.id);
    if (scroll) active.scrollIntoView({ block: 'nearest' });
  }

  function openFonts() {
    // Built fresh each time: which fonts a device has is its own business, and
    // the one in use has to stay listed even if it came from another device.
    fontCatalogue = null;
    els.fontPanel.classList.remove('is-above');
    els.fontPanel.hidden = false;
    els.fontButton.setAttribute('aria-expanded', 'true');
    els.fontSearch.value = '';
    renderFontList();

    // Font is near the bottom of a long settings page, so on a short window the
    // panel would hang off the end of it. Given more room above than below, it
    // opens upward instead.
    var button = els.fontButton.getBoundingClientRect();
    var panel = els.fontPanel.getBoundingClientRect();
    var below = window.innerHeight - button.bottom;
    if (panel.height > below - 8 && button.top > below) {
      els.fontPanel.classList.add('is-above');
    }

    els.fontSearch.focus();
  }

  function closeFonts(back) {
    if (els.fontPanel.hidden) return;
    els.fontPanel.hidden = true;
    els.fontButton.setAttribute('aria-expanded', 'false');
    if (back) els.fontButton.focus();
  }

  function pickFont(id) {
    var values = Object.assign({}, settings(), { font: id });
    Theme.apply(appearance(values));
    saveNow({ font: id });
    renderTextAndTimes();
    closeFonts(true);
  }

  function renderFontButton(values) {
    var font = Theme.fontFor(values.font || Theme.DEFAULT_FONT);
    els.fontCurrent.textContent = font.label;
    els.fontCurrent.style.fontFamily = font.stack;
  }

  function renderTextAndTimes() {
    var values = settings();
    markSegmented(els.buttonStyle, 'style', values.buttonStyle === 'solid' ? 'solid' : 'glass');
    renderFontButton(values);
    markSegmented(els.textSize, 'size', values.textSize || Theme.DEFAULT_TEXT_SIZE);
    markSegmented(els.clock, 'clock', values.clock || '');
  }

  /* ----------------------------------------------------------------- wire -- */

  function init() {
    els.bg = document.getElementById('theme-bg');
    els.bg2 = document.getElementById('theme-bg2');
    els.bg2Field = document.getElementById('theme-bg2-field');
    els.bgLabel = document.getElementById('theme-bg-label');
    els.bgMode = document.getElementById('bg-mode');
    els.bar = document.getElementById('theme-bar');
    els.accent = document.getElementById('theme-accent');
    els.bgValue = document.getElementById('theme-bg-value');
    els.bg2Value = document.getElementById('theme-bg2-value');
    els.barValue = document.getElementById('theme-bar-value');
    els.accentValue = document.getElementById('theme-accent-value');
    els.reset = document.getElementById('theme-reset');
    els.followNote = document.getElementById('theme-follow-note');
    els.presets = document.getElementById('theme-presets');
    els.buttonStyle = document.getElementById('button-style');
    els.fontCombo = document.getElementById('font-combo');
    els.fontButton = document.getElementById('font-button');
    els.fontCurrent = document.getElementById('font-current');
    els.fontPanel = document.getElementById('font-panel');
    els.fontSearch = document.getElementById('font-search');
    els.fontList = document.getElementById('font-list');
    els.fontEmpty = document.getElementById('font-empty');
    els.textSize = document.getElementById('text-size');
    els.clock = document.getElementById('clock-format');

    buildPresets();
    buildSegmented(els.bgMode, BG_MODES, 'mode');
    buildSegmented(els.buttonStyle, BUTTON_STYLES, 'style');
    buildSegmented(els.textSize, Theme.TEXT_SIZES, 'size');
    buildSegmented(els.clock, CLOCKS, 'clock');

    ['input', 'change'].forEach(function (type) {
      els.bg.addEventListener(type, function () {
        setColours({ themeBg: this.value }, type === 'change');
      });
      els.bg2.addEventListener(type, function () {
        setColours({ themeBg2: this.value }, type === 'change');
      });
      els.bar.addEventListener(type, function () {
        setColours({ themeBar: this.value }, type === 'change');
      });
      els.accent.addEventListener(type, function () {
        setColours({ themeAccent: this.value }, type === 'change');
      });
    });

    els.reset.addEventListener('click', function () {
      setColours({
        themeBg: '', themeBg2: '', themeBgMode: 'solid',
        themeBar: '', themeAccent: ''
      }, true);
      App.toast('Back to the system colours.');
    });

    els.bgMode.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('button');
      if (!button) return;
      var patch = { themeBgMode: button.dataset.mode };
      // Turning the gradient on with no second colour yet starts it from the
      // one already showing, so the page does not jump.
      if (button.dataset.mode === 'gradient' && !Theme.normalise(settings().themeBg2)) {
        patch.themeBg2 = shown(settings()).bg2;
      }
      setColours(patch, true);
    });

    els.presets.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('.preset');
      if (!button) return;
      setColours({
        themeBg: button.dataset.bg,
        themeBg2: button.dataset.bg2,
        themeBgMode: button.dataset.bg2 ? 'gradient' : 'solid',
        themeBar: button.dataset.bar
      }, true);
    });

    els.buttonStyle.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('button');
      if (!button) return;
      var values = Object.assign({}, settings(), { buttonStyle: button.dataset.style });
      Theme.apply(appearance(values));
      saveNow({ buttonStyle: button.dataset.style });
      renderTextAndTimes();
    });

    els.fontButton.addEventListener('click', function () {
      if (els.fontPanel.hidden) openFonts();
      else closeFonts(true);
    });

    els.fontSearch.addEventListener('input', renderFontList);

    els.fontSearch.addEventListener('keydown', function (keyEvent) {
      var key = keyEvent.key;
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        keyEvent.preventDefault();
        if (!fontShown.length) return;
        var next = fontAt + (key === 'ArrowDown' ? 1 : -1);
        if (next < 0) next = fontShown.length - 1;
        if (next >= fontShown.length) next = 0;
        setFontAt(next, true);
      } else if (key === 'Enter') {
        keyEvent.preventDefault();
        if (fontShown[fontAt]) pickFont(fontShown[fontAt].id);
      } else if (key === 'Escape') {
        keyEvent.preventDefault();
        closeFonts(true);
      } else if (key === 'Tab') {
        closeFonts(false);
      }
    });

    els.fontList.addEventListener('click', function (clickEvent) {
      var option = clickEvent.target.closest('.combo-option');
      if (option) pickFont(option.dataset.font);
    });

    // Anywhere else puts it away. This runs after the list's own click, so
    // picking a font is never cut short by the panel closing first.
    document.addEventListener('click', function (clickEvent) {
      if (!els.fontPanel.hidden && !els.fontCombo.contains(clickEvent.target)) closeFonts(false);
    });

    els.textSize.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('button');
      if (!button) return;
      var values = Object.assign({}, settings(), { textSize: button.dataset.size });
      Theme.apply(appearance(values));
      saveNow({ textSize: button.dataset.size });
      renderTextAndTimes();
    });

    els.clock.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('button');
      if (!button) return;
      saveNow({ clock: button.dataset.clock });
      renderTextAndTimes();
    });
  }

  function render() {
    renderColours();
    renderTextAndTimes();
  }

  return { init: init, render: render };
})();
