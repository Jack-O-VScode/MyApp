/* Sending a file from one of your devices to another, at any size.

   Supabase caps a single stored object at 50 MB on the free plan, so a file is
   always cut into CHUNK-sized pieces and moved a piece at a time. Both devices
   have to be awake and both have to say Ready, and that requirement is what
   makes the rest work: the two ends are both listening, so they can agree on a
   route and tidy up behind themselves as they go.

   Two routes, in order of preference:

   - direct, over a WebRTC data channel. Nothing but the handshake touches the
     server, so there is no size limit and no bandwidth bill, and on one Wi-Fi
     it is far faster. Needs a route between the two devices to exist, which
     across some networks it does not.
   - relayed, through the storage bucket. The sender puts one chunk up, waits
     for the receiver to say it is safely stored, deletes it, and only then
     sends the next. One chunk exists on the server at a time, so a file of any
     size fits inside the storage quota.

   Either way the file is divided identically and the receiver acknowledges
   whole chunks, which is what lets a transfer that dies half way — a closed
   lid, a dropped connection, a route that stops working — resume from the last
   chunk that landed instead of starting again.
*/
window.Beam = (function () {
  'use strict';

  var BUCKET = 'transfers';
  var CHUNK = 32 * 1024 * 1024;      // comfortably under the 50 MB object cap
  var FRAME = 16 * 1024;             // one message on a data channel
  var HIGH_WATER = 4 * 1024 * 1024;  // let the channel drain past this
  var CONNECT_TIMEOUT = 15000;       // before giving up on a direct route
  var IDLE_POLL = 5000;
  var BUSY_POLL = 1200;
  var LIVE = ['offered', 'ready', 'active'];

  var ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ];

  var jobs = {};        // session id -> what this device is doing about it
  var listeners = [];
  var pollTimer = null;
  var polling = false;

  /* -------------------------------------------------------------- plumbing -- */

  function myId() {
    var me = Devices.me();
    return me ? me.id : '';
  }

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

  function encodeKey(key) {
    return key.split('/').map(encodeURIComponent).join('/');
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function chunkCount(size) {
    return Math.max(1, Math.ceil(size / CHUNK));
  }

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  /* ----------------------------------------------------------------- state -- */

  function view(job) {
    var session = job.session || {};
    var total = Number(session.file_size) || 0;
    return {
      id: job.id,
      role: job.role,
      phase: job.phase,
      mode: job.mode || session.mode || '',
      name: session.file_name,
      size: total,
      peerName: job.peerName || session.from_name || '',
      done: job.bytes || 0,
      total: total,
      outcome: job.outcome || '',
      where: job.where || '',
      canSave: !!(job.sink && job.sink.deliver),
      progress: total ? Math.min(1, (job.bytes || 0) / total) : 0,
      rate: job.rate || 0,
      error: job.error || '',
      sink: job.sink ? job.sink.kind : '',
      resumed: !!job.resumedAt
    };
  }

  function snapshot() {
    return Object.keys(jobs).map(function (id) { return view(jobs[id]); });
  }

  function emit() {
    var state = snapshot();
    listeners.forEach(function (fn) { fn(state); });
  }

  function setPhase(job, phase, error) {
    job.phase = phase;
    if (error !== undefined) job.error = error;
    emit();
  }

  // Bytes per second, smoothed, so the figure on screen does not flicker.
  function measure(job, bytes) {
    var now = Date.now();
    job.bytes = bytes;
    if (job.markAt) {
      var seconds = (now - job.markAt) / 1000;
      if (seconds >= 0.5) {
        var rate = (bytes - job.markBytes) / seconds;
        job.rate = job.rate ? job.rate * 0.7 + rate * 0.3 : rate;
        job.markAt = now;
        job.markBytes = bytes;
      }
    } else {
      job.markAt = now;
      job.markBytes = bytes;
    }
  }

  /* -------------------------------------------------------------- sessions -- */

  function patchSession(id, fields) {
    return rest('transfer_sessions?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      body: Object.assign({ updated_at: new Date().toISOString() }, fields)
    });
  }

  function readSession(id) {
    return rest('transfer_sessions?select=*&id=eq.' + encodeURIComponent(id))
      .then(function (rows) { return (rows && rows[0]) || null; });
  }

  function liveSessions() {
    return rest('transfer_sessions?select=*&state=in.(' + LIVE.join(',') + ')&order=created_at.asc');
  }

  /* --------------------------------------------------------------- signals -- */

  function sendSignal(sessionId, kind, payload) {
    return rest('transfer_signals', {
      method: 'POST',
      body: [{ session_id: sessionId, from_device: myId(), kind: kind, payload: payload }]
    });
  }

  // Everything the *other* side has written since we last looked.
  function readSignals(sessionId, after) {
    return rest('transfer_signals?select=id,kind,payload' +
      '&session_id=eq.' + encodeURIComponent(sessionId) +
      '&from_device=neq.' + encodeURIComponent(myId()) +
      '&id=gt.' + after + '&order=id.asc');
  }

  function clearSignals(sessionId) {
    return rest('transfer_signals?session_id=eq.' + encodeURIComponent(sessionId),
      { method: 'DELETE' }).catch(function () {});
  }

  /* ----------------------------------------------------------- direct route -- */

  function connectDirect(job, isSender) {
    return new Promise(function (resolve, reject) {
      if (typeof RTCPeerConnection !== 'function') {
        reject(new Error('no WebRTC here'));
        return;
      }

      var peer = new RTCPeerConnection({ iceServers: ICE });
      var seen = 0;
      var settled = false;
      var pump = null;
      var timeout = null;

      var give = function (channel) {
        if (settled) return;
        settled = true;
        clearInterval(pump);
        clearTimeout(timeout);
        resolve({ peer: peer, channel: channel });
      };
      var giveUp = function (why) {
        if (settled) return;
        settled = true;
        clearInterval(pump);
        clearTimeout(timeout);
        try { peer.close(); } catch (err) { /* already gone */ }
        reject(new Error(why));
      };

      job.peer = peer;
      timeout = setTimeout(function () { giveUp('no direct route'); }, CONNECT_TIMEOUT);

      peer.onicecandidate = function (event) {
        if (event.candidate) {
          sendSignal(job.id, 'ice', event.candidate.toJSON()).catch(function () {});
        }
      };
      peer.onconnectionstatechange = function () {
        if (peer.connectionState === 'failed') giveUp('the direct route failed');
      };

      if (isSender) {
        var channel = peer.createDataChannel('file', { ordered: true });
        channel.binaryType = 'arraybuffer';
        channel.onopen = function () { give(channel); };
        peer.createOffer().then(function (offer) {
          return peer.setLocalDescription(offer).then(function () {
            return sendSignal(job.id, 'offer', { sdp: offer.sdp, type: offer.type });
          });
        }).catch(function (err) { giveUp(err.message); });
      } else {
        peer.ondatachannel = function (event) {
          var incoming = event.channel;
          incoming.binaryType = 'arraybuffer';
          if (incoming.readyState === 'open') give(incoming);
          else incoming.onopen = function () { give(incoming); };
        };
      }

      pump = setInterval(function () {
        readSignals(job.id, seen).then(function (rows) {
          (rows || []).forEach(function (row) {
            seen = Math.max(seen, row.id);
            if (row.kind === 'ice') {
              peer.addIceCandidate(new RTCIceCandidate(row.payload)).catch(function () {});
            } else if (row.kind === 'offer' && !isSender) {
              peer.setRemoteDescription(new RTCSessionDescription(row.payload))
                .then(function () { return peer.createAnswer(); })
                .then(function (answer) {
                  return peer.setLocalDescription(answer).then(function () {
                    return sendSignal(job.id, 'answer', { sdp: answer.sdp, type: answer.type });
                  });
                })
                .catch(function (err) { giveUp(err.message); });
            } else if (row.kind === 'answer' && isSender) {
              peer.setRemoteDescription(new RTCSessionDescription(row.payload))
                .catch(function (err) { giveUp(err.message); });
            }
          });
        }).catch(function () {});
      }, 700);
    });
  }

  // A data channel accepts more than it can send and then falls over; hold off
  // while it catches up.
  function drain(channel) {
    if (channel.bufferedAmount < HIGH_WATER) return Promise.resolve();
    return new Promise(function (resolve) {
      channel.bufferedAmountLowThreshold = HIGH_WATER / 2;
      var done = function () {
        channel.removeEventListener('bufferedamountlow', done);
        resolve();
      };
      channel.addEventListener('bufferedamountlow', done);
    });
  }

  /* ------------------------------------------------------------ relay route -- */

  function chunkKey(userId, sessionId, index) {
    return userId + '/beam/' + sessionId + '/' + index;
  }

  function putChunk(key, blob) {
    return Sync.authorized().then(function (auth) {
      var form = new FormData();
      form.append('cacheControl', '0');
      form.append('', blob, 'chunk');
      return fetch(auth.url + '/storage/v1/object/' + BUCKET + '/' + encodeKey(key), {
        method: 'POST',
        headers: Object.assign({ 'x-upsert': 'true' }, auth.headers),
        body: form
      }).then(function (response) {
        if (!response.ok) {
          return response.text().then(function (text) { throw new Error(text || 'Upload failed'); });
        }
        return key;
      });
    });
  }

  function getChunk(key) {
    return Sync.authorized().then(function (auth) {
      return fetch(auth.url + '/storage/v1/object/' + BUCKET + '/' + encodeKey(key), {
        headers: auth.headers
      }).then(function (response) {
        if (!response.ok) throw new Error('Chunk not ready');
        return response.blob();
      });
    });
  }

  function dropChunk(key) {
    return Sync.authorized().then(function (auth) {
      return fetch(auth.url + '/storage/v1/object/' + BUCKET + '/' + encodeKey(key), {
        method: 'DELETE',
        headers: auth.headers
      });
    }).catch(function () {});
  }

  /* ----------------------------------------------------------------- sinks -- */

  // Where a received file goes.
  //
  // A desktop browser writes straight into the file the user picked at the
  // start, so by the time the transfer ends it is already on disk and there is
  // nothing left to do.
  //
  // Everywhere else — iPhone and iPad above all — the file has to be collected
  // first and then handed to the system, and the handing over is only allowed
  // while a tap is being processed. Doing it when the transfer happens to
  // finish is not a tap, so iOS refuses and the file goes nowhere. The sink
  // therefore stops at "held" and waits for the Save button.
  function makeSink(name, type) {
    if (typeof window.showSaveFilePicker === 'function') {
      // A desktop picker only gets the reported type to go on; the bytes have
      // not arrived yet when the location is chosen.
      var suggested = hasExtension(name) || !EXTENSIONS[String(type || '').toLowerCase().split(';')[0]]
        ? name
        : name + '.' + EXTENSIONS[String(type || '').toLowerCase().split(';')[0]];
      return window.showSaveFilePicker({ suggestedName: suggested }).then(function (handle) {
        return handle.createWritable().then(function (writable) {
          return {
            kind: 'disk',
            write: function (blob) { return writable.write(blob); },
            close: function () {
              return writable.close().then(function () {
                return { outcome: 'saved', where: handle.name || name };
              });
            },
            abort: function () { return writable.abort().catch(function () {}); }
          };
        });
      });
    }

    var parts = [];
    var held = null;
    var saveAs = '';
    return Promise.resolve({
      kind: 'memory',
      write: function (blob) { parts.push(blob); return Promise.resolve(); },
      close: function () {
        held = new Blob(parts, { type: type || '' });
        parts = [];
        // Settle the name now, while there is time — reading the header is a
        // promise, and the Save button cannot afford to wait on one.
        return nameFor(name, held).then(function (settled) {
          saveAs = settled;
          return { outcome: 'held', where: settled };
        });
      },
      // Called from the Save button, so the tap is still live and iOS allows
      // it. The name was worked out when the transfer finished, so nothing is
      // awaited here that would cost us the tap.
      deliver: function () {
        if (!held) return Promise.resolve({ outcome: 'lost' });
        return saveBlob(held, saveAs || name);
      },
      abort: function () { parts = []; held = null; return Promise.resolve(); }
    });
  }

  // iOS has no downloads folder, so offer the share sheet — Save to Files,
  // Photos, AirDrop, anywhere — and fall back to a plain download elsewhere.
  // Every branch reports what actually happened; "saved" is never a guess.
  // iOS decides what a file is from its name as much as from its type, and
  // "Save Video" will not take something it cannot name. A file that arrives
  // without an extension therefore gets one that matches what it actually is.
  var EXTENSIONS = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv',
    'video/webm': 'webm', 'video/x-msvideo': 'avi',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/heic': 'heic', 'image/webp': 'webp',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
    'application/pdf': 'pdf', 'application/zip': 'zip',
    'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json'
  };

  // The type the sender reported is only as good as what its file picker said,
  // and for plenty of files that is an empty string. The bytes themselves are
  // not: every format below announces itself in its first few. This is what
  // makes the extension right even when nothing else knows what the file is.
  var SIGNATURES = [
    { ext: 'pdf', at: 0, bytes: [0x25, 0x50, 0x44, 0x46] },              // %PDF
    { ext: 'png', at: 0, bytes: [0x89, 0x50, 0x4E, 0x47] },
    { ext: 'gif', at: 0, bytes: [0x47, 0x49, 0x46, 0x38] },              // GIF8
    { ext: 'jpg', at: 0, bytes: [0xFF, 0xD8, 0xFF] },
    { ext: 'zip', at: 0, bytes: [0x50, 0x4B, 0x03, 0x04] },
    { ext: 'mkv', at: 0, bytes: [0x1A, 0x45, 0xDF, 0xA3] },              // EBML
    { ext: 'mp3', at: 0, bytes: [0x49, 0x44, 0x33] },                    // ID3
    { ext: 'wav', at: 8, bytes: [0x57, 0x41, 0x56, 0x45] },              // WAVE
    { ext: 'webp', at: 8, bytes: [0x57, 0x45, 0x42, 0x50] },             // WEBP
    // MP4 and friends carry "ftyp" at offset 4; the brand after it separates
    // a QuickTime .mov from everything else in the family.
    { ext: 'mp4', at: 4, bytes: [0x66, 0x74, 0x79, 0x70] }               // ftyp
  ];

  function sniff(blob) {
    return blob.slice(0, 16).arrayBuffer().then(function (buffer) {
      var head = new Uint8Array(buffer);
      var found = '';
      SIGNATURES.some(function (signature) {
        var hit = signature.bytes.every(function (byte, index) {
          return head[signature.at + index] === byte;
        });
        if (!hit) return false;
        found = signature.ext;
        if (signature.ext === 'mp4') {
          var brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
          if (brand === 'qt  ') found = 'mov';
          if (brand.slice(0, 3) === 'hei') found = 'heic';
        }
        return true;
      });
      return found;
    }).catch(function () {
      return '';
    });
  }

  function hasExtension(name) {
    var tail = String(name).slice(String(name).lastIndexOf('/') + 1);
    // Short, and with at least one letter in it: "clip.mp4" and "notes.gz" are
    // already named, "Holiday.2026" and "trim-178962" are not — a year or a
    // timestamp is no use to iOS when it decides what a file is.
    return /\.[A-Za-z0-9]{0,4}[A-Za-z][A-Za-z0-9]{0,4}$/.test(tail);
  }

  // Ask the reported type first, then the bytes. Resolves to the name to use.
  function nameFor(rawName, blob) {
    var clean = String(rawName || '').trim() || 'file';
    if (hasExtension(clean)) return Promise.resolve(clean);

    var byType = EXTENSIONS[String(blob.type || '').toLowerCase().split(';')[0]];
    if (byType) return Promise.resolve(clean + '.' + byType);

    return sniff(blob).then(function (byBytes) {
      return byBytes ? clean + '.' + byBytes : clean;
    });
  }

  function saveBlob(blob, name) {
    var file = null;
    try {
      file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    } catch (err) {
      file = null;
    }

    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file] }).then(function () {
        return { outcome: 'shared', where: name };
      }, function (err) {
        // Dismissing the sheet and never being allowed to open it both land
        // here, and they are not the same thing to tell someone.
        var blocked = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        return { outcome: blocked ? 'blocked' : 'cancelled' };
      });
    }

    try {
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      return Promise.resolve({ outcome: 'downloaded', where: name });
    } catch (err) {
      return Promise.resolve({ outcome: 'blocked' });
    }
  }

  // Roughly what this device could hold, for the warning before accepting.
  function roomFor(size) {
    if (typeof window.showSaveFilePicker === 'function') return Promise.resolve(true);
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(true);
    return navigator.storage.estimate().then(function (estimate) {
      if (!estimate || !estimate.quota) return true;
      return (estimate.quota - (estimate.usage || 0)) > size * 1.1;
    }).catch(function () { return true; });
  }

  /* --------------------------------------------------------------- sending -- */

  function offer(file, target) {
    var id = uid();
    var me = Devices.me();
    var session = {
      id: id,
      from_device: me.id,
      to_device: target.id,
      from_name: me.name,
      file_name: file.name,
      file_size: file.size,
      file_type: file.type || '',
      chunk_size: CHUNK,
      chunks: chunkCount(file.size),
      state: 'offered'
    };

    return rest('transfer_sessions', { method: 'POST', body: [session] }).then(function () {
      jobs[id] = {
        id: id, role: 'send', file: file, session: session,
        peerName: target.name, phase: 'offered', bytes: 0
      };
      emit();
      schedule(true);
      return id;
    });
  }

  function ready(id) {
    var job = jobs[id];
    if (!job) return Promise.resolve();
    var field = job.role === 'send' ? { sender_ready: true } : { receiver_ready: true };
    job.ready = true;
    setPhase(job, 'waiting');
    return patchSession(id, field).then(function () { schedule(true); });
  }

  function runSend(job) {
    var session = job.session;
    var start = Number(session.acked) || 0;
    if (start) job.resumedAt = start;
    job.bytes = start * CHUNK;
    setPhase(job, 'connecting');

    // Falling back is also how a half-finished transfer recovers: whatever the
    // reason the direct route stopped, the relay picks up at the last chunk the
    // receiver confirmed rather than at the beginning.
    var viaRelay = function () {
      job.mode = 'relay';
      return readSession(job.id).then(function (row) {
        var from = row ? Number(row.acked) || 0 : start;
        if (from > start) job.resumedAt = from;
        measure(job, from * CHUNK);
        return patchSession(job.id, { mode: 'relay', state: 'active' })
          .then(function () { return sendRelay(job, from); });
      });
    };

    return connectDirect(job, true).then(function (link) {
      job.mode = 'direct';
      job.channel = link.channel;
      return patchSession(job.id, { mode: 'direct', state: 'active' })
        .then(function () { return sendDirect(job, link.channel, start); })
        .catch(function (err) {
          if (job.cancelled) throw err;
          closeJob(job);
          return viaRelay();
        });
    }, viaRelay).then(function () {
      setPhase(job, 'done');
      return patchSession(job.id, { state: 'done' });
    }).then(function () {
      clearSignals(job.id);
      closeJob(job);
    }).catch(function (err) {
      fail(job, err);
    });
  }

  function sendDirect(job, channel, start) {
    var file = job.file;
    var total = chunkCount(file.size);
    setPhase(job, 'sending');

    // The receiver says which chunks are safely stored; that is both the flow
    // control and, written to the session row, the resume point.
    var acks = {};
    channel.onmessage = function (event) {
      if (typeof event.data !== 'string') return;
      try {
        var message = JSON.parse(event.data);
        if (message.ack !== undefined && acks[message.ack]) acks[message.ack]();
      } catch (err) { /* not for us */ }
    };
    channel.onclose = function () {
      if (job.phase === 'sending') job.channelClosed = true;
    };

    var step = function (index) {
      if (index >= total) {
        channel.send(JSON.stringify({ finished: true }));
        return Promise.resolve();
      }
      if (job.cancelled) return Promise.reject(new Error('cancelled'));
      if (job.channelClosed) return Promise.reject(new Error('the connection dropped'));

      var from = index * CHUNK;
      var slice = file.slice(from, Math.min(from + CHUNK, file.size));

      return slice.arrayBuffer().then(function (buffer) {
        var offsetIn = 0;
        var pushFrames = function () {
          if (offsetIn >= buffer.byteLength) return Promise.resolve();
          return drain(channel).then(function () {
            var end = Math.min(offsetIn + FRAME, buffer.byteLength);
            channel.send(buffer.slice(offsetIn, end));
            measure(job, from + end);
            offsetIn = end;
            if (offsetIn % (FRAME * 64) === 0) emit();
            return pushFrames();
          });
        };
        return pushFrames();
      }).then(function () {
        channel.send(JSON.stringify({ chunk: index }));
        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () {
            reject(new Error('the other device stopped answering'));
          }, 60000);
          acks[index] = function () {
            clearTimeout(timer);
            delete acks[index];
            resolve();
          };
        });
      }).then(function () {
        measure(job, Math.min(file.size, (index + 1) * CHUNK));
        emit();
        return step(index + 1);
      });
    };

    return step(start);
  }

  function sendRelay(job, start) {
    var file = job.file;
    var total = chunkCount(file.size);
    setPhase(job, 'sending');

    return Sync.authorized().then(function (auth) {
      var step = function (index) {
        if (index >= total) return Promise.resolve();
        if (job.cancelled) return Promise.reject(new Error('cancelled'));

        var key = chunkKey(auth.userId, job.id, index);
        var from = index * CHUNK;
        var slice = file.slice(from, Math.min(from + CHUNK, file.size));

        return putChunk(key, slice).then(function () {
          measure(job, Math.min(file.size, (index + 1) * CHUNK));
          emit();
          return patchSession(job.id, { sent: index + 1 });
        }).then(function () {
          // Wait for it to be collected before putting the next one up: that is
          // what keeps a single chunk on the server however big the file is.
          var settle = function () {
            if (job.cancelled) return Promise.reject(new Error('cancelled'));
            return readSession(job.id).then(function (row) {
              if (!row || row.state === 'cancelled') throw new Error('cancelled');
              if (Number(row.acked) > index) return dropChunk(key);
              return wait(900).then(settle);
            });
          };
          return settle();
        }).then(function () {
          return step(index + 1);
        });
      };
      return step(start);
    });
  }

  /* ------------------------------------------------------------- receiving -- */

  function accept(session) {
    // Called straight from the tap, because picking a save location is only
    // allowed while a gesture is still being handled.
    return makeSink(session.file_name, session.file_type).then(function (sink) {
      jobs[session.id] = {
        id: session.id, role: 'receive', session: session, sink: sink,
        peerName: session.from_name, phase: 'waiting', bytes: 0, ready: true
      };
      emit();
      return patchSession(session.id, { receiver_ready: true });
    }).then(function () {
      schedule(true);
    });
  }

  function runReceive(job) {
    var session = job.session;
    var start = Number(session.acked) || 0;
    if (start) job.resumedAt = start;
    job.bytes = start * CHUNK;
    setPhase(job, 'connecting');

    // Same on this side: what has already been written to the sink stays
    // written, and the relay continues from the chunk after it.
    var viaRelay = function () {
      job.mode = 'relay';
      return readSession(job.id).then(function (row) {
        var from = row ? Number(row.acked) || 0 : start;
        if (from > start) job.resumedAt = from;
        measure(job, from * CHUNK);
        return receiveRelay(job, from);
      });
    };

    return connectDirect(job, false).then(function (link) {
      job.mode = 'direct';
      job.channel = link.channel;
      return receiveDirect(job, link.channel).catch(function (err) {
        if (job.cancelled) throw err;
        closeJob(job);
        return viaRelay();
      });
    }, viaRelay).then(function () {
      setPhase(job, 'saving');
      return job.sink.close();
    }).then(function (result) {
      job.outcome = result.outcome;
      job.where = result.where || '';
      // "held" means every byte is here but nothing has been written anywhere
      // yet — the transfer is done, the saving is not, and saying otherwise is
      // how a file ends up lost.
      setPhase(job, result.outcome === 'held' ? 'held' : 'done');
      return patchSession(job.id, { state: 'done' });
    }).then(function () {
      clearSignals(job.id);
      closeJob(job);
    }).catch(function (err) {
      if (job.sink) job.sink.abort();
      fail(job, err);
    });
  }

  function receiveDirect(job, channel) {
    var session = job.session;
    var total = Number(session.chunks) || 1;
    setPhase(job, 'receiving');

    return new Promise(function (resolve, reject) {
      var parts = [];
      var got = Number(session.acked) || 0;
      var base = got * CHUNK;
      var writing = Promise.resolve();

      channel.onclose = function () {
        if (job.phase === 'receiving') reject(new Error('the connection dropped'));
      };

      channel.onmessage = function (event) {
        if (job.cancelled) { reject(new Error('cancelled')); return; }

        if (typeof event.data !== 'string') {
          parts.push(event.data);
          measure(job, base + event.data.byteLength);
          base += event.data.byteLength;
          if (parts.length % 64 === 0) emit();
          return;
        }

        var message;
        try { message = JSON.parse(event.data); } catch (err) { return; }

        if (message.finished !== undefined) {
          writing.then(function () { resolve(); }, reject);
          return;
        }
        if (message.chunk === undefined) return;

        // A whole chunk has arrived: store it, then tell the sender it is safe.
        var blob = new Blob(parts);
        parts = [];
        var index = message.chunk;
        writing = writing.then(function () {
          return job.sink.write(blob);
        }).then(function () {
          got = index + 1;
          measure(job, Math.min(Number(session.file_size), got * CHUNK));
          base = got * CHUNK;
          emit();
          channel.send(JSON.stringify({ ack: index }));
          return patchSession(job.id, { acked: got });
        }).then(function () {
          if (got >= total) resolve();
        });
        writing.catch(reject);
      };
    });
  }

  function receiveRelay(job, start) {
    var session = job.session;
    var total = Number(session.chunks) || 1;
    setPhase(job, 'receiving');

    return Sync.authorized().then(function (auth) {
      var step = function (index) {
        if (index >= total) return Promise.resolve();
        if (job.cancelled) return Promise.reject(new Error('cancelled'));

        var key = chunkKey(auth.userId, job.id, index);
        var attempt = function () {
          return readSession(job.id).then(function (row) {
            if (!row || row.state === 'cancelled') throw new Error('cancelled');
            if (Number(row.sent) <= index) return wait(900).then(attempt);
            return getChunk(key).catch(function () {
              return wait(900).then(attempt);
            });
          });
        };

        return attempt().then(function (blob) {
          if (!blob) return null;
          return job.sink.write(blob).then(function () {
            measure(job, Math.min(Number(session.file_size), (index + 1) * CHUNK));
            emit();
            return patchSession(job.id, { acked: index + 1 });
          });
        }).then(function () {
          return step(index + 1);
        });
      };
      return step(start);
    });
  }

  /* ---------------------------------------------------------------- tidying -- */

  function closeJob(job) {
    if (job.peer) { try { job.peer.close(); } catch (err) { /* gone */ } }
    job.peer = null;
    job.channel = null;
    emit();
  }

  function fail(job, err) {
    var message = (err && err.message) || 'Something went wrong.';
    if (/cancelled/i.test(message)) {
      setPhase(job, 'cancelled', '');
    } else {
      setPhase(job, 'failed', message);
      patchSession(job.id, { state: 'failed', error: message.slice(0, 200) }).catch(function () {});
    }
    closeJob(job);
  }

  function cancel(id) {
    var job = jobs[id];
    if (job) {
      job.cancelled = true;
      if (job.sink) job.sink.abort();
      closeJob(job);
      setPhase(job, 'cancelled', '');
    }
    return patchSession(id, { state: 'cancelled' })
      .then(function () { return clearSignals(id); })
      .catch(function () {});
  }

  // The Save button. Runs inside the tap, which is the whole point: iOS only
  // lets a page hand a file to the system while one is being processed.
  function save(id) {
    var job = jobs[id];
    if (!job || !job.sink || !job.sink.deliver) return Promise.resolve(null);
    return job.sink.deliver().then(function (result) {
      job.outcome = result.outcome;
      job.where = result.where || '';
      // Anything short of actually saved leaves the file here to try again.
      setPhase(job, result.outcome === 'shared' || result.outcome === 'downloaded'
        ? 'done' : 'held');
      return result.outcome;
    });
  }

  function dismiss(id) {
    delete jobs[id];
    emit();
  }

  /* --------------------------------------------------------------- polling -- */

  // Everything aimed at this device, and everything this device started.
  var incoming = [];

  function poll() {
    if (polling) return Promise.resolve();
    polling = true;
    var me = myId();

    return liveSessions().then(function (rows) {
      var mine = [];
      (rows || []).forEach(function (row) {
        var job = jobs[row.id];
        if (job) {
          job.session = Object.assign({}, job.session, row);
          // Both sides have said Ready: begin.
          if (!job.started && row.sender_ready && row.receiver_ready &&
              row.state !== 'done' && row.state !== 'cancelled') {
            job.started = true;
            if (job.role === 'send') runSend(job);
            else runReceive(job);
          }
          if (row.state === 'cancelled' && job.phase !== 'cancelled') {
            job.cancelled = true;
            if (job.sink) job.sink.abort();
            closeJob(job);
            setPhase(job, 'cancelled', '');
          }
          return;
        }
        if (row.to_device === me && row.state === 'offered') mine.push(row);
      });
      incoming = mine;
      emit();
    }).catch(function () {
      // Offline or not signed in; the next tick tries again.
    }).then(function () {
      polling = false;
      schedule(false);
    });
  }

  function busy() {
    return Object.keys(jobs).some(function (id) {
      var phase = jobs[id].phase;
      return phase !== 'done' && phase !== 'failed' && phase !== 'cancelled';
    }) || incoming.length > 0;
  }

  function schedule(immediate) {
    clearTimeout(pollTimer);
    if (immediate) {
      pollTimer = setTimeout(poll, 60);
      return;
    }
    pollTimer = setTimeout(poll, busy() ? BUSY_POLL : IDLE_POLL);
  }

  function init() {
    if (Sync.getStatus().state !== 'off') schedule(true);
    Sync.subscribe(function (status) {
      if (status.state !== 'off') schedule(true);
    });
  }

  return {
    CHUNK: CHUNK,
    init: init,
    offer: offer,
    ready: ready,
    accept: accept,
    save: save,
    cancel: cancel,
    dismiss: dismiss,
    roomFor: roomFor,
    chunkCount: chunkCount,
    refresh: function () { return poll(); },
    jobs: snapshot,
    incoming: function () { return incoming.slice(); },
    canStreamToDisk: function () { return typeof window.showSaveFilePicker === 'function'; },
    // A handle on the live data channel, so a test can sever the direct route
    // the way a dropped network would and watch it pick itself up.
    liveChannel: function () {
      var id = Object.keys(jobs).filter(function (key) { return jobs[key].channel; })[0];
      return id ? jobs[id].channel : null;
    },
    subscribe: function (fn) { listeners.push(fn); }
  };
})();
