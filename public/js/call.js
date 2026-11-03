// Voice calls. Audio is WebRTC, phone to phone, this starts and answers calls over the live connection (src/sockets/calls.js).
// no microphone or no live connection: the Call button never appears
(function () {
  var ui = document.querySelector('[data-call-ui]');
  var socket = window.spSocket;
  if (!ui) return;
  // old browser or non-https page (the microphone needs it): the button explains instead of doing nothing
  if (!socket || !window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.querySelectorAll('[data-call-to]').forEach(function (b) {
      b.addEventListener('click', function () { alert(ui.getAttribute('data-text-unsupported')); });
    });
    return;
  }

  var incomingBox = ui.querySelector('[data-call-incoming]');
  var incomingText = ui.querySelector('[data-call-incoming-text]');
  var screen = ui.querySelector('[data-call-screen]');
  var nameEl = ui.querySelector('[data-call-name]');
  var picEl = ui.querySelector('[data-call-pic]');
  var incomingPic = ui.querySelector('[data-call-incoming-pic]');
  var statusEl = ui.querySelector('[data-call-status]');
  var audio = ui.querySelector('[data-call-audio]');
  var muteBtn = ui.querySelector('[data-call-mute]');
  var T = function (k, name) { return (ui.getAttribute('data-text-' + k) || '').replace('__NAME__', name || ''); };

  var call = null; // { id, otherName, role, pc, stream, pendingIce, timerId, started }
  var ring = null; // the ringtone while a call is coming in
  var lastFocus = null;

  // ---------- Call buttons: always shown; greyed out while that person is offline ----------
  function markButtons(id, online) {
    document.querySelectorAll('[data-call-to="' + id + '"]').forEach(function (b) { b.setAttribute('data-online', online ? 'true' : 'false'); });
  }
  document.addEventListener('sp:presence', function (e) { markButtons(e.detail.id, e.detail.status === 'online'); });
  document.querySelectorAll('[data-call-to]').forEach(function (b) {
    b.addEventListener('click', function () {
      var name = b.getAttribute('data-call-name');
      var avatar = b.getAttribute('data-call-avatar');
      // offline: say so right away, without asking for the microphone
      if (b.getAttribute('data-online') === 'false') {
        if (call) return;
        var toId = Number(b.getAttribute('data-call-to'));
        showScreen(name, T('offline', name), avatar);
        // the server is told too, so a missed call waits in the chat (it replies "offline" and writes the line)
        socket.emit('call:invite', { toId: toId }, function (reply) {
          // the missed call goes into the open chat at once
          if (reply && reply.line) document.dispatchEvent(new CustomEvent('sp:message', { detail: reply.line }));
          // they had in fact just come online: make it a real call instead
          if (reply && reply.ok) {
            socket.emit('call:end', { callId: reply.callId });
            hideScreen();
            startCall(toId, name, avatar);
          }
        });
        setTimeout(function () { if (!call) hideScreen(); }, 2500);
        return;
      }
      startCall(Number(b.getAttribute('data-call-to')), name, avatar);
    });
  });

  // ---------- small helpers ----------
  function setStatus(text) { statusEl.textContent = text; }

  function showScreen(name, status, avatar) {
    lastFocus = lastFocus || document.activeElement;
    nameEl.textContent = name;
    if (avatar) picEl.src = avatar;
    setStatus(status);
    screen.hidden = false;
    document.body.style.overflow = 'hidden';
    ui.querySelector('[data-call-hangup]').focus();
  }

  function hideScreen() {
    screen.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }

  // a simple two-tone phone ring, and a buzz on phones that can
  function startRing() {
    stopRing();
    try { if (navigator.vibrate) navigator.vibrate([400, 300, 400, 1200]); } catch (e) { /* not available */ }
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      var ctx = new Ctx();
      var beat = function () {
        [0, 0.45].forEach(function (offset) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.frequency.value = 440 + (offset ? 40 : 0);
          gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
          gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.05);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.35);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(ctx.currentTime + offset); osc.stop(ctx.currentTime + offset + 0.4);
        });
      };
      beat();
      ring = { ctx: ctx, id: setInterval(function () { beat(); try { if (navigator.vibrate) navigator.vibrate([400, 300, 400]); } catch (e) {} }, 2500) };
    } catch (e) { ring = null; }
  }

  function stopRing() {
    try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) {}
    if (ring) { clearInterval(ring.id); try { ring.ctx.close(); } catch (e) {} ring = null; }
  }

  function getMic() {
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  }

  function formatTime(ms) {
    var s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }

  // closes the call on this phone and shows why for a moment
  function cleanup(message) {
    stopRing();
    incomingBox.hidden = true;
    if (!call) return;
    var old = call;
    call = null;
    clearInterval(old.timerId);
    if (old.pc) { try { old.pc.close(); } catch (e) {} }
    if (old.stream) old.stream.getTracks().forEach(function (t) { t.stop(); });
    audio.srcObject = null;
    muteBtn.setAttribute('aria-pressed', 'false');
    ui.querySelector('[data-call-mute-text]').textContent = T('mute');
    if (message && !screen.hidden) {
      setStatus(message);
      setTimeout(function () { if (!call) hideScreen(); }, 2500);
    } else {
      hideScreen();
    }
  }

  // ---------- the audio connection ----------
  function makePeer(c) {
    return fetch('/calls/ice', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : { iceServers: [] }; })
      .catch(function () { return { iceServers: [] }; })
      .then(function (data) {
        var pc = new RTCPeerConnection({ iceServers: data.iceServers && data.iceServers.length ? data.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }] });
        c.pc = pc;
        c.pendingIce = [];
        c.stream.getTracks().forEach(function (t) { pc.addTrack(t, c.stream); });
        pc.onicecandidate = function (e) {
          if (e.candidate) socket.emit('call:signal', { callId: c.id, data: { candidate: e.candidate } });
        };
        pc.ontrack = function (e) { audio.srcObject = e.streams[0]; audio.play().catch(function () {}); };
        pc.onconnectionstatechange = function () {
          if (call !== c) return;
          if (pc.connectionState === 'connected' && !c.started) {
            c.started = Date.now();
            setStatus(T('connected') + ' 00:00');
            c.timerId = setInterval(function () { setStatus(T('connected') + ' ' + formatTime(Date.now() - c.started)); }, 1000);
          }
          if (pc.connectionState === 'failed') {
            socket.emit('call:end', { callId: c.id });
            cleanup(T('failed'));
          }
        };
        return pc;
      });
  }

  function addIce(c, candidate) {
    if (!c.pc) return;
    if (c.pc.remoteDescription) c.pc.addIceCandidate(candidate).catch(function () {});
    else c.pendingIce.push(candidate);
  }

  function flushIce(c) {
    c.pendingIce.splice(0).forEach(function (cand) { c.pc.addIceCandidate(cand).catch(function () {}); });
  }

  // ---------- calling someone ----------
  function startCall(toId, name, avatar) {
    if (call) return;
    getMic().then(function (stream) {
      call = { id: null, otherName: name, avatar: avatar, role: 'caller', stream: stream, started: 0 };
      var mine = call;
      showScreen(name, T('calling', name), avatar);
      socket.emit('call:invite', { toId: toId }, function (reply) {
        if (call !== mine) return;
        if (!reply || !reply.ok) {
          var why = reply && reply.reason;
          if (reply && reply.line) document.dispatchEvent(new CustomEvent('sp:message', { detail: reply.line }));
          cleanup(why === 'offline' ? T('offline', name) : why === 'busy' ? T('busy', name) : T('unavailable'));
          return;
        }
        mine.id = reply.callId;
      });
    }).catch(function () {
      alert(T('no-mic'));
    });
  }

  // they picked up: we make the offer
  socket.on('call:accepted', function (data) {
    var c = call;
    if (!c || c.role !== 'caller' || c.id !== data.callId) return;
    setStatus(T('connecting'));
    makePeer(c).then(function (pc) {
      return pc.createOffer().then(function (offer) {
        return pc.setLocalDescription(offer).then(function () {
          socket.emit('call:signal', { callId: c.id, data: { sdp: pc.localDescription } });
        });
      });
    }).catch(function () { socket.emit('call:end', { callId: c.id }); cleanup(T('failed')); });
  });

  // ---------- being called ----------
  var incoming = null; // { id, name }

  socket.on('call:incoming', function (data) {
    // already busy: the server won't send this, but never ring twice
    if (call || incoming) return;
    incoming = { id: data.callId, name: data.from.name, fromId: data.from.id, avatar: data.from.avatar };
    if (data.from.avatar) incomingPic.src = data.from.avatar;
    incomingText.textContent = T('incoming', data.from.name);
    lastFocus = document.activeElement;
    incomingBox.hidden = false;
    incomingBox.querySelector('[role=alertdialog]').focus();
    startRing();
  });

  function closeIncoming() {
    stopRing();
    incomingBox.hidden = true;
    incoming = null;
    if (screen.hidden && lastFocus && lastFocus.focus) { lastFocus.focus(); lastFocus = null; }
  }

  ui.querySelector('[data-call-decline]').addEventListener('click', function () {
    if (!incoming) return;
    socket.emit('call:decline', { callId: incoming.id });
    closeIncoming();
  });

  ui.querySelector('[data-call-answer]').addEventListener('click', function () {
    if (!incoming) return;
    var info = incoming;
    stopRing();
    getMic().then(function (stream) {
      call = { id: info.id, otherName: info.name, avatar: info.avatar, role: 'callee', stream: stream, started: 0 };
      var mine = call;
      incomingBox.hidden = true;
      incoming = null;
      showScreen(info.name, T('connecting'), info.avatar);
      return makePeer(mine).then(function () {
        socket.emit('call:accept', { callId: info.id }, function (reply) {
          if (!reply || !reply.ok) cleanup(T('ended'));
        });
      });
    }).catch(function () {
      socket.emit('call:decline', { callId: info.id });
      closeIncoming();
      alert(T('no-mic'));
    });
  });

  // ---------- messages between the two phones ----------
  socket.on('call:signal', function (msg) {
    var c = call;
    if (!c || c.id !== msg.callId || !c.pc) return;
    var d = msg.data || {};
    if (d.sdp && d.sdp.type === 'offer') {
      c.pc.setRemoteDescription(d.sdp)
        .then(function () { flushIce(c); return c.pc.createAnswer(); })
        .then(function (answer) { return c.pc.setLocalDescription(answer).then(function () { socket.emit('call:signal', { callId: c.id, data: { sdp: c.pc.localDescription } }); }); })
        .catch(function () { socket.emit('call:end', { callId: c.id }); cleanup(T('failed')); });
    } else if (d.sdp && d.sdp.type === 'answer') {
      c.pc.setRemoteDescription(d.sdp).then(function () { flushIce(c); }).catch(function () {});
    } else if (d.candidate) {
      addIce(c, d.candidate);
    }
  });

  // ---------- the call ended ----------
  socket.on('call:ended', function (data) {
    if (incoming && incoming.id === data.callId) {
      closeIncoming(); // a call nobody answered is written into the chat by the server
      return;
    }
    if (!call || (call.id && call.id !== data.callId)) return;
    var n = call.otherName;
    var message = data.reason === 'declined' ? T('declined', n)
      : data.reason === 'missed' ? T('missed', n)
      : data.reason === 'dropped' ? T('dropped')
      : data.reason === 'answered_elsewhere' ? '' : T('ended');
    cleanup(message || null);
  });

  // if the live connection is lost during a call, say so (the other person's side ends it)
  socket.on('disconnect', function () { if (call) cleanup(T('dropped')); closeIncoming(); });

  // ---------- buttons on the call screen ----------
  ui.querySelector('[data-call-hangup]').addEventListener('click', function () {
    if (!call) { hideScreen(); return; }
    if (call.id) socket.emit('call:end', { callId: call.id });
    cleanup(null);
  });

  muteBtn.addEventListener('click', function () {
    if (!call || !call.stream) return;
    var muted = muteBtn.getAttribute('aria-pressed') !== 'true';
    call.stream.getAudioTracks().forEach(function (t) { t.enabled = !muted; });
    muteBtn.setAttribute('aria-pressed', String(muted));
    ui.querySelector('[data-call-mute-text]').textContent = muted ? T('unmute') : T('mute');
    ui.querySelector('[data-call-mute-icon]').className = muted ? 'icon-mic-off' : 'icon-mic';
  });

  // typing a number into the page when a call comes in: Escape never closes a call by accident
  window.addEventListener('beforeunload', function () { if (call && call.id) socket.emit('call:end', { callId: call.id }); });
})();
