// Home page: the big photo in the middle of the circle spins round and lands on a new face,
// every few seconds. Stays still for people who prefer less motion, and when the tab is hidden.
// It never stays blank: it only swaps to a face that has finished loading, the swap happens when
// the turn ends (not on a timer the browser may slow down), and the photo is put back face-on
// whenever the tab is shown again.
(function () {
  var box = document.querySelector('[data-centre-pool]');
  if (!box || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var img = box.querySelector('img');
  var pool = JSON.parse(box.getAttribute('data-centre-pool'));
  if (!img || pool.length < 2) return;

  // load every face once and keep hold of them, so we can tell which ones are ready
  var faces = pool.map(function (src) { var f = new Image(); f.src = src; return f; });
  var ready = function (f) { return f.complete && f.naturalWidth > 0; };

  var current = Math.max(0, pool.indexOf(img.getAttribute('src')));
  var turning = false;
  var safety;

  function faceOn() {
    clearTimeout(safety);
    img.style.transition = 'transform 0.45s ease-out';
    img.style.transform = 'rotateY(0deg)';
    turning = false;
  }

  function swap(next) {
    if (!turning) return;
    current = next;
    img.setAttribute('src', pool[next]);
    faceOn();
  }

  setInterval(function () {
    if (document.hidden || turning) return;
    // the next face that has loaded (skip any that are slow or missing)
    var next = -1;
    for (var step = 1; step < pool.length; step++) {
      var i = (current + step) % pool.length;
      if (ready(faces[i])) { next = i; break; }
    }
    if (next < 0) return;

    turning = true;
    img.style.transition = 'transform 0.45s ease-in';
    img.style.transform = 'rotateY(90deg)'; // turn edge-on, swap the face while it can't be seen
    img.addEventListener('transitionend', function () { swap(next); }, { once: true });
    safety = setTimeout(function () { swap(next); }, 900); // in case the turn's end is never reported
  }, 5000);

  // back on the tab: never leave the photo edge-on
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && turning) swap(current);
  });
})();
