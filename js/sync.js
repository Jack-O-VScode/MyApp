/* Optional device-to-device sync.

   The app is offline-first: localStorage stays the source of truth and every
   view reads from it. This module mirrors those records to a Supabase project
   the user owns, so a second device converges on the same data.

   Talking to Supabase over plain fetch (rather than the official SDK) keeps the
   app dependency-free and lets it start with no network at all.

   Shape of the exchange, per record: {id, kind, payload, deleted, created_at,
   updated_at}. Conflicts resolve last-write-wins on updated_at, which is a
   device clock — see the README for what that means in practice.
*/
window.Sync = (function () {
  'use strict';

  var CONFIG_KEY = 'calendar-notes.sync.v1';
  var TABLE = 'sync_records';
  var PAGE = 500;
  var PUSH_DEBOUNCE = 1500;
  var POLL_INTERVAL = 15000;
  var REQUEST_TIMEOUT = 15000;
  var EPOCH = '1970-01-01T00:00:00Z';

  var config = {
    url: '', anonKey: '',
    accessToken: '', refreshToken: '', expiresAt: 0,
    userId: '', email: '',
    cursor: EPOCH, lastSyncedAt: 0
  };

  var status = { state: 'off', message: '' };
  var listeners = [];
  var running = null;
  var rerun = false;
  var pushTimer = null;
  var pollTimer = null;

  /* -------------------------------------------------------------- config -- */

  function loadConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (raw) Object.assign(config, JSON.parse(raw));
    } catch (err) {
      console.warn('Could not read sync settings:', err);
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (err) {
      console.warn('Could not save sync settings:', err);
    }
  }

  function isConfigured() {
    return !!(config.url && config.anonKey);
  }

  function isSignedIn() {
    return isConfigured() && !!config.refreshToken && !!config.userId;
  }

  function setStatus(state, message) {
    status = { state: state, message: message || '' };
    listeners.forEach(function (fn) { fn(getStatus()); });
  }

  function getStatus() {
    return {
      configured: isConfigured(),
      signedIn: isSignedIn(),
      email: config.email,
      state: status.state,
      message: status.message,
      lastSyncedAt: config.lastSyncedAt
    };
  }

  /* ------------------------------------------------------------ requests -- */

  function request(path, options) {
    var opts = options || {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT);

    var headers = Object.assign({
      'apikey': config.anonKey,
      'Content-Type': 'application/json'
    }, opts.headers || {});
    if (opts.auth !== false && config.accessToken) {
      headers.Authorization = 'Bearer ' + config.accessToken;
    }

    return fetch(config.url.replace(/\/+$/, '') + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    }).then(function (response) {
      clearTimeout(timer);
      return response.text().then(function (text) {
        var data = null;
        if (text) {
          try { data = JSON.parse(text); } catch (err) { data = text; }
        }
        if (!response.ok) {
          var detail = data && (data.msg || data.message || data.error_description || data.error);
          var error = new Error(detail || ('Request failed (' + response.status + ')'));
          error.status = response.status;
          throw error;
        }
        return data;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        var timeout = new Error('The server took too long to answer.');
        timeout.offline = true;
        throw timeout;
      }
      // fetch() rejects with a TypeError when the network is unreachable.
      if (err instanceof TypeError) {
        var offline = new Error('No connection to the sync server.');
        offline.offline = true;
        throw offline;
      }
      throw err;
    });
  }

  /* ----------------------------------------------------------------- auth -- */

  function storeSession(session) {
    if (!session || !session.access_token) return false;
    config.accessToken = session.access_token;
    config.refreshToken = session.refresh_token || config.refreshToken;
    config.expiresAt = Date.now() + (Number(session.expires_in) || 3600) * 1000;
    if (session.user) {
      var previous = config.userId;
      config.userId = session.user.id;
      config.email = session.user.email || config.email;
      // A different account means the local cursor is meaningless: start over
      // and offer everything on this device to the new account.
      if (previous && previous !== config.userId) config.cursor = EPOCH;
    }
    saveConfig();
    return true;
  }

  function signIn(email, password) {
    return request('/auth/v1/token?grant_type=password', {
      method: 'POST', auth: false, body: { email: email, password: password }
    }).then(function (session) {
      if (!storeSession(session)) throw new Error('The server did not return a session.');
      return firstSyncForAccount();
    });
  }

  function signUp(email, password) {
    return request('/auth/v1/signup', {
      method: 'POST', auth: false, body: { email: email, password: password }
    }).then(function (result) {
      // With "Confirm email" left on in Supabase, signup returns a user but no
      // session until the emailed link is clicked.
      var session = result && result.access_token ? result : (result && result.session);
      if (!storeSession(session)) {
        var err = new Error('Account created. Confirm it from the email Supabase sent, then sign in.');
        err.pending = true;
        throw err;
      }
      return firstSyncForAccount();
    });
  }

  // On the first sync for an account, everything already on this device has to
  // be offered to the server or it would only ever exist here.
  function firstSyncForAccount() {
    if (config.cursor === EPOCH && Store.hasLocalData()) Store.markAllDirty();
    saveConfig();
    startPolling();
    return syncNow();
  }

  function signOut() {
    if (config.accessToken) {
      request('/auth/v1/logout', { method: 'POST' }).catch(function () {});
    }
    config.accessToken = '';
    config.refreshToken = '';
    config.expiresAt = 0;
    config.userId = '';
    config.email = '';
    config.cursor = EPOCH;
    config.lastSyncedAt = 0;
    saveConfig();
    stopPolling();
    setStatus('off', '');
  }

  function ensureToken() {
    if (!isSignedIn()) return Promise.reject(new Error('Not signed in.'));
    // Refresh a minute early so a slow request cannot straddle the expiry.
    if (config.accessToken && Date.now() < config.expiresAt - 60000) return Promise.resolve();

    return request('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', auth: false, body: { refresh_token: config.refreshToken }
    }).then(function (session) {
      if (!storeSession(session)) throw new Error('Could not refresh the session.');
    }).catch(function (err) {
      if (err.offline) throw err;
      // The refresh token is gone or revoked: the user has to sign in again.
      config.accessToken = '';
      config.refreshToken = '';
      config.userId = '';
      saveConfig();
      var fatal = new Error('Session expired — sign in again.');
      fatal.reauth = true;
      throw fatal;
    });
  }

  /* ----------------------------------------------------------- pull/push -- */

  function pull() {
    var cursor = config.cursor || EPOCH;
    var seen = 0;

    function page() {
      var query = '/rest/v1/' + TABLE +
        '?select=id,kind,payload,deleted,created_at,updated_at,synced_at' +
        '&synced_at=gte.' + encodeURIComponent(cursor) +
        '&order=synced_at.asc&limit=' + PAGE;

      return request(query).then(function (rows) {
        if (!Array.isArray(rows) || !rows.length) return seen;
        Store.applyRemote(rows);
        seen += rows.length;

        var last = rows[rows.length - 1].synced_at;
        if (rows.length < PAGE) {
          cursor = last;
          return seen;
        }
        // `gte` can re-read a batch that shares one timestamp; nudge past it
        // rather than loop forever on a full page of identical stamps.
        cursor = last === rows[0].synced_at
          ? new Date(new Date(last).getTime() + 1).toISOString()
          : last;
        return page();
      });
    }

    return page().then(function (count) {
      config.cursor = cursor;
      return count;
    });
  }

  function push() {
    var pending = Store.pendingRecords();
    if (!pending.length) return Promise.resolve(0);

    var rows = pending.map(function (record) {
      return {
        user_id: config.userId,
        id: record.id,
        kind: record.kind,
        payload: record.payload,
        deleted: record.deleted,
        created_at: record.created_at,
        updated_at: record.updated_at
      };
    });

    return request('/rest/v1/' + TABLE + '?on_conflict=user_id,id', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: rows
    }).then(function () {
      Store.markSynced(pending);
      return pending.length;
    });
  }

  function syncNow() {
    if (!isSignedIn()) return Promise.resolve();
    if (running) {
      rerun = true;
      return running;
    }

    setStatus('syncing', '');
    running = ensureToken()
      .then(pull)
      .then(push)
      .then(function () {
        config.lastSyncedAt = Date.now();
        saveConfig();
        setStatus('ok', '');
      })
      .catch(function (err) {
        if (err.offline) setStatus('offline', 'Waiting for a connection.');
        else if (err.reauth) setStatus('signed-out', err.message);
        else setStatus('error', err.message || 'Sync failed.');
      })
      .then(function () {
        running = null;
        if (rerun) {
          rerun = false;
          return syncNow();
        }
      });

    return running;
  }

  /* --------------------------------------------------------------- timing -- */

  function schedulePush() {
    if (!isSignedIn()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      syncNow();
    }, PUSH_DEBOUNCE);
  }

  function startPolling() {
    stopPolling();
    if (!isSignedIn()) return;
    pollTimer = setInterval(function () {
      if (document.visibilityState === 'visible') syncNow();
    }, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  /* ------------------------------------------------------------------ api -- */

  function configure(url, anonKey) {
    config.url = String(url || '').trim().replace(/\/+$/, '');
    config.anonKey = String(anonKey || '').trim();
    saveConfig();
    setStatus(isSignedIn() ? 'ok' : 'off', '');
  }

  function forget() {
    signOut();
    config.url = '';
    config.anonKey = '';
    saveConfig();
    setStatus('off', '');
  }

  function init() {
    loadConfig();

    Store.subscribe(schedulePush);

    // Coming back to the app is the moment a stale screen matters most.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') syncNow();
    });
    window.addEventListener('focus', function () { syncNow(); });
    window.addEventListener('online', function () { syncNow(); });

    // Send anything outstanding before the tab goes away.
    window.addEventListener('pagehide', function () {
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
        syncNow();
      }
    });

    if (isSignedIn()) {
      setStatus('syncing', '');
      startPolling();
      syncNow();
    }
  }

  return {
    init: init,
    subscribe: function (fn) { listeners.push(fn); },
    getStatus: getStatus,
    getConfig: function () { return { url: config.url, anonKey: config.anonKey }; },
    configure: configure,
    signIn: signIn,
    signUp: signUp,
    signOut: signOut,
    forget: forget,
    syncNow: syncNow
  };
})();
