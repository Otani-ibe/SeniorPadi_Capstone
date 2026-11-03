// Live chat on top of the normal form: messages appear without reloading.
// If anything here fails, we do nothing and the form keeps working as usual.
(function () {
  var thread = document.getElementById('thread');
  var form = document.querySelector('form[data-chat-form]');
  if (!thread || !form || typeof io === 'undefined') return;

  var scroller = document.getElementById('thread-scroll');
  var myId = Number(thread.getAttribute('data-me'));
  var otherId = Number(thread.getAttribute('data-other'));
  var otherName = thread.getAttribute('data-other-name');
  var textarea = form.querySelector('textarea');
  var csrf = form.querySelector('input[name="_csrf"]').value;
  var live = false;

  // ---------- keep the newest message in view ----------
  function toBottom() { if (scroller) scroller.scrollTop = scroller.scrollHeight; }
  toBottom();
  // photos and videos change the height when they finish loading
  if (scroller) scroller.addEventListener('load', toBottom, true);
  window.addEventListener('resize', toBottom);

  var socket = io({ auth: { csrf: csrf }, reconnectionAttempts: 5 });
  window.spSocket = socket; // public/js/presence.js and call.js reuse this connection

  // give up quietly if we can't connect within 3 seconds
  var giveUp = setTimeout(function () {
    if (!live) {
      socket.close();
      document.body.classList.add('chat-offline');
    }
  }, 3000);

  socket.on('connect', function () {
    socket.emit('chat:join', { withId: otherId }, function (reply) {
      if (reply && reply.ok) {
        live = true;
        clearTimeout(giveUp);
        document.body.classList.add('chat-live');
      } else {
        socket.close();
      }
    });
  });

  socket.on('connect_error', function () {
    if (!live) socket.close();
  });

  // ---------- building a message ----------
  function addMessage(msg) {
    if (document.getElementById('msg-' + msg.id)) return; // already shown
    var mine = msg.senderId === myId;

    var li = document.createElement('li');
    li.id = 'msg-' + msg.id;

    // an answered call: who called and for how long, a line in the middle
    if (msg.kind === 'call') {
      li.className = 'flex justify-center py-1';
      var line = document.createElement('p');
      line.className = 'inline-flex flex-wrap items-center justify-center gap-x-2 rounded-full bg-white px-4 py-2 text-[0.95rem] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200';
      var lineIcon = document.createElement('i');
      lineIcon.className = (mine ? 'icon-phone-outgoing' : 'icon-phone-incoming') + ' text-[1.1rem] text-indigo';
      lineIcon.setAttribute('aria-hidden', 'true');
      var who = document.createElement('span');
      who.textContent = thread.getAttribute(mine ? 'data-call-you' : 'data-call-them');
      var secs = Math.max(0, Math.round(Number(msg.body) || 0));
      var unit = secs >= 3600 ? 'hour' : secs >= 60 ? 'min' : 'sec';
      var length = document.createElement('span');
      length.className = 'font-bold text-ink';
      length.textContent = thread.getAttribute('data-len-' + unit)
        .replace('{h}', Math.floor(secs / 3600))
        .replace('{m}', unit === 'hour' ? Math.floor((secs % 3600) / 60) : Math.floor(secs / 60))
        .replace('{s}', unit === 'sec' ? secs : secs % 60);
      line.appendChild(lineIcon); line.appendChild(who); line.appendChild(length);
      li.appendChild(line);
      thread.appendChild(li);
      toBottom();
      return;
    }

    // a call that rang out: a line in the middle, not a bubble
    if (msg.kind === 'missed_call') {
      li.className = 'flex justify-center py-1';
      var note = document.createElement('p');
      note.className = 'inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-[0.95rem] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200';
      var noteIcon = document.createElement('i');
      noteIcon.className = 'icon-phone-missed text-[1.1rem] text-full-tag';
      noteIcon.setAttribute('aria-hidden', 'true');
      var noteText = document.createElement('span');
      noteText.textContent = thread.getAttribute(mine ? 'data-call-unanswered' : 'data-call-missed');
      note.appendChild(noteIcon);
      note.appendChild(noteText);
      li.appendChild(note);
      thread.appendChild(li);
      toBottom();
      return;
    }
    li.className = 'flex ' + (mine ? 'justify-end' : 'justify-start');

    var bubble = document.createElement('div');
    bubble.className = mine ? 'bubble bubble-mine' : 'bubble bubble-theirs';

    var who = document.createElement('p');
    who.className = 'sr-only';
    who.textContent = mine ? thread.getAttribute('data-you') : otherName + ':';
    bubble.appendChild(who);

    var body = document.createElement('p');
    body.className = 'whitespace-pre-line';
    body.textContent = msg.body;
    bubble.appendChild(body);

    var when = document.createElement('p');
    when.className = 'bubble-time';
    var time = document.createElement('span');
    time.textContent = thread.getAttribute('data-just-now');
    when.appendChild(time);
    bubble.appendChild(when);

    // my newest message shows Sent or Read; the one before it stops showing it
    if (mine) {
      var old = thread.querySelector('[data-read-status]');
      if (old) old.remove();
      var status = document.createElement('span');
      status.className = 'font-semibold';
      status.setAttribute('data-read-status', '');
      when.appendChild(status);
      showStatus(status, msg.read);
    }
    li.appendChild(bubble);
    thread.appendChild(li);

    var empty = document.getElementById('thread-empty');
    if (empty) empty.remove();
    toBottom();
  }

  // "✓ Sent" or "✓✓ Read", the same as views/partials/readStatus.ejs
  function showStatus(el, read) {
    el.textContent = '';
    var icon = document.createElement('i');
    icon.className = '' + (read ? 'icon-check-check' : 'icon-check') + ' mr-1';
    icon.setAttribute('aria-hidden', 'true');
    el.appendChild(icon);
    el.appendChild(document.createTextNode(thread.getAttribute(read ? 'data-read' : 'data-sent')));
  }

  socket.on('message:new', addMessage);
  // a line made by this page itself (a missed call to someone offline): shown at once, and never twice
  document.addEventListener('sp:message', function (e) { addMessage(e.detail); });

  // they opened the conversation: my newest message is now read
  socket.on('messages:read', function (data) {
    if (!data || data.readerId !== otherId) return;
    var status = thread.querySelector('[data-read-status]');
    if (status) showStatus(status, true);
  });

  // ---------- sending ----------
  form.addEventListener('submit', function (event) {
    if (!live || !socket.connected) return; // normal form post

    var text = textarea.value.trim();
    event.preventDefault();
    if (!text) return;

    socket.timeout(5000).emit('message:send', { recipientId: otherId, body: text }, function (err, reply) {
      if (!err && reply && reply.ok) {
        textarea.value = '';
        textarea.dispatchEvent(new Event('input')); // the box shrinks back to one line
        textarea.focus();
      } else {
        // let the server handle it the normal way (it shows the right message)
        live = false;
        form.submit();
      }
    });
  });
})();
