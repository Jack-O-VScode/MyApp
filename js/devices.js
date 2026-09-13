/* Which devices this account has, and which of them are awake right now.

   A transfer has to be aimed at something, so each device registers itself
   under a name you can recognise and says hello every so often. "Online" means
   nothing more than "said hello recently" — there is no connection to keep up,
   and a device that closes the app simply stops saying it.

   The device's own id lives in its own localStorage key rather than in the
   synced settings, because it is the one piece of state that must NOT travel
   between devices.
*/
window.Devices = (function () {
  'use strict';

  var KEY = 'calendar-notes.device';
  var BEAT = 15000;          // how often this device says hello
  var AWAKE = 50000;         // how recently another one must have, to count

  var me = null;
  var peers = [];
  var timer = null;
  var listeners = [];

  /* ------------------------------------------------------------ identity -- */

  function guess() {
    var agent = navigator.userAgent || '';
    var touch = navigator.maxTouchPoints || 0;
    if (/iPhone/i.test(agent)) return { platform: 'iphone', name: 'iPhone' };
    // An iPad reports itself as a Mac; the touch points give it away.
    if (/iPad/i.test(agent) || (/Macintosh/i.test(agent) && touch > 1)) {
      return { platform: 'ipad', name: 'iPad' };
    }
    if (/Android/i.test(agent)) {
      return { platform: 'android', name: /Mobile/i.test(agent) ? 'Android phone' : 'Android tablet' };
    }
    if (/Macintosh|Mac OS X/i.test(agent)) return { platform: 'mac', name: 'Mac' };
    if (/Windows/i.test(agent)) return { platform: 'windows', name: 'Windows PC' };
    if (/Linux|X11/i.test(agent)) return { platform: 'linux', name: 'Linux PC' };
    return { platform: 'other', name: 'This device' };
  }

  function load() {
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (err) {
      stored = null;
    }
    if (stored && stored.id) return stored;

    var guessed = guess();
    var fresh = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      name: guessed.name,
      platform: guessed.platform
    };
    save(fresh);
    return fresh;
  }

  function save(identity) {
    try {
      localStorage.setItem(KEY, JSON.stringify(identity));
    } catch (err) {
      // A device that cannot remember its own id gets a new one next launch.
      // Transfers still work; it just shows up twice in the list.
    }
  }

  /* --------------------------------------------------------------- table -- */

  function rest(path, options) {
    var opts = options || {};
    return Sync.authorized().then(function (auth) {
      return fetch(auth.url + '/rest/v1/' + path, {
        method: opts.method || 'GET',
        headers: Object.assign({
          'Content-Type': 'application/json',
          Prefer: opts.prefer || 'return=minimal'
        }, auth.headers),
        body: opts.body ? JSON.stringify(opts.body) : undefined
      }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) throw new Error(text || ('Request failed (' + response.status + ')'));
          return text ? JSON.parse(text) : null;
        });
      });
    });
  }

  function announce() {
    if (!me) return Promise.resolve();
    return Sync.authorized().then(function (auth) {
      return rest('devices?on_conflict=user_id,id', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates,return=minimal',
        body: [{
          user_id: auth.userId,
          id: me.id,
          name: me.name,
          platform: me.platform,
          seen_at: new Date().toISOString()
        }]
      });
    }).catch(function () {
      // Offline, or sync not set up. Nothing to do but try again next beat.
    });
  }

  function refresh() {
    return rest('devices?select=id,name,platform,seen_at').then(function (rows) {
      peers = (rows || []).map(function (row) {
        return {
          id: row.id,
          name: row.name,
          platform: row.platform,
          seenAt: Date.parse(row.seen_at) || 0,
          isMe: !!me && row.id === me.id
        };
      }).sort(function (a, b) {
        if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
        return b.seenAt - a.seenAt;
      });
      emit();
      return peers;
    }).catch(function () {
      return peers;
    });
  }

  function forget(id) {
    return rest('devices?id=eq.' + encodeURIComponent(id), { method: 'DELETE' })
      .then(refresh);
  }

  /* ---------------------------------------------------------------- state -- */

  function isAwake(device) {
    return !!device && Date.now() - device.seenAt < AWAKE;
  }

  function emit() {
    listeners.forEach(function (fn) { fn(peers); });
  }

  function start() {
    if (timer) return;
    var tick = function () { announce().then(refresh); };
    tick();
    timer = setInterval(tick, BEAT);
    // A device that has been asleep looks offline to everyone; say hello the
    // moment it is back rather than waiting out the interval.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
  }

  function init() {
    me = load();
    if (Sync.getStatus().state !== 'off') start();
    Sync.subscribe(function (status) {
      if (status.state !== 'off') start();
    });
  }

  return {
    init: init,
    me: function () { return me ? Object.assign({}, me) : null; },
    rename: function (name) {
      var clean = String(name || '').trim().slice(0, 40);
      if (!clean || !me) return Promise.resolve(me);
      me.name = clean;
      save(me);
      return announce().then(refresh).then(function () { return me; });
    },
    list: function () { return peers.slice(); },
    others: function () {
      return peers.filter(function (device) { return !device.isMe; });
    },
    isAwake: isAwake,
    refresh: refresh,
    forget: forget,
    subscribe: function (fn) { listeners.push(fn); }
  };
})();
