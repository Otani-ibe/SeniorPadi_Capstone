// Keeps the dashboard numbers up to date without reloading the page.
(function () {
  var REFRESH_MS = 20000;

  function update(data) {
    Object.keys(data.totals).forEach(function (key) {
      var el = document.querySelector('[data-stat="' + key + '"]');
      if (el && el.textContent !== String(data.totals[key])) {
        el.textContent = data.totals[key];
        el.classList.add('text-coral');
        setTimeout(function () { el.classList.remove('text-coral'); }, 1200);
      }
    });

    var rate = data.totals.attendanceRate;
    var ring = document.getElementById('rate-ring');
    var rateLabel = document.querySelector('[data-stat="attendanceRate-label"]');
    if (ring) ring.style.background = 'conic-gradient(var(--color-mint) ' + rate + '%, #eef2fa 0)';
    if (rateLabel) rateLabel.textContent = rate + '%';

    var max = Math.max.apply(null, [1].concat(data.days.map(function (d) { return d.total; })));
    data.days.forEach(function (d) {
      var bar = document.querySelector('[data-day-bar="' + d.key + '"]');
      var label = document.querySelector('[data-day-total="' + d.key + '"]');
      if (bar) bar.style.height = Math.max(4, Math.round((d.total / max) * 100)) + '%';
      if (label) label.textContent = d.total || '';
    });

    var stamp = document.getElementById('stats-updated');
    if (stamp) stamp.textContent = 'Updated ' + new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function refresh() {
    fetch('/admin/stats.json', { credentials: 'same-origin' })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) { if (data) update(data); })
      .catch(function () { /* try again next time */ });
  }

  setInterval(refresh, REFRESH_MS);
})();
