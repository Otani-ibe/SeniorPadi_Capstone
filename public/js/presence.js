// keeps [data-presence] online/offline badges current and counts this person online while any page is open. If the connection fails the badges keep what the page loaded with
(function () {
  var csrf = document.currentScript && document.currentScript.getAttribute('data-csrf');
  if (typeof io === 'undefined' || !csrf) return;

  // the conversation page already opened a connection for live messages: share it
  var socket = window.spSocket || io({ auth: { csrf: csrf }, reconnectionAttempts: 5 });
  window.spSocket = socket; // public/js/call.js uses it too

  function paint(id, status) {
    document.querySelectorAll('[data-presence="' + id + '"]').forEach(function (el) {
      el.hidden = !status;
      el.setAttribute('data-status', status || '');
      var text = el.querySelector('[data-presence-text]');
      if (text && status) text.textContent = el.getAttribute(status === 'online' ? 'data-online' : 'data-offline');
    });
    document.dispatchEvent(new CustomEvent('sp:presence', { detail: { id: String(id), status: status || null } }));
  }

  function watch() {
    var ids = [];
    document.querySelectorAll('[data-presence]').forEach(function (el) {
      var id = el.getAttribute('data-presence');
      if (ids.indexOf(id) === -1) ids.push(id);
    });
    if (!ids.length) return;
    socket.emit('presence:watch', ids, function (statuses) {
      ids.forEach(function (id) { paint(id, statuses && statuses[id]); });
    });
  }

  socket.on('connect', watch);
  socket.on('presence:update', function (data) { paint(data.id, data.status); });
  if (socket.connected) watch();
})();
