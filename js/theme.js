/* Appearance: the colours and text size picked in App settings.

   This runs from <head>, before the body paints, so a customised app never
   flashes the default colours on the way in. That is also why it reads
   localStorage directly instead of going through Store — Store has not loaded
   yet at that point. Once the app is up, SettingsView drives it through
   apply().

   Only the chosen colours are stored. Everything else — text, surfaces,
   borders, the hover states, what is legible on a coloured button — is derived
   from them, and derived by contrast rather than by taste, so no combination of
   choices can produce text you cannot read.
*/
window.Theme = (function () {
  'use strict';

  var STORE_KEY = 'calendar-notes.v1';

  // Scales the root font size; everything is sized in rem from there.
  var TEXT_SIZES = [
    { id: 'small', label: 'Small', scale: 0.9 },
    { id: 'normal', label: 'Normal', scale: 1 },
    { id: 'large', label: 'Large', scale: 1.15 }
  ];
  var DEFAULT_TEXT_SIZE = 'normal';

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

  // The app's own blue, unless an accent has been picked.
  function wantedAccent(accent, dark) {
    return normalise(accent) || (dark ? '#7b90ff' : '#4f6bf6');
  }

  // A fill has two jobs at once: stand out from the card it sits on, and carry
  // a label. No single rule satisfies both — a mid-blue accent on a mid-blue
  // card can do neither — so walk the colour towards black and towards white
  // and take the first point along either that manages both. Most colours
  // satisfy it where they already are and never move at all.
  function fill(surface, wanted) {
    var best = null;

    [BLACK, WHITE].forEach(function (towards) {
      for (var step = 0; step <= 24; step++) {
        var colour = mix(wanted, towards, step / 24);
        if (contrast(colour, surface) < 3.2) continue;
        var ink = contrast(WHITE, colour) >= contrast(INK, colour) ? WHITE : INK;
        if (contrast(ink, colour) < 4.6) continue;

        var moved = Math.abs(luminance(colour) - luminance(wanted));
        if (!best || moved < best.moved) best = { colour: colour, ink: ink, moved: moved };
        // The first hit along a direction is the least this way can move.
        return;
      }
    });

    // One end of one direction always qualifies — black carries white writing
    // and shows on a light card, white carries dark writing and shows on a dark
    // one — so this is belt and braces rather than a real case.
    return best || { colour: poleFor(surface) === WHITE ? WHITE : BLACK,
                     ink: poleFor(surface) === WHITE ? INK : WHITE };
  }

  // Background colour -> the page, the cards and everything written on them.
  function pageTokens(chosen, accent) {
    var pole = poleFor(chosen);
    var dark = pole === WHITE;

    // Cards carry most of the reading, so they are held to AAA. That is also
    // what lifts a mid-tone choice into a usable range.
    var surface = deepen(
      dark ? mix(chosen, WHITE, 0.07) : mix(chosen, WHITE, 0.72), pole, 8.5);
    var text = readable(surface, mix(pole, chosen, 0.1), 7.5);
    var bg = deepen(chosen, text, 4.6);
    var filled = fill(surface, wantedAccent(accent, dark));
    var brand = filled.colour;

    return {
      '--bg': bg,
      '--surface': surface,
      '--surface-2': dark ? mix(surface, WHITE, 0.06) : mix(surface, BLACK, 0.05),
      '--text': text,
      '--text-soft': soften(text, surface, 4.6),
      '--line': dark ? mix(surface, WHITE, 0.14) : mix(surface, BLACK, 0.12),
      '--brand': brand,
      '--brand-soft': mix(brand, surface, dark ? 0.8 : 0.86),
      // Buttons and the today circle are filled with the accent, so what is
      // written on them has to be chosen from the accent, not assumed white.
      '--on-brand': filled.ink,
      '--accent': readable(surface, dark ? '#ff9d5c' : '#ff8a3d', 3.2),
      '--danger': readable(surface, dark ? '#ff6b6b' : '#d93a3a', 4.6),
      '--shadow': dark
        ? '0 6px 24px rgba(0, 0, 0, .45)'
        : '0 6px 24px rgba(24, 30, 60, .10)'
    };
  }

  // Bar colour -> the appbar and the dropdown menu, which are the same strip
  // as far as the eye is concerned.
  function barTokens(chosen, accent) {
    var pole = poleFor(chosen);
    var dark = pole === WHITE;
    var bar = deepen(chosen, pole, 5.6);
    var text = readable(bar, pole, 5.2);

    return {
      '--bar': bar,
      '--bar-text': text,
      '--bar-soft': dark ? mix(bar, WHITE, 0.12) : mix(bar, BLACK, 0.06),
      '--bar-line': dark ? mix(bar, WHITE, 0.18) : mix(bar, BLACK, 0.12),
      '--bar-accent': readable(bar, wantedAccent(accent, dark), 3.5),
      '--bar-danger': readable(bar, dark ? '#ff6b6b' : '#d93a3a', 3.5)
    };
  }

  // An accent on its own still needs the page tokens rewritten, since --brand
  // and everything derived from it live there.
  function accentOnlyTokens(accent) {
    var dark = window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    var surface = dark ? '#1b1e2c' : '#ffffff';
    var filled = fill(surface, wantedAccent(accent, dark));
    return {
      '--brand': filled.colour,
      '--brand-soft': mix(filled.colour, surface, dark ? 0.8 : 0.86),
      '--on-brand': filled.ink
    };
  }

  var PAGE_KEYS = Object.keys(pageTokens('#ffffff'));
  var BAR_KEYS = Object.keys(barTokens('#ffffff'));

  /* ---------------------------------------------------------------- apply -- */

  var current = { bg: '', bar: '', accent: '', textSize: DEFAULT_TEXT_SIZE };

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

  function sizeFor(id) {
    var found = null;
    TEXT_SIZES.forEach(function (size) { if (size.id === id) found = size; });
    return found || { id: DEFAULT_TEXT_SIZE, scale: 1 };
  }

  function apply(values) {
    var wanted = values || {};
    var root = document.documentElement;
    current.bg = normalise(wanted.bg);
    current.bar = normalise(wanted.bar);
    current.accent = normalise(wanted.accent);
    var size = sizeFor(wanted.textSize);
    current.textSize = size.id;

    // Nothing chosen: drop every override so the stylesheet's own light and
    // dark schemes take back over, live.
    write(root, current.bg ? pageTokens(current.bg, current.accent) : null, PAGE_KEYS);
    write(root, current.bar ? barTokens(current.bar, current.accent) : null, BAR_KEYS);

    // An accent with no page colour still has to land somewhere.
    if (!current.bg && current.accent) {
      var extra = accentOnlyTokens(current.accent);
      Object.keys(extra).forEach(function (key) {
        root.style.setProperty(key, extra[key]);
      });
    }

    if (current.bg) {
      root.style.setProperty('color-scheme', poleFor(current.bg) === WHITE ? 'dark' : 'light');
    } else {
      root.style.removeProperty('color-scheme');
    }

    if (size.scale === 1) root.style.removeProperty('--text-scale');
    else root.style.setProperty('--text-scale', String(size.scale));

    themeColor(current.bar || current.bg || '');
    return current;
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
  apply({
    bg: start.themeBg,
    bar: start.themeBar,
    accent: start.themeAccent,
    textSize: start.textSize
  });

  // A derived palette is a snapshot of the system scheme, so re-derive it when
  // that flips. With nothing customised there is nothing to redo — CSS has it.
  if (window.matchMedia) {
    var query = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { apply(current); };
    if (query.addEventListener) query.addEventListener('change', onChange);
    else if (query.addListener) query.addListener(onChange);
  }

  return {
    PRESETS: PRESETS,
    TEXT_SIZES: TEXT_SIZES,
    DEFAULT_TEXT_SIZE: DEFAULT_TEXT_SIZE,
    apply: apply,
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
        bar: normalise(style.getPropertyValue('--bar')) || '#ffffff',
        accent: normalise(style.getPropertyValue('--brand')) || '#4f6bf6'
      };
    },
    tokens: function (bg, bar, accent) {
      return {
        page: normalise(bg) ? pageTokens(normalise(bg), accent) : null,
        bar: normalise(bar) ? barTokens(normalise(bar), accent) : null
      };
    },
    current: function () {
      return {
        bg: current.bg, bar: current.bar,
        accent: current.accent, textSize: current.textSize
      };
    }
  };
})();
