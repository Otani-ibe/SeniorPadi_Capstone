// "23 slots left" follows what is really happening: every few seconds the numbers on the page are
// asked for again, so a new registration, or the admin raising or lowering the capacity, shows up
// without a reload. An event with no limit shows nothing.
(function () {
  var els = Array.prototype.slice.call(document.querySelectorAll('[data-slots-for]'));
  if (els.length === 0 || !window.fetch) return;

  var ids = [];
  els.forEach(function (el) {
    var id = el.getAttribute('data-slots-for');
    if (ids.indexOf(id) === -1) ids.push(id);
  });

  function paint(el, n) {
    if (n === null || n === undefined) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = n === 0 ? el.getAttribute('data-full')
      : n === 1 ? el.getAttribute('data-one')
      : el.getAttribute('data-many').replace('__N__', n);
    el.classList.toggle('text-full-tag', n <= 5);
    el.classList.toggle('text-leaf-dark', n > 5);
  }

  function refresh() {
    if (document.hidden) return; // nobody is looking
    fetch('/events/slots.json?ids=' + ids.join(','), { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (slots) {
        if (!slots) return;
        els.forEach(function (el) {
          var id = el.getAttribute('data-slots-for');
          if (Object.prototype.hasOwnProperty.call(slots, id)) paint(el, slots[id]);
        });
      })
      .catch(function () { /* try again next time */ });
  }

  setInterval(refresh, 10000);
  document.addEventListener('visibilitychange', refresh);
})();
