// Attendance page at the door: type to find someone, tap Came, and the list and the count update
// without reloading. Enter checks in the one person who matches; otherwise the box sends the
// ticket number to the server, as it does without JavaScript.
(function () {
  var list = document.querySelector('[data-door-list]');
  var search = document.querySelector('[data-door-search]');
  if (!list || !search) return;
  var input = search.querySelector('input[type=search]');
  var empty = document.querySelector('[data-door-empty]');
  var said = document.querySelector('[data-door-said]');
  var filter = 'all';

  function rows() { return Array.prototype.slice.call(list.querySelectorAll('[data-row]')); }

  function visibleRows() { return rows().filter(function (r) { return !r.hidden; }); }

  function apply() {
    var q = input.value.trim().toLowerCase();
    rows().forEach(function (r) {
      var matches = !q || r.dataset.search.indexOf(q) !== -1;
      r.hidden = !(matches && (filter === 'all' || r.dataset.status === filter));
    });
    empty.classList.toggle('hidden', visibleRows().length > 0);
  }

  function say(text) { said.textContent = ''; setTimeout(function () { said.textContent = text; }, 50); }

  function setCounts(c) {
    Object.keys(c).forEach(function (k) {
      var el = document.querySelector('[data-count="' + k + '"]');
      if (el) el.textContent = c[k];
    });
    var bar = document.querySelector('[data-count-bar]');
    if (bar) bar.style.width = (c.total ? Math.round((c.came / c.total) * 100) : 0) + '%';
  }

  // a Came / Didn't come / Undo tap
  list.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-door-form]');
    if (!form) return;
    e.preventDefault();
    var button = form.querySelector('button');
    button.disabled = true;
    button.classList.add('opacity-60');
    fetch(form.action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'fetch', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)).toString()
    })
      .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then(function (data) {
        var row = form.closest('[data-row]');
        var wrap = document.createElement('ul');
        wrap.innerHTML = data.html.trim();
        var fresh = wrap.firstElementChild;
        row.replaceWith(fresh);
        setCounts(data.counts);
        say(data.name + (data.status === 'attended' ? ' checked in.' : data.status === 'no_show' ? " marked as didn't come." : ' set back to not marked.'));
        // ready for the next person
        if (data.status === 'attended' && input.value) { input.value = ''; input.focus(); }
        apply();
      })
      .catch(function () { form.submit(); }); // fall back to the normal form
  });

  input.addEventListener('input', apply);

  search.addEventListener('submit', function (e) {
    var shown = visibleRows();
    if (shown.length !== 1 || !input.value.trim()) return; // let the server look up the ticket
    var came = shown[0].querySelector('[data-door-form] input[name=status][value=attended]');
    e.preventDefault();
    if (came) came.form.requestSubmit ? came.form.requestSubmit() : came.form.querySelector('button').click();
    else say(shown[0].dataset.name + ' is already checked in.');
  });

  search.querySelectorAll('[data-door-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.dataset.doorFilter;
      search.querySelectorAll('[data-door-filter]').forEach(function (o) { o.setAttribute('aria-pressed', String(o === b)); });
      apply();
    });
  });
})();
