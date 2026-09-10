/* Appearance: the two colours picked in App settings, and which app icon is in
   use.

   This runs from <head>, before the body paints, so a customised app never
   flashes the default colours on the way in. That is also why it reads
   localStorage directly instead of going through Store — Store has not loaded
   yet at that point. Once the app is up, SettingsView drives it through
   apply().

   Only two colours are stored. Everything else — text, surfaces, borders, the
   hover states — is derived from them, and derived by contrast rather than by
   taste, so no pair of choices can produce text you cannot read.
*/
window.Theme = (function () {
  'use strict';

  var STORE_KEY = 'calendar-notes.v1';
  var DEFAULT_ICON = 'classic';

  var ICONS = [
    { id: 'classic', label: 'Classic' },
    { id: 'midnight', label: 'Midnight' },
    { id: 'sunrise', label: 'Sunrise' },
    { id: 'forest', label: 'Forest' },
    { id: 'mono', label: 'Mono' }
  ];

  // Starting points, not limits: both colours stay editable afterwards.
  var PRESETS = [
    { id: 'system', label: 'System', bg: '', bar: '' },
    { id: 'ink', label: 'Ink', bg: '#12141f', bar: '#1c2338' },
    { id: 'paper', label: 'Paper', bg: '#f7f4ed', bar: '#ffffff' },
    { id: 'ocean', label: 'Ocean', bg: '#eef4fb', bar: '#1d4e79' },
    { id: 'forest', label: 'Forest', bg: '#f1f6f0', bar: '#244d33' },
    { id: 'plum', label: 'Plum', bg: '#f8f1f8', bar: '#4a2350' },
    { id: 'slate', label: 'Slate', bg: '#eef1f6', bar: '#333f4f' }
  ];

  /* --------------------------------------------------------------- colour -- */

  function normalise(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (text.charAt(0) !== '#') text = '#' + text;
    if (/^#[0-9a-f]{3}$/i.test(text)) {
      text = '#' + text.charAt(1) + text.charAt(1) +
                   text.charAt(2) + text.charAt(2) +
                   text.charAt(3) + text.charAt(3);
    }
    return /^#[0-9a-f]{6}$/i.test(text) ? text.toLowerCase() : '';
  }

  function channels(hex) {
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16)
    ];
  }

  function toHex(parts) {
    return '#' + parts.map(function (value) {
      var byte = Math.max(0, Math.min(255, Math.round(value)));
      return (byte < 16 ? '0' : '') + byte.toString(16);
    }).join('');
  }

  function mix(from, to, amount) {
    var a = channels(from);
    var b = channels(to);
    return toHex([0, 1, 2].map(function (i) {
      return a[i] + (b[i] - a[i]) * amount;
    }));
  }

  // WCAG relative luminance, which is what makes the contrast maths below
  // agree with what an eye actually sees — a plain average does not.
  function luminance(hex) {
    var parts = channels(hex).map(function (value) {
      var channel = value / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  }

  function contrast(a, b) {
    var one = luminance(a);
    var two = luminance(b);
    return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
  }

  var WHITE = '#ffffff';
  var BLACK = '#000000';
  var INK = '#14172a';

  // Which of the two poles the colour has room for. A near-black page takes
  // white writing, a pale one takes dark writing, and a colour in the middle
  // gets whichever of the two it is further from.
  function poleFor(hex) {
    return contrast(WHITE, hex) >= contrast(INK, hex) ? WHITE : INK;
  }

  // Nudge a colour away from the writing that will sit on it, until that
  // writing is legible. Colours near the middle of the range cannot carry text
  // either way, so the app moves them out of the middle rather than handing
  // back something nobody can read; a colour with room to spare is untouched.
  function deepen(base, ink, target) {
    if (contrast(ink, base) >= target) return base;
    var towards = luminance(ink) > 0.5 ? BLACK : WHITE;
    for (var step = 1; step <= 24; step++) {
      var candidate = mix(base, towards, step / 24);
      if (contrast(ink, candidate) >= target) return candidate;
    }
    return towards;
  }

  // Nudge `wanted` towards white or black — whichever the background is
  // further from — until it is legible on it. The hue survives as far as it
  // can, which is why a custom bar keeps a tint of the app's blue.
  function readable(on, wanted, target) {
    if (contrast(wanted, on) >= target) return wanted;
    var towards = poleFor(on) === WHITE ? WHITE : BLACK;
    for (var step = 1; step <= 24; step++) {
      var candidate = mix(wanted, towards, step / 24);
      if (contrast(candidate, on) >= target) return candidate;
    }
    return towards;
  }

  // Muted text: as faded as it can be while still clearing AA.
  function soften(text, on, target) {
    for (var step = 10; step >= 1; step--) {
      var candidate = mix(text, on, step / 20);
      if (contrast(candidate, on) >= target) return candidate;
    }
    return text;
  }

  /* --------------------------------------------------------------- tokens -- */

  // Background colour -> the page, the cards and everything written on them.
  function pageTokens(chosen) {
    var pole = poleFor(chosen);
    var dark = pole === WHITE;

    // Cards carry most of the reading, so they are held to AAA. That is also
    // what lifts a mid-tone choice into a usable range.
    var surface = deepen(
      dark ? mix(chosen, WHITE, 0.07) : mix(chosen, WHITE, 0.72), pole, 8.5);
    var text = readable(surface, mix(pole, chosen, 0.1), 7.5);
    var bg = deepen(chosen, text, 4.6);
    var brand = readable(surface, dark ? '#7b90ff' : '#4f6bf6', 3.2);

    return {
      '--bg': bg,
      '--surface': surface,
      '--surface-2': dark ? mix(surface, WHITE, 0.06) : mix(surface, BLACK, 0.05),
      '--text': text,
      '--text-soft': soften(text, surface, 4.6),
      '--line': dark ? mix(surface, WHITE, 0.14) : mix(surface, BLACK, 0.12),
      '--brand': brand,
      '--brand-soft': mix(brand, surface, dark ? 0.8 : 0.86),
      '--accent': readable(surface, dark ? '#ff9d5c' : '#ff8a3d', 3.2),
      '--danger': readable(surface, dark ? '#ff6b6b' : '#d93a3a', 4.6),
      '--shadow': dark
        ? '0 6px 24px rgba(0, 0, 0, .45)'
        : '0 6px 24px rgba(24, 30, 60, .10)'
    };
  }

  // Bar colour -> the appbar and the dropdown menu, which are the same strip
  // as far as the eye is concerned.
  function barTokens(chosen) {
    var pole = poleFor(chosen);
    var dark = pole === WHITE;
    var bar = deepen(chosen, pole, 5.6);
    var text = readable(bar, pole, 5.2);

    return {
      '--bar': bar,
      '--bar-text': text,
      '--bar-soft': dark ? mix(bar, WHITE, 0.12) : mix(bar, BLACK, 0.06),
      '--bar-line': dark ? mix(bar, WHITE, 0.18) : mix(bar, BLACK, 0.12),
      '--bar-accent': readable(bar, dark ? '#7b90ff' : '#4f6bf6', 3.5),
      '--bar-danger': readable(bar, dark ? '#ff6b6b' : '#d93a3a', 3.5)
    };
  }

  var PAGE_KEYS = Object.keys(pageTokens('#ffffff'));
  var BAR_KEYS = Object.keys(barTokens('#ffffff'));

  /* ---------------------------------------------------------------- apply -- */

  var current = { bg: '', bar: '', icon: DEFAULT_ICON };

  function write(root, tokens, keys) {
    keys.forEach(function (key) {
      if (tokens && tokens[key]) root.style.setProperty(key, tokens[key]);
      else root.style.removeProperty(key);
    });
  }

  // A media-less theme-color wins over the two media-scoped ones in the HTML,
  // as long as it comes first. Those stay put for the very first paint and for
  // anyone who has not customised anything.
  function themeColor(colour) {
    var meta = document.querySelector('meta[data-dynamic-theme-color]');
    if (!colour) {
      if (meta) meta.parentNode.removeChild(meta);
      return;
    }
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('data-dynamic-theme-color', '');
      document.head.insertBefore(meta, document.head.firstChild);
    }
    meta.setAttribute('content', colour);
  }

  function apply(bg, bar) {
    var root = document.documentElement;
    current.bg = normalise(bg);
    current.bar = normalise(bar);

    // Nothing chosen: drop every override so the stylesheet's own light and
    // dark schemes take back over, live.
    write(root, current.bg ? pageTokens(current.bg) : null, PAGE_KEYS);
    write(root, current.bar ? barTokens(current.bar) : null, BAR_KEYS);

    if (current.bg) {
      root.style.setProperty('color-scheme', poleFor(current.bg) === WHITE ? 'dark' : 'light');
    } else {
      root.style.removeProperty('color-scheme');
    }

    themeColor(current.bar || current.bg || '');
    return current;
  }

  /* ----------------------------------------------------------------- icon -- */

  function iconExists(id) {
    return ICONS.some(function (entry) { return entry.id === id; });
  }

  function link(selector, href) {
    var node = document.querySelector(selector);
    if (node) node.setAttribute('href', href);
  }

  // iOS reads apple-touch-icon when the app is added to the Home Screen, and
  // Chrome reads the manifest when it installs, so swapping these only decides
  // what the *next* install picks up. The settings screen says so.
  function applyIcon(id) {
    current.icon = iconExists(id) ? id : DEFAULT_ICON;
    var folder = 'icons/' + current.icon + '/';

    link('link[rel="apple-touch-icon"]', folder + 'apple-touch-icon.png');
    link('link[rel="icon"][sizes="32x32"]', folder + 'favicon-32.png');
    link('link[rel="icon"][sizes="192x192"]', folder + 'icon-192.png');
    link('link[rel="manifest"]', 'manifest-' + current.icon + '.webmanifest');
    return current.icon;
  }

  /* ----------------------------------------------------------------- boot -- */

  // Read straight from storage: this runs before Store exists.
  function saved() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var values = raw && (JSON.parse(raw).settings || {}).values;
      return values || {};
    } catch (err) {
      return {};
    }
  }

  var start = saved();
  apply(start.themeBg, start.themeBar);
  applyIcon(start.appIcon);

  // A derived palette is a snapshot of the system scheme, so re-derive it when
  // that flips. With nothing customised there is nothing to redo — CSS has it.
  if (window.matchMedia) {
    var query = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { apply(current.bg, current.bar); };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
  }

  return {
    ICONS: ICONS,
    PRESETS: PRESETS,
    DEFAULT_ICON: DEFAULT_ICON,
    apply: apply,
    applyIcon: applyIcon,
    normalise: normalise,
    contrast: contrast,
    // What the wheels should show for a colour nobody has chosen: whatever the
    // app is using anyway. Reading it back from the document covers both the
    // stylesheet's light and dark schemes and a bar that is following a page
    // colour that *has* been chosen.
    fallback: function () {
      var style = getComputedStyle(document.documentElement);
      return {
        bg: normalise(style.getPropertyValue('--bg')) || '#f4f5fb',
        bar: normalise(style.getPropertyValue('--bar')) || '#ffffff'
      };
    },
    tokens: function (bg, bar) {
      return {
        page: normalise(bg) ? pageTokens(normalise(bg)) : null,
        bar: normalise(bar) ? barTokens(normalise(bar)) : null
      };
    },
    current: function () { return { bg: current.bg, bar: current.bar, icon: current.icon }; }
  };
})();
