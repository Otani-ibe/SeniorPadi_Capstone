// Live chat on top of the normal form.
// If anything here fails, we do nothing and the form keeps working as usual.
(function () {
  var thread = document.getElementById('thread');
  var form = document.querySelector('form[data-chat-form]');
  if (!thread || !form || typeof io === 'undefined') return;

  var myId = Number(thread.getAttribute('data-me'));
  var otherId = Number(thread.getAttribute('data-other'));
  var textarea = form.querySelector('textarea');
  var csrf = form.querySelector('input[name="_csrf"]').value;
  var live = false;

  var socket = io({ auth: { csrf: csrf }, reconnectionAttempts: 5 });

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

  // build a message bubble. textContent keeps it safe from HTML in messages.
  function addMessage(msg) {
    if (document.getElementById('msg-' + msg.id)) return; // already shown
    var mine = msg.senderId === myId;

    var li = document.createElement('li');
    li.id = 'msg-' + msg.id;
    li.className = 'flex ' + (mine ? 'justify-end' : 'justify-start');

    var bubble = document.createElement('div');
    bubble.className = 'max-w-[85%] rounded-xl px-4 py-3 ' + (mine ? 'bg-indigo text-white' : 'bg-mist text-ink');

    var who = document.createElement('p');
    who.className = 'sr-only';
    who.textContent = mine ? thread.getAttribute('data-you') : thread.getAttribute('data-other-name') + ':';

    var body = document.createElement('p');
    body.className = 'whitespace-pre-line';
    body.textContent = msg.body;

    var when = document.createElement('p');
    when.className = 'mt-1 text-base ' + (mine ? 'text-white/80' : 'text-gray-700');
    when.textContent = thread.getAttribute('data-just-now');

    bubble.appendChild(who);
    bubble.appendChild(body);
    bubble.appendChild(when);
    li.appendChild(bubble);
    thread.appendChild(li);

    var empty = document.getElementById('thread-empty');
    if (empty) empty.remove();
    form.scrollIntoView({ block: 'end' });
  }

  socket.on('message:new', addMessage);

  form.addEventListener('submit', function (event) {
    if (!live || !socket.connected) return; // normal form post

    var text = textarea.value.trim();
    if (!text) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    socket.timeout(5000).emit('message:send', { recipientId: otherId, body: text }, function (err, reply) {
      if (!err && reply && reply.ok) {
        textarea.value = '';
        textarea.focus();
      } else {
        // let the server handle it the normal way (it shows the right message)
        live = false;
        form.submit();
      }
    });
  });
})();
