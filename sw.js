/* Offline support: the shell is precached, so the app opens with no network at
   all. Bump CACHE when any of the files below change.

   This worker also serves the chosen app icon. iOS reads <link rel=
   "apple-touch-icon"> out of the HTML it was handed, not out of the DOM as
   JavaScript later leaves it, so swapping the tag in the page is not enough to
   change a Home Screen icon. Rewriting the markup on the way past is.
*/
var CACHE = 'calendar-notes-v11';

// Which icon was picked, kept where both this worker and the page can see it.
// A cache of its own, so bumping CACHE never loses the choice.
var PREF_CACHE = 'calendar-notes-prefs';
var ICON_KEY = 'app-icon';
var ICONS = ['classic', 'midnight', 'sunrise', 'forest', 'mono'];
var DEFAULT_ICON = 'classic';

var SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/config.js',
  'js/theme.js',
  'js/store.js',
  'js/zones.js',
  'js/clocks.js',
  'js/calendar.js',
  'js/tasks.js',
  'js/today.js',
  'js/transfers.js',
  'js/notes.js',
  'js/reminders.js',
  'js/sync.js',
  'js/settings.js',
  'js/app.js',
  'manifest.webmanifest',
  // One per app icon. The PNGs behind them are not precached — opening App
  // settings renders all five previews, which is what puts them in the cache.
  'manifest-classic.webmanifest',
  'manifest-midnight.webmanifest',
  'manifest-sunrise.webmanifest',
  'manifest-forest.webmanifest',
  'manifest-mono.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // addAll fails as a unit; add one by one so a single missing optional
      // file cannot break the whole install.
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (err) {
          console.warn('[sw] could not cache', url, err);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key === CACHE || key === PREF_CACHE) return null;
        return caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function readIcon() {
  return caches.open(PREF_CACHE).then(function (cache) {
    return cache.match(ICON_KEY);
  }).then(function (stored) {
    return stored ? stored.text() : DEFAULT_ICON;
  }).then(function (id) {
    return ICONS.indexOf(id) === -1 ? DEFAULT_ICON : id;
  }).catch(function () {
    return DEFAULT_ICON;
  });
}

function writeIcon(id) {
  var wanted = ICONS.indexOf(id) === -1 ? DEFAULT_ICON : id;
  return caches.open(PREF_CACHE).then(function (cache) {
    return cache.put(ICON_KEY, new Response(wanted));
  });
}

// The page tells us what was picked. It waits for the reply before reloading,
// so the very next navigation is served with the new icon already in it.
self.addEventListener('message', function (event) {
  var message = event.data || {};
  if (message.type !== 'app-icon') return;
  var reply = event.ports && event.ports[0];
  event.waitUntil(writeIcon(message.icon).then(function () {
    if (reply) reply.postMessage({ ok: true });
  }).catch(function () {
    if (reply) reply.postMessage({ ok: false });
  }));
});

// index.html ships pointing at the default icon; point it wherever the choice
// says instead. Anything unexpected hands back the response untouched — an app
// that loads with the wrong icon beats an app that does not load.
function withChosenIcon(response) {
  var type = response.headers.get('content-type') || '';
  if (!response.ok || type.indexOf('text/html') === -1) return Promise.resolve(response);

  return readIcon().then(function (id) {
    if (id === DEFAULT_ICON) return response;
    return response.text().then(function (html) {
      var folder = 'icons/' + id + '/';
      var patched = html
        .replace('href="icons/apple-touch-icon.png"', 'href="' + folder + 'apple-touch-icon.png"')
        .replace('href="icons/favicon-32.png"', 'href="' + folder + 'favicon-32.png"')
        .replace('href="icons/icon-192.png"', 'href="' + folder + 'icon-192.png"')
        .replace('href="manifest.webmanifest"', 'href="manifest-' + id + '.webmanifest"');

      var headers = new Headers(response.headers);
      // The body is a different length now, and a stale one breaks the reply.
      headers.delete('content-length');
      return new Response(patched, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
    });
  }).catch(function () {
    return response;
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network so a deployed update lands quickly, and fall
  // back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        // Cache what the server actually sent; rewrite only the copy going to
        // the browser, so the choice can change without a re-fetch.
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put('index.html', copy); });
        return withChosenIcon(response);
      }).catch(function () {
        return caches.match('index.html').then(function (cached) {
          return cached || caches.match('./');
        }).then(function (cached) {
          return cached ? withChosenIcon(cached) : Response.error();
        });
      })
    );
    return;
  }

  // Everything else: serve from cache first, refreshing it in the background.
  event.respondWith(
    caches.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var copy = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});


/* ------------------------------------------------------------- reminders -- */

// A push arrives whether or not the app is open, so everything the notification
// needs travels in the payload.
self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (err) {
    data = { title: 'Reminder', body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(self.registration.showNotification(data.title || 'Reminder', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    // One notification per reminder, so a re-send replaces rather than stacks.
    tag: data.tag || data.id || undefined,
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var raw = (event.notification.data && event.notification.data.url) || './';
  // Resolve against the registration scope, not self.location: inside a worker
  // the latter is sw.js itself, so '#tasks' would open the worker's source.
  var target = new URL(raw, self.registration.scope).href;

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(function (windows) {
      for (var i = 0; i < windows.length; i++) {
        var client = windows[i];
        if (client.url.indexOf(self.registration.scope) !== 0) continue;
        if ('navigate' in client && client.url !== target) {
          return client.navigate(target).then(function (moved) {
            return (moved || client).focus();
          }).catch(function () { return client.focus(); });
        }
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return null;
    }));
});
