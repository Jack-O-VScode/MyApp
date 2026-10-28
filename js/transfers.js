/* Send a file from one of your devices to another.

   This is a courier, not a filing cabinet: a file goes into a private bucket in
   your own Supabase project, the other device fetches it, and it is gone within
   a day whether anyone collected it or not.

   The bucket itself is the list — there is no metadata table to drift out of
   step with it. Each object is keyed

       <user id>/<timestamp>-<random>-e<expiry>[-f<count>]__<file name>

   which is what lets row-level security scope a folder to its owner, and what
   carries the original file name, its age and when it goes without a second
   lookup. <expiry> is the instant in milliseconds, or "never". Files sent
   before expiry was choosable have no -e part and keep their 24 hours.

   A folder travels as one .zip made on the sending device (js/zip.js), with
   -f<count> saying how many files are inside so the list can say "Folder".
   Every OS opens a zip back into the folder with a tap.
*/
window.TransfersView = (function () {
  'use strict';

  var BUCKET = 'transfers';
  var MAX_AGE = 24 * 60 * 60 * 1000;     // files from before expiry was choosable
  var EXPIRY_KEY = 'calendar-notes.transfer-expiry';
  var UNIT_MS = { minute: 60000, hour: 3600000, day: 86400000 };
  var UNIT_MAX = { minute: 525600, hour: 87600, day: 3650 };   // ten years, whichever way
  var expiry = { amount: 24, unit: 'hour', never: false };
  var SIZE_WARNING = 50 * 1024 * 1024;   // the default per-file cap on a new bucket
  // A folder bigger than this before zipping will not squeeze under the cap,
  // and zipping it would only tie the device up finding that out.
  var FOLDER_RAW_CAP = 4 * SIZE_WARNING;
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

  function plural(count, word) {
    return count + ' ' + word + (count === 1 ? '' : 's');
  }

  // `expiresAt` is null for a file that never expires.
  function expiresIn(expiresAt, now) {
    if (expiresAt === null) return 'never expires';
    var left = expiresAt - (now || Date.now());
    if (left <= 0) return 'expiring';
    if (left < 3600000) return 'expires in ' + Math.max(1, Math.ceil(left / 60000)) + ' min';
    if (left < 48 * 3600000) return 'expires in ' + plural(Math.ceil(left / 3600000), 'hour');
    return 'expires in ' + plural(Math.ceil(left / 86400000), 'day');
  }

  /* ---------------------------------------------------------------- expiry -- */

  // How long a typed amount and unit come to, or an error to show instead.
  function lifetime(amountText, unit) {
    var text = String(amountText).trim();
    if (!/^\d+$/.test(text) || Number(text) < 1) {
      return { error: 'Type a whole number, 1 or more, for how long to keep it.' };
    }
    if (!UNIT_MS[unit]) return { error: 'Pick minutes, hours or days.' };
    var amount = Number(text);
    if (amount > UNIT_MAX[unit]) {
      return { error: 'That is more than ten years — use Never expire instead.' };
    }
    return { ms: amount * UNIT_MS[unit], amount: amount };
  }

  function loadExpiry() {
    try {
      var saved = JSON.parse(localStorage.getItem(EXPIRY_KEY) || 'null');
      if (saved && UNIT_MS[saved.unit]) {
        expiry = { amount: String(saved.amount), unit: saved.unit, never: !!saved.never };
      }
    } catch (err) {
      // A device with no storage just starts from a day each time.
    }
  }

  function saveExpiry() {
    try {
      localStorage.setItem(EXPIRY_KEY, JSON.stringify(expiry));
    } catch (err) {
      // Not worth failing a transfer over.
    }
  }

  function renderExpiry() {
    els.expiryAmount.value = expiry.amount;
    els.expiryAmount.disabled = expiry.never;
    Array.prototype.forEach.call(els.expiryUnit.querySelectorAll('[data-unit]'), function (button) {
      var on = button.dataset.unit === expiry.unit;
      button.classList.toggle('is-on', on && !expiry.never);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
      button.disabled = expiry.never;
    });
    els.expiryRow.classList.toggle('is-muted', expiry.never);
    els.expiryNever.classList.toggle('is-on', expiry.never);
    els.expiryNever.setAttribute('aria-pressed', expiry.never ? 'true' : 'false');
    els.expiryNever.textContent = expiry.never ? 'Never expire — on' : 'Never expire';
    summariseExpiry();
  }

  function summariseExpiry() {
    var summary = els.expirySummary;
    summary.classList.remove('is-error');
    if (expiry.never) {
      summary.textContent = 'What you send now stays until you remove it. It counts against your ' +
        'storage the whole time, so tidy up now and then.';
      return;
    }
    var span = lifetime(els.expiryAmount.value, expiry.unit);
    if (span.error) {
      summary.textContent = span.error;
      summary.classList.add('is-error');
      return;
    }
    summary.textContent = 'What you send now is deleted ' + plural(span.amount, expiry.unit) +
      ' after it is sent, picked up or not.';
  }

  function safeName(name) {
    return String(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'file';
  }

  function encodeKey(key) {
    return key.split('/').map(encodeURIComponent).join('/');
  }

  // "<stamp>-<random>-e<expiry>__<name>" back into something displayable.
  // `expiresAt` is a time, or null for never; 0 means "work it out from the
  // stamp", for the older keys that do not say.
  function parseKey(fileName) {
    var split = fileName.indexOf('__');
    if (split === -1) return { name: fileName, stamp: 0, expiresAt: 0, files: 0 };
    var parts = fileName.slice(0, split).split('-');
    var stamp = Number(parts[0]) || 0;
    var expiresAt = stamp ? stamp + MAX_AGE : 0;
    var files = 0;
    parts.slice(2).forEach(function (mark) {
      if (mark === 'enever') expiresAt = null;
      else if (/^e\d+$/.test(mark)) expiresAt = Number(mark.slice(1));
      else if (/^f\d+$/.test(mark)) files = Number(mark.slice(1));
    });
    return {
      name: fileName.slice(split + 2) || fileName,
      stamp: stamp,
      expiresAt: expiresAt,
      files: files
    };
  }

  function expiryMark(expiresAt) {
    return expiresAt === null ? 'enever' : 'e' + expiresAt;
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
        // Folders come back as rows with no id: the device-to-device relay and
        // pictures attached to notes live in them, and are not files waiting.
        return (rows || []).filter(function (row) { return row && row.name && row.id; }).map(function (row) {
          var parsed = parseKey(row.name);
          var stamp = parsed.stamp || Date.parse(row.created_at) || Date.now();
          return {
            key: auth.userId + '/' + row.name,
            name: parsed.name,
            stamp: stamp,
            expiresAt: parsed.expiresAt === 0 ? stamp + MAX_AGE : parsed.expiresAt,
            files: parsed.files,
            size: (row.metadata && row.metadata.size) || 0
          };
        });
      });
    });
  }

  // XHR rather than fetch: only XHR reports upload progress.
  // `folderFiles` is how many files a zipped folder holds; 0 for a plain file.
  function upload(file, expiresAt, onProgress, folderFiles) {
    return Sync.authorized().then(function (auth) {
      var key = auth.userId + '/' + Date.now() + '-' +
        Math.random().toString(36).slice(2, 7) + '-' + expiryMark(expiresAt) +
        (folderFiles ? '-f' + folderFiles : '') +
        '__' + safeName(file.name);

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
        : (job.zipping ? 'Zipping… ' : 'Sending… ') + Math.round(job.progress * 100) + '%';
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
      if (item.files) row.classList.add('is-folder');
      meta.textContent = [
        item.files ? 'Folder · ' + plural(item.files, 'file') : '',
        formatSize(item.size), formatAge(item.stamp), expiresIn(item.expiresAt)
      ].filter(Boolean).join(' · ');
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
      var now = Date.now();
      var stale = rows.filter(function (row) { return row.expiresAt !== null && now > row.expiresAt; });
      items = rows.filter(function (row) { return row.expiresAt === null || now <= row.expiresAt; });
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

  // When what is sent now expires, or undefined (with the reason on screen)
  // when the typed amount is not usable. Worked out once, as things go: "an
  // hour" means an hour from now.
  function chosenExpiry() {
    if (expiry.never) return null;
    var span = lifetime(els.expiryAmount.value, expiry.unit);
    if (span.error) {
      setMessage(span.error, true);
      els.expiryAmount.focus();
      return undefined;
    }
    return Date.now() + span.ms;
  }

  function dropJob(job, delay) {
    setTimeout(function () {
      var at = uploads.indexOf(job);
      if (at !== -1) uploads.splice(at, 1);
      renderUploads();
    }, delay || 0);
  }

  function send(files) {
    if (!files || !files.length) return;
    var oversized = Array.prototype.filter.call(files, function (file) {
      return file.size > SIZE_WARNING;
    });
    if (oversized.length) {
      setMessage('“' + oversized[0].name + '” is ' + formatSize(oversized[0].size) +
        '. A single stored file cannot go past 50 MB on the free plan — ' +
        'use “Send to a device” above, which cuts it up and has no limit. ' +
        'On a paid plan, raise the cap under ' +
        'Storage → Buckets, or send something smaller.', true);
      return;
    }
    var expiresAt = chosenExpiry();
    if (expiresAt === undefined) return;
    setMessage('');

    Array.prototype.forEach.call(files, function (file) {
      var job = { name: file.name, progress: 0, error: '' };
      uploads.push(job);
      renderUploads();

      upload(file, expiresAt, function (fraction) {
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

  /* --------------------------------------------------------------- folders -- */

  // A folder is zipped here, then sent like any file. The size limit applies
  // to the zip, since that is what is stored.
  function sendFolder(folder) {
    var files = folder.entries.filter(function (entry) { return entry.file; });
    if (!files.length) {
      setMessage('“' + folder.name + '” is empty — there is nothing in it to send.', true);
      return;
    }
    var raw = files.reduce(function (sum, entry) { return sum + entry.file.size; }, 0);
    if (raw > FOLDER_RAW_CAP) {
      setMessage('“' + folder.name + '” holds ' + formatSize(raw) + ' in ' + plural(files.length, 'file') +
        ' — far past the 50 MB a stored file can be, even zipped. Zip it yourself and use ' +
        '“Send to a device” above, which has no limit, or send part of it.', true);
      return;
    }
    var expiresAt = chosenExpiry();
    if (expiresAt === undefined) return;
    setMessage('');

    var zipName = folder.name + '.zip';
    var job = { name: zipName, progress: 0, error: '', zipping: true };
    uploads.push(job);
    renderUploads();

    Zip.build(folder.entries, {
      onProgress: function (fraction) {
        job.progress = fraction;
        renderUploads();
      }
    }).then(function (blob) {
      if (blob.size > SIZE_WARNING) {
        dropJob(job);
        setMessage('Zipped, “' + folder.name + '” comes to ' + formatSize(blob.size) +
          ' — over the 50 MB a stored file can be on the free plan. Send part of it, or zip it ' +
          'and use “Send to a device” above, which has no limit.', true);
        return null;
      }
      job.zipping = false;
      job.progress = 0;
      renderUploads();
      var zipped = new File([blob], zipName, { type: 'application/zip', lastModified: Date.now() });
      return upload(zipped, expiresAt, function (fraction) {
        job.progress = fraction;
        renderUploads();
      }, files.length).then(function () {
        dropJob(job);
        return refresh(true);
      });
    }).catch(function (err) {
      job.error = friendlyError(err);
      renderUploads();
      dropJob(job, 6000);
    });
  }

  // A drop can mix files and folders. Entries must be taken during the drop
  // event itself — the browser empties the list as soon as it returns.
  function handleDrop(transfer) {
    var items = Array.prototype.slice.call(transfer.items || []);
    var entries = items.map(function (item) {
      return item.kind === 'file' && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    }).filter(Boolean);

    if (!entries.length) {
      if (transfer.files && transfer.files.length) send(transfer.files);
      return;
    }

    var loose = entries.filter(function (entry) { return entry.isFile; });
    if (loose.length) {
      Promise.all(loose.map(Folders.fileOf)).then(send, function (err) {
        setMessage(friendlyError(err), true);
      });
    }
    entries.filter(function (entry) { return entry.isDirectory; }).forEach(function (entry) {
      Folders.walk(entry).then(function (found) {
        sendFolder({ name: entry.name, entries: found });
      }, function () {
        setMessage('“' + entry.name + '” could not be read — try Choose a folder instead.', true);
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
      message: document.getElementById('transfer-message'),
      expiryAmount: document.getElementById('expiry-amount'),
      expiryUnit: document.getElementById('expiry-unit'),
      expiryRow: document.querySelector('#view-transfer .expiry-row'),
      expiryNever: document.getElementById('expiry-never'),
      expirySummary: document.getElementById('expiry-summary')
    };

    loadExpiry();
    renderExpiry();
    els.expiryAmount.addEventListener('input', function () {
      expiry.amount = els.expiryAmount.value;
      saveExpiry();
      summariseExpiry();
    });
    els.expiryUnit.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('[data-unit]');
      if (!button || expiry.never) return;
      expiry.unit = button.dataset.unit;
      saveExpiry();
      renderExpiry();
    });
    els.expiryNever.addEventListener('click', function () {
      expiry.never = !expiry.never;
      saveExpiry();
      renderExpiry();
    });

    els.input.addEventListener('change', function () {
      send(this.files);
      this.value = '';
    });
    document.getElementById('transfer-pick').addEventListener('click', function () {
      els.input.click();
    });

    var folderInput = document.getElementById('transfer-folder');
    var folderButton = document.getElementById('transfer-pick-folder');
    var canPickFolders = Folders.canPick();
    folderButton.hidden = !canPickFolders;
    document.getElementById('transfer-folder-tip').hidden = canPickFolders;
    folderButton.addEventListener('click', function () { folderInput.click(); });
    folderInput.addEventListener('change', function () {
      var folder = Folders.fromPicked(this.files);
      this.value = '';
      if (folder) sendFolder(folder);
      else setMessage('That folder is empty — there is nothing in it to send.', true);
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
      if (dropEvent.dataTransfer) handleDrop(dropEvent.dataTransfer);
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
    },
    // Exposed for the tests.
    _parseKey: parseKey,
    _lifetime: lifetime,
    _expiresIn: expiresIn
  };
})();
