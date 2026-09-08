/* Reminders that arrive when the app is closed.

   Web push needs something server-side to do the waking, but the awkward part
   — working out *when* a repeating event next happens — already lives in the
   store. So the split is: this file computes the exact instants a notification
   should fire and writes them to a `reminders` table; the scheduled function on
   the server only ever asks "what is due now?" and sends it. No recurrence
   logic in SQL, and one place to fix if it is ever wrong.

   The schedule is recomputed from scratch whenever data changes and pushed as
   a whole. Rows carry deterministic ids, so recomputing replaces cleanly
   instead of piling up duplicates.
*/
window.Reminders = (function () {
  'use strict';

  var HORIZON_DAYS = 14;
  var PUSH_DELAY = 8000;      // settle after edits before rewriting the schedule
  var LOCAL_KEY = 'calendar-notes.push.v1';

  var pushTimer = null;
  var lastPushed = '';

  /* ------------------------------------------------------------ computing -- */

  function atTime(dateKey, time) {
    var parts = String(time || '09:00').split(':');
    var date = Store.fromKey(dateKey);
    date.setHours(Number(parts[0]) || 0, Number(parts[1]) || 0, 0, 0);
    return date;
  }

  function describeCount(count) {
    return count === 1 ? '1 task due today' : count + ' tasks due today';
  }

  // Everything that should fire between `from` and the horizon, as rows ready
  // for the table. Exposed with an explicit `from` so it can be tested.
  function computeSchedule(from) {
    var now = from || new Date();
    var settings = Store.getSettings();
    var todayKey = Store.toKey(now);
    var lastKey = Store.shiftKey(todayKey, HORIZON_DAYS);
    var rows = [];

    // --- event reminders, opted into one event at a time -------------------
    Store.eventsInRange(todayKey, lastKey).forEach(function (item) {
      if (typeof item.remind !== 'number' || item.remind < 0) return;

      // An all-day event has no clock time of its own, so it borrows the time
      // the daily digest uses.
      var base = atTime(item.date, item.time || settings.digestTime);
      var fire = new Date(base.getTime() - item.remind * 60000);
      if (fire <= now) return;

      rows.push({
        id: 'ev:' + item.id + ':' + item.date,
        fire_at: fire.toISOString(),
        title: item.title || 'Event',
        body: item.remind === 0
          ? 'Starting now'
          : (item.time ? 'At ' + item.time : 'Today') + (item.details ? ' · ' + item.details : ''),
        url: '#calendar'
      });
    });

    // --- one daily digest rather than a ping per task ----------------------
    if (settings.digestOn) {
      for (var offset = 0; offset <= HORIZON_DAYS; offset++) {
        var dayKey = Store.shiftKey(todayKey, offset);
        var fireAt = atTime(dayKey, settings.digestTime);
        if (fireAt <= now) continue;

        // Today's digest counts anything already overdue; a future day counts
        // only what falls on it.
        var due = Store.allTasks({ openOnly: true }).filter(function (task) {
          if (!task.due) return false;
          return offset === 0 ? task.due <= dayKey : task.due === dayKey;
        });
        if (!due.length) continue;

        rows.push({
          id: 'dg:' + dayKey,
          fire_at: fireAt.toISOString(),
          title: describeCount(due.length),
          body: due.slice(0, 3).map(function (task) { return task.title; }).join(', ') +
            (due.length > 3 ? ' and ' + (due.length - 3) + ' more' : ''),
          url: '#tasks'
        });
      }
    }

    rows.sort(function (a, b) { return a.fire_at < b.fire_at ? -1 : a.fire_at > b.fire_at ? 1 : 0; });
    return rows;
  }

  /* ------------------------------------------------------------- transport -- */

  function call(path, options) {
    var opts = options || {};
    return Sync.authorized().then(function (auth) {
      return fetch(auth.url + path, {
        method: opts.method || 'GET',
        headers: Object.assign({ 'Content-Type': 'application/json' }, auth.headers, opts.headers || {}),
        body: opts.body ? JSON.stringify(opts.body) : undefined
      }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) {
            var detail = text;
            try {
              detail = JSON.parse(text).message || text;
            } catch (err) {
              // Some errors come back as plain text.
            }
            var error = new Error(detail || ('Request failed (' + response.status + ')'));
            error.status = response.status;
            throw error;
          }
          return text ? JSON.parse(text) : null;
        });
      });
    });
  }

  // Replace the future schedule with the freshly computed one. `sent_at` is
  // deliberately absent from the payload: PostgREST only updates the columns
  // it is given, so a reminder that already fired is not resurrected.
  function pushSchedule() {
    if (!Sync.getStatus().signedIn) return Promise.resolve();
    var settings = Store.getSettings();
    var rows = settings.remindersOn ? computeSchedule() : [];

    var fingerprint = JSON.stringify(rows);
    if (fingerprint === lastPushed) return Promise.resolve();

    return Sync.authorized().then(function (auth) {
      var nowIso = new Date().toISOString();
      var keep = rows.map(function (row) { return '"' + row.id + '"'; }).join(',');
      var stale = '/rest/v1/reminders?user_id=eq.' + auth.userId +
        '&sent_at=is.null&fire_at=gt.' + encodeURIComponent(nowIso) +
        (rows.length ? '&id=not.in.(' + encodeURIComponent(keep) + ')' : '');

      return call(stale, { method: 'DELETE' }).then(function () {
        if (!rows.length) return null;
        return call('/rest/v1/reminders?on_conflict=user_id,id', {
          method: 'POST',
          headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: rows.map(function (row) {
            return {
              user_id: auth.userId,
              id: row.id,
              fire_at: row.fire_at,
              title: row.title,
              body: row.body,
              url: row.url
            };
          })
        });
      }).then(function () {
        lastPushed = fingerprint;
      });
    }).catch(function (err) {
      // Nothing here is worth interrupting the user for; the next change or
      // app open tries again.
      console.warn('Could not update the reminder schedule:', err.message);
    });
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      pushSchedule();
    }, PUSH_DELAY);
  }

  /* -------------------------------------------------------- subscription -- */

  function urlBase64ToUint8Array(base64) {
    var padded = (base64 + '='.repeat((4 - base64.length % 4) % 4))
      .replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(padded);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function deviceLabel() {
    var agent = navigator.userAgent;
    if (/iPad/.test(agent)) return 'iPad';
    if (/iPhone/.test(agent)) return 'iPhone';
    if (/Android/.test(agent)) return 'Android';
    if (/Mac OS X/.test(agent)) return 'Mac';
    if (/Windows/.test(agent)) return 'Windows PC';
    return 'This device';
  }

  function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  // Shipped in js/config.js so no one has to paste it; a value saved in
  // settings still wins, for anyone pointing the app at their own project.
  function vapidKey() {
    var stored = Store.getSettings().vapidPublicKey;
    return stored || (window.APP_CONFIG || {}).vapidPublicKey || '';
  }

  function permission() {
    return supported() ? Notification.permission : 'unsupported';
  }

  // Must be called from a real click: iOS refuses the permission prompt
  // otherwise, and silently.
  function enable() {
    if (!supported()) {
      return Promise.reject(new Error('This browser cannot receive push notifications.'));
    }
    var settings = Store.getSettings();
    var publicKey = vapidKey();
    if (!publicKey) {
      return Promise.reject(new Error('Add your project’s public reminder key first.'));
    }
    if (!Sync.getStatus().signedIn) {
      return Promise.reject(new Error('Turn on sync first — reminders travel through the same project.'));
    }

    return Notification.requestPermission().then(function (result) {
      if (result !== 'granted') {
        throw new Error(result === 'denied'
          ? 'Notifications are blocked for this site. Allow them in your browser settings, then try again.'
          : 'Permission was dismissed.');
      }
      return navigator.serviceWorker.ready;
    }).then(function (registration) {
      return registration.pushManager.getSubscription().then(function (existing) {
        if (existing) return existing;
        return registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      });
    }).then(function (subscription) {
      return storeSubscription(subscription);
    }).then(function () {
      Store.saveSettings({ remindersOn: true });
      lastPushed = '';
      return pushSchedule();
    });
  }

  function storeSubscription(subscription) {
    var raw = subscription.toJSON();
    return Sync.authorized().then(function (auth) {
      return call('/rest/v1/push_subscriptions?on_conflict=endpoint', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: [{
          user_id: auth.userId,
          endpoint: raw.endpoint,
          p256dh: raw.keys.p256dh,
          auth: raw.keys.auth,
          label: deviceLabel()
        }]
      });
    }).then(function () {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify({ endpoint: raw.endpoint }));
      } catch (err) {
        // Only used to tidy up on disable; not worth failing over.
      }
    });
  }

  // Stops this device receiving. Other devices keep theirs.
  function disable() {
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    } catch (err) {
      stored = null;
    }

    var done = Promise.resolve();
    if (supported()) {
      done = navigator.serviceWorker.ready.then(function (registration) {
        return registration.pushManager.getSubscription();
      }).then(function (subscription) {
        return subscription ? subscription.unsubscribe() : null;
      }).catch(function () { return null; });
    }

    return done.then(function () {
      if (!stored || !stored.endpoint || !Sync.getStatus().signedIn) return null;
      return call('/rest/v1/push_subscriptions?endpoint=eq.' +
        encodeURIComponent(stored.endpoint), { method: 'DELETE' }).catch(function () { return null; });
    }).then(function () {
      try {
        localStorage.removeItem(LOCAL_KEY);
      } catch (err) {
        // Nothing to clean up.
      }
      Store.saveSettings({ remindersOn: false });
      lastPushed = '';
      return pushSchedule();
    });
  }

  // Proves the whole path end to end: this writes a row a few seconds out, so
  // the notification only arrives if the server function and cron are working.
  function sendTest() {
    return Sync.authorized().then(function (auth) {
      var fire = new Date(Date.now() + 15000).toISOString();
      return call('/rest/v1/reminders?on_conflict=user_id,id', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: [{
          user_id: auth.userId,
          id: 'test:' + Date.now(),
          fire_at: fire,
          title: 'Reminders are working',
          body: 'This came from your own project.',
          url: '#today'
        }]
      });
    });
  }

  function init() {
    Store.subscribe(schedulePush);
    Sync.subscribe(function (status) {
      if (status.signedIn) schedulePush();
    });
    window.addEventListener('focus', function () {
      // Cheap: pushSchedule bails immediately when nothing has changed.
      pushSchedule();
    });
    if (Sync.getStatus().signedIn) schedulePush();
  }

  return {
    init: init,
    supported: supported,
    permission: permission,
    vapidKey: vapidKey,
    enable: enable,
    disable: disable,
    sendTest: sendTest,
    computeSchedule: computeSchedule,
    pushSchedule: pushSchedule
  };
})();
