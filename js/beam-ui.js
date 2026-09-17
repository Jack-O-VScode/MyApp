/* The "Send to a device" half of the Transfer screen.

   Everything it knows comes from two places: Devices for who is awake, and Beam
   for what is in flight. It holds no state of its own beyond which device is
   selected.
*/
window.BeamView = (function () {
  'use strict';

  var els = {};
  var target = null;
  var hint = '';

  /* --------------------------------------------------------------- format -- */

  function size(bytes) {
    if (!bytes && bytes !== 0) return '';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var value = bytes;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return (unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)) + ' ' + units[unit];
  }

  function rate(bytesPerSecond) {
    if (!bytesPerSecond) return '';
    return size(bytesPerSecond) + '/s';
  }

  function remaining(job) {
    if (!job.rate || job.done >= job.total) return '';
    var seconds = (job.total - job.done) / job.rate;
    if (seconds < 60) return Math.max(1, Math.round(seconds)) + 's left';
    if (seconds < 3600) return Math.round(seconds / 60) + ' min left';
    return (seconds / 3600).toFixed(1) + ' hours left';
  }

  var ICONS = {
    iphone: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm3 17h4',
    ipad: 'M5 2h14a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6 17h2',
    windows: 'M3 6.5 10 5.5v6H3v-5Zm0 6.5h7v6l-7-1v-5Zm8-7.7L21 4v7.5h-10V5.3Zm0 7.7h10V20l-10-1.3V13Z',
    mac: 'M3 5h18v11H3zM8 20h8M12 16v4',
    linux: 'M3 5h18v11H3zM8 20h8M12 16v4',
    android: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm3 17h4',
    other: 'M3 5h18v11H3zM8 20h8M12 16v4'
  };

  function icon(platform) {
    var path = ICONS[platform] || ICONS.other;
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
  }

  /* -------------------------------------------------------------- devices -- */

  function renderDevices() {
    var me = Devices.me();
    els.me.textContent = me ? 'This is “' + me.name + '”' : '';

    var others = Devices.others();
    var awake = others.filter(Devices.isAwake);

    els.devices.innerHTML = '';
    awake.forEach(function (device) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'beam-device';
      button.dataset.device = device.id;
      button.setAttribute('role', 'radio');
      button.innerHTML = icon(device.platform) +
        '<span class="beam-device-name"></span><span class="beam-device-state">Awake</span>';
      button.querySelector('.beam-device-name').textContent = device.name;
      els.devices.appendChild(button);
    });

    if (target && !awake.some(function (d) { return d.id === target.id; })) target = null;
    if (!target && awake.length === 1) target = awake[0];

    Array.prototype.forEach.call(els.devices.children, function (button) {
      var on = !!target && button.dataset.device === target.id;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    });

    els.none.hidden = awake.length > 0;
    els.devices.hidden = awake.length === 0;
    els.pick.disabled = !target;
    els.hint.textContent = hint || (target
      ? 'Any size. ' + target.name + ' has to stay open until it finishes.'
      : '');
  }

  /* ----------------------------------------------------------------- jobs -- */

  function phaseLine(job) {
    switch (job.phase) {
      case 'offered': return 'Waiting for you and ' + job.peerName + ' to say Ready';
      case 'waiting': return 'Waiting for ' + job.peerName;
      case 'connecting': return 'Finding the quickest route…';
      case 'sending':
      case 'receiving':
        return [
          job.mode === 'direct' ? 'Direct' : 'Relayed',
          size(job.done) + ' of ' + size(job.total),
          rate(job.rate),
          remaining(job)
        ].filter(Boolean).join(' · ');
      case 'saving': return 'Finishing…';
      case 'held':
        // All here, nothing written anywhere yet — and saying so is the point.
        return job.outcome === 'cancelled'
          ? 'Not saved — tap Save and choose where to keep it'
          : (job.outcome === 'blocked'
            ? 'Your browser would not open the share sheet. Tap Save to try again.'
            : (job.outcome === 'lost'
              ? 'The file was let go before it could be saved. Send it again.'
              : 'Received as ' + (job.where || job.name) +
                ' — tap Save to keep it, or it is lost when you close the app'));
      case 'done':
        if (job.role === 'send') return 'Sent';
        // Naming it matters: the extension is what lets iOS offer Save Video,
        // and seeing it is how you know the file is what you think it is.
        if (job.outcome === 'shared') {
          return 'Handed to the share sheet' + (job.where ? ' as ' + job.where : '');
        }
        if (job.outcome === 'downloaded') {
          return 'Saved to your downloads' + (job.where ? ' as ' + job.where : '');
        }
        return job.where ? 'Saved as ' + job.where : 'Saved';
      case 'cancelled': return 'Cancelled';
      case 'failed': return job.error || 'Failed';
      default: return '';
    }
  }

  function jobCard(job) {
    var row = document.createElement('div');
    row.className = 'beam-job';
    row.dataset.phase = job.phase;

    var head = document.createElement('div');
    head.className = 'beam-job-head';
    var name = document.createElement('strong');
    name.textContent = job.name;
    var who = document.createElement('span');
    who.className = 'beam-job-who';
    who.textContent = (job.role === 'send' ? 'to ' : 'from ') + job.peerName +
      ' · ' + size(job.size);
    head.appendChild(name);
    head.appendChild(who);

    var line = document.createElement('p');
    line.className = 'beam-job-line';
    line.textContent = phaseLine(job);
    if (job.resumed) line.textContent += ' · resumed';

    row.appendChild(head);
    row.appendChild(line);

    // The same short hash of the same bytes on both devices. If they match, the
    // file that arrived is the file that was sent, and anything still wrong with
    // it was wrong before it left.
    if (job.fingerprint) {
      var mark = document.createElement('p');
      mark.className = 'beam-job-mark';
      mark.textContent = 'Fingerprint ' + job.fingerprint +
        ' — should match the other device';
      row.appendChild(mark);
    }

    if (job.phase === 'sending' || job.phase === 'receiving') {
      var bar = document.createElement('div');
      bar.className = 'progress';
      var fill = document.createElement('span');
      fill.style.width = Math.round(job.progress * 100) + '%';
      bar.appendChild(fill);
      row.appendChild(bar);
    }

    var actions = document.createElement('div');
    actions.className = 'beam-job-actions';

    if (job.phase === 'offered' && job.role === 'send') {
      var readyButton = document.createElement('button');
      readyButton.className = 'button primary small';
      readyButton.type = 'button';
      readyButton.dataset.ready = job.id;
      readyButton.textContent = 'Ready';
      actions.appendChild(readyButton);
    }
    if (job.phase === 'held') {
      var saveButton = document.createElement('button');
      saveButton.className = 'button primary small';
      saveButton.type = 'button';
      saveButton.dataset.save = job.id;
      saveButton.textContent = 'Save';
      actions.appendChild(saveButton);
    }
    if (['done', 'cancelled', 'failed', 'held'].indexOf(job.phase) !== -1) {
      var clear = document.createElement('button');
      clear.className = 'button small';
      clear.type = 'button';
      clear.dataset.dismiss = job.id;
      clear.textContent = job.phase === 'held' ? 'Discard' : 'Clear';
      actions.appendChild(clear);
    } else {
      var stop = document.createElement('button');
      stop.className = 'button small danger';
      stop.type = 'button';
      stop.dataset.cancel = job.id;
      stop.textContent = 'Cancel';
      actions.appendChild(stop);
    }
    row.appendChild(actions);
    return row;
  }

  function offerCard(session) {
    var row = document.createElement('div');
    row.className = 'beam-job is-offer';

    var head = document.createElement('div');
    head.className = 'beam-job-head';
    var name = document.createElement('strong');
    name.textContent = session.file_name;
    var who = document.createElement('span');
    who.className = 'beam-job-who';
    who.textContent = 'from ' + (session.from_name || 'another device') +
      ' · ' + size(Number(session.file_size));
    head.appendChild(name);
    head.appendChild(who);

    var line = document.createElement('p');
    line.className = 'beam-job-line';
    line.textContent = Beam.canStreamToDisk()
      ? 'Accept and choose where to save it. It is written straight to disk as it arrives.'
      : 'Accept to collect it here, then save it when it finishes.';

    var actions = document.createElement('div');
    actions.className = 'beam-job-actions';
    var accept = document.createElement('button');
    accept.className = 'button primary small';
    accept.type = 'button';
    accept.dataset.accept = session.id;
    accept.textContent = 'Ready';
    var decline = document.createElement('button');
    decline.className = 'button small danger';
    decline.type = 'button';
    decline.dataset.cancel = session.id;
    decline.textContent = 'Decline';
    actions.appendChild(accept);
    actions.appendChild(decline);

    row.appendChild(head);
    row.appendChild(line);
    row.appendChild(actions);
    return row;
  }

  function renderJobs() {
    var incoming = Beam.incoming();
    els.incoming.innerHTML = '';
    incoming.forEach(function (session) { els.incoming.appendChild(offerCard(session)); });

    var list = Beam.jobs();
    els.jobs.innerHTML = '';
    list.forEach(function (job) { els.jobs.appendChild(jobCard(job)); });
  }

  /* ---------------------------------------------------------------- wiring -- */

  function chooseFile(file) {
    if (!file || !target) return;
    hint = '';
    Beam.offer(file, target).then(function () {
      hint = 'Offered to ' + target.name + '. Say Ready on both to start.';
      render();
    }).catch(function (err) {
      hint = err.message;
      render();
    });
  }

  function init() {
    els.me = document.getElementById('beam-me');
    els.devices = document.getElementById('beam-devices');
    els.none = document.getElementById('beam-none');
    els.pick = document.getElementById('beam-pick');
    els.file = document.getElementById('beam-file');
    els.hint = document.getElementById('beam-hint');
    els.incoming = document.getElementById('beam-incoming');
    els.jobs = document.getElementById('beam-jobs');

    els.devices.addEventListener('click', function (clickEvent) {
      var button = clickEvent.target.closest('.beam-device');
      if (!button) return;
      target = Devices.others().filter(function (device) {
        return device.id === button.dataset.device;
      })[0] || null;
      render();
    });

    els.pick.addEventListener('click', function () { els.file.click(); });
    els.file.addEventListener('change', function () {
      if (this.files && this.files[0]) chooseFile(this.files[0]);
      this.value = '';
    });

    var onAction = function (clickEvent) {
      var button = clickEvent.target.closest('button');
      if (!button) return;
      if (button.dataset.ready) Beam.ready(button.dataset.ready);
      // Straight through, no awaiting anything first: the browser only allows a
      // file to be handed over while this tap is still being handled.
      if (button.dataset.save) Beam.save(button.dataset.save);
      if (button.dataset.cancel) Beam.cancel(button.dataset.cancel);
      if (button.dataset.dismiss) Beam.dismiss(button.dataset.dismiss);
      if (button.dataset.accept) {
        var session = Beam.incoming().filter(function (row) {
          return row.id === button.dataset.accept;
        })[0];
        if (!session) return;
        Beam.roomFor(Number(session.file_size)).then(function (fits) {
          if (!fits && !window.confirm(
            'This device may not have room for ' + size(Number(session.file_size)) +
            '. Accept anyway?')) return;
          return Beam.accept(session).catch(function (err) {
            if (err && err.name === 'AbortError') return;
            hint = err.message;
            render();
          });
        });
      }
    };
    els.jobs.addEventListener('click', onAction);
    els.incoming.addEventListener('click', onAction);

    Devices.subscribe(render);
    Beam.subscribe(render);
  }

  function render() {
    if (!els.devices) return;
    renderDevices();
    renderJobs();
  }

  return { init: init, render: render };
})();
