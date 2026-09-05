/* Send a file from one of your devices to another.

   This is a courier, not a filing cabinet: a file goes into a private bucket in
   your own Supabase project, the other device fetches it, and it is gone within
   a day whether anyone collected it or not.

   The bucket itself is the list — there is no metadata table to drift out of
   step with it. Each object is keyed

       <user id>/<timestamp>-<random>__<file name>

   which is what lets row-level security scope a folder to its owner, and what
   carries the original file name and age without a second lookup.
*/
window.TransfersView = (function () {
  'use strict';

  var BUCKET = 'transfers';
  var MAX_AGE = 24 * 60 * 60 * 1000;
  var SIZE_WARNING = 50 * 1024 * 1024;   // the default per-file cap on a new bucket
  var POLL = 20000;

  var els = {};
  var items = [];
  var uploads = [];
  var pollTimer = null;
  var busy = false;

  /* ------------------------------------------------------------- helpers -- */

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    var units = ['B', 'KB', 'MB', 'GB'];
    var value = bytes;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return (unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)) + ' ' + units[unit];
  }

  function formatAge(stamp) {
    var minutes = Math.round((Date.now() - stamp) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + ' min ago';
    var hours = Math.round(minutes / 60);
    return hours + (hours === 1 ? ' hour ago' : ' hours ago');
  }

  function expiresIn(stamp) {
    var left = MAX_AGE - (Date.now() - stamp);
    if (left <= 0) return 'expiring';
    var hours = Math.ceil(left / 3600000);
    if (hours > 1) return 'expires in ' + hours + ' hours';
    if (left > 3600000) return 'expires in 1 hour';
    return 'expires in ' + Math.max(1, Math.round(left / 60000)) + ' min';
  }

  function safeName(name) {
    return String(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'file';
  }

  function encodeKey(key) {
    return key.split('/').map(encodeURIComponent).join('/');
  }

  // "<stamp>-<random>__<name>" back into something displayable.
  function parseKey(fileName) {
    var split = fileName.indexOf('__');
    if (split === -1) return { name: fileName, stamp: 0 };
    var prefix = fileName.slice(0, split);
    return {
      name: fileName.slice(split + 2) || fileName,
      stamp: Number(prefix.split('-')[0]) || 0
    };
  }

  function friendlyError(err) {
    var message = (err && err.message) || 'Something went wrong.';
    if (/bucket not found/i.test(message)) {
      return 'No “transfers” bucket in your Supabase project yet — run the storage ' +
        'setup SQL from the README, then try again.';
    }
    if (/row-level security|not authorized|permission/i.test(message)) {
      return 'Your project rejected that. Check the storage policy from the setup SQL.';
    }
    return message;
  }

  /* ------------------------------------------------------------ transport -- */

  function call(path, options) {
    var opts = options || {};
    return Sync.authorized().then(function (auth) {
      return fetch(auth.url + path, {
        method: opts.method || 'GET',
        headers: Object.assign({}, auth.headers, opts.headers || {}),
        body: opts.body
      }).then(function (response) {
        if (opts.raw) {
          if (!response.ok) return response.text().then(function (text) { throw toError(text, response); });
          return response.blob();
        }
        return response.text().then(function (text) {
          if (!response.ok) throw toError(text, response);
          return text ? JSON.parse(text) : null;
        });
      });
    });
  }

  function toError(text, response) {
    var detail = text;
    try {
      var parsed = JSON.parse(text);
      detail = parsed.message || parsed.error || text;
    } catch (err) {
      // Storage sometimes answers with plain text; keep it as-is.
    }
    var error = new Error(detail || ('Request failed (' + response.status + ')'));
    error.status = response.status;
    return error;
  }

  function list() {
    return Sync.authorized().then(function (auth) {
      return call('/storage/v1/object/list/' + BUCKET, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix: auth.userId,
          limit: 100,
          sortBy: { column: 'created_at', order: 'desc' }
        })
      }).then(function (rows) {
        return (rows || []).filter(function (row) { return row && row.name; }).map(function (row) {
          var parsed = parseKey(row.name);
          return {
            key: auth.userId + '/' + row.name,
            name: parsed.name,
            stamp: parsed.stamp || Date.parse(row.created_at) || Date.now(),
            size: (row.metadata && row.metadata.size) || 0
          };
        });
      });
    });
  }

  // XHR rather than fetch: only XHR reports upload progress.
  function upload(file, onProgress) {
    return Sync.authorized().then(function (auth) {
      var key = auth.userId + '/' + Date.now() + '-' +
        Math.random().toString(36).slice(2, 7) + '__' + safeName(file.name);

      // multipart/form-data, matching what the official Supabase client sends
      // from a browser — the shape their storage API is best tested against.
      // The browser sets Content-Type (with the boundary), so we must not.
      var form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file, safeName(file.name));

      return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', auth.url + '/storage/v1/object/' + BUCKET + '/' + encodeKey(key));
        Object.keys(auth.headers).forEach(function (header) {
          xhr.setRequestHeader(header, auth.headers[header]);
        });
        xhr.setRequestHeader('x-upsert', 'true');

        xhr.upload.onprogress = function (progressEvent) {
          if (progressEvent.lengthComputable) {
            onProgress(progressEvent.loaded / progressEvent.total);
          }
        };
        xhr.onload = function () {
          if (xhr.status >= 200 && xhr.status < 300) resolve(key);
          else reject(toError(xhr.responseText, { status: xhr.status }));
        };
        xhr.onerror = function () { reject(new Error('Upload failed — check the connection.')); };
        xhr.send(form);
      });
    });
  }

  function download(item) {
    return call('/storage/v1/object/' + BUCKET + '/' + encodeKey(item.key), { raw: true });
  }

  function destroy(key) {
    return call('/storage/v1/object/' + BUCKET + '/' + encodeKey(key), { method: 'DELETE' });
  }

  /* --------------------------------------------------------------- saving -- */

  // iOS has no downloads folder, so offer the share sheet there (Save to Files,
  // AirDrop, anywhere) and fall back to a plain download elsewhere.
  function saveBlob(blob, name) {
    var file = null;
    try {
      file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    } catch (err) {
      file = null;
    }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file] }).then(function () { return 'shared'; },
        function () { return 'cancelled'; });
    }

    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    return Promise.resolve('downloaded');
  }

  /* ------------------------------------------------------------ rendering -- */

  function setMessage(text, isError) {
    els.message.textContent = text || '';
    els.message.hidden = !text;
    els.message.classList.toggle('is-error', !!isError);
  }

  function renderUploads() {
    els.uploads.innerHTML = '';
    els.uploads.hidden = !uploads.length;
    uploads.forEach(function (job) {
      var row = document.createElement('li');
      row.className = 'transfer-item is-uploading';

      var body = document.createElement('div');
      body.className = 'transfer-body';
      var name = document.createElement('span');
      name.className = 'transfer-name';
      name.textContent = job.name;
      var meta = document.createElement('span');
      meta.className = 'transfer-meta';
      meta.textContent = job.error
        ? job.error
        : 'Sending… ' + Math.round(job.progress * 100) + '%';
      body.appendChild(name);
      body.appendChild(meta);

      var bar = document.createElement('div');
      bar.className = 'progress';
      var fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = Math.round(job.progress * 100) + '%';
      bar.appendChild(fill);
      body.appendChild(bar);

      row.appendChild(body);
      els.uploads.appendChild(row);
    });
  }

  function renderList() {
    els.list.innerHTML = '';

    if (!items.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'Nothing waiting. Send a file and it shows up on your other devices.';
      els.list.appendChild(empty);
      return;
    }

    items.forEach(function (item) {
      var row = document.createElement('li');
      row.className = 'transfer-item';

      var body = document.createElement('div');
      body.className = 'transfer-body';
      var name = document.createElement('span');
      name.className = 'transfer-name';
      name.textContent = item.name;
      var meta = document.createElement('span');
      meta.className = 'transfer-meta';
      meta.textContent = [formatSize(item.size), formatAge(item.stamp), expiresIn(item.stamp)]
        .filter(Boolean).join(' · ');
      body.appendChild(name);
      body.appendChild(meta);

      var actions = document.createElement('div');
      actions.className = 'transfer-actions';
      var save = document.createElement('button');
      save.type = 'button';
      save.className = 'button primary small';
      save.dataset.save = item.key;
      save.textContent = 'Save';
      var remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'button danger small';
      remove.dataset.remove = item.key;
      remove.textContent = 'Remove';
      actions.appendChild(save);
      actions.appendChild(remove);

      row.appendChild(body);
      row.appendChild(actions);
      els.list.appendChild(row);
    });
  }

  function render() {
    var status = Sync.getStatus();
    var ready = status.signedIn;

    els.setup.hidden = ready;
    els.panel.hidden = !ready;
    if (!ready) {
      stopPolling();
      return;
    }

    renderUploads();
    renderList();
    startPolling();
  }

  /* -------------------------------------------------------------- actions -- */

  function refresh(quiet) {
    if (!Sync.getStatus().signedIn || busy) return Promise.resolve();
    busy = true;
    if (!quiet) setMessage('');

    return list().then(function (rows) {
      // A courier that keeps things is a filing cabinet. Anything past its day
      // goes, collected or not.
      var stale = rows.filter(function (row) { return Date.now() - row.stamp > MAX_AGE; });
      items = rows.filter(function (row) { return Date.now() - row.stamp <= MAX_AGE; });
      renderList();
      return Promise.all(stale.map(function (row) {
        return destroy(row.key).catch(function () {});
      }));
    }).catch(function (err) {
      if (!quiet) setMessage(friendlyError(err), true);
    }).then(function () {
      busy = false;
    });
  }

  function send(files) {
    if (!files || !files.length) return;
    var oversized = Array.prototype.filter.call(files, function (file) {
      return file.size > SIZE_WARNING;
    });
    if (oversized.length) {
      setMessage('“' + oversized[0].name + '” is ' + formatSize(oversized[0].size) +
        '. New buckets cap uploads at 50 MB — raise the limit in Supabase under ' +
        'Storage → Buckets, or send something smaller.', true);
      return;
    }
    setMessage('');

    Array.prototype.forEach.call(files, function (file) {
      var job = { name: file.name, progress: 0, error: '' };
      uploads.push(job);
      renderUploads();

      upload(file, function (fraction) {
        job.progress = fraction;
        renderUploads();
      }).then(function () {
        uploads.splice(uploads.indexOf(job), 1);
        renderUploads();
        return refresh(true);
      }).catch(function (err) {
        job.error = friendlyError(err);
        renderUploads();
        setTimeout(function () {
          uploads.splice(uploads.indexOf(job), 1);
          renderUploads();
        }, 6000);
      });
    });
  }

  function handleClick(clickEvent) {
    var save = clickEvent.target.closest('[data-save]');
    if (save) {
      var item = items.filter(function (row) { return row.key === save.dataset.save; })[0];
      if (!item) return;
      save.disabled = true;
      save.textContent = 'Saving…';
      download(item).then(function (blob) {
        return saveBlob(blob, item.name);
      }).then(function (how) {
        save.textContent = how === 'cancelled' ? 'Save' : 'Saved';
        save.disabled = how === 'cancelled' ? false : true;
      }).catch(function (err) {
        save.disabled = false;
        save.textContent = 'Save';
        setMessage(friendlyError(err), true);
      });
      return;
    }

    var remove = clickEvent.target.closest('[data-remove]');
    if (remove) {
      remove.disabled = true;
      destroy(remove.dataset.remove).then(function () {
        return refresh(true);
      }).catch(function (err) {
        remove.disabled = false;
        setMessage(friendlyError(err), true);
      });
    }
  }

  /* --------------------------------------------------------------- timing -- */

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function () {
      if (els.view.hidden || document.visibilityState !== 'visible') return;
      refresh(true);
    }, POLL);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------------------------------------------ api -- */

  function init() {
    els = {
      view: document.getElementById('view-transfer'),
      setup: document.getElementById('transfer-setup'),
      panel: document.getElementById('transfer-panel'),
      drop: document.getElementById('transfer-drop'),
      input: document.getElementById('transfer-file'),
      uploads: document.getElementById('transfer-uploads'),
      list: document.getElementById('transfer-list'),
      message: document.getElementById('transfer-message')
    };

    els.input.addEventListener('change', function () {
      send(this.files);
      this.value = '';
    });
    document.getElementById('transfer-pick').addEventListener('click', function () {
      els.input.click();
    });
    document.getElementById('transfer-refresh').addEventListener('click', function () {
      refresh(false);
    });
    els.list.addEventListener('click', handleClick);

    // Dragging onto the window is the natural gesture on a PC.
    ['dragenter', 'dragover'].forEach(function (name) {
      els.drop.addEventListener(name, function (dragEvent) {
        dragEvent.preventDefault();
        els.drop.classList.add('is-over');
      });
    });
    ['dragleave', 'drop'].forEach(function (name) {
      els.drop.addEventListener(name, function (dragEvent) {
        dragEvent.preventDefault();
        els.drop.classList.remove('is-over');
      });
    });
    els.drop.addEventListener('drop', function (dropEvent) {
      if (dropEvent.dataTransfer && dropEvent.dataTransfer.files.length) {
        send(dropEvent.dataTransfer.files);
      }
    });

    Sync.subscribe(function () {
      if (!els.view.hidden) render();
    });
  }

  return {
    init: init,
    render: function () {
      render();
      if (Sync.getStatus().signedIn) refresh(true);
    }
  };
})();
