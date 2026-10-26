// Home page: the quotes about growing older take turns, one every 8 seconds.
// The box smoothly grows or shrinks to fit each quote, so short quotes don't leave a gap.
// Stops while someone is reading it with the mouse over it or keyboard focus on it.
(function () {
  var box = document.querySelector('[data-quotes]');
  if (!box) return;
  var items = Array.prototype.slice.call(box.querySelectorAll('.quote-item'));
  if (items.length < 2) return;

  var current = 0;
  var paused = false;
  box.addEventListener('mouseenter', function () { paused = true; });
  box.addEventListener('mouseleave', function () { paused = false; });
  box.addEventListener('focusin', function () { paused = true; });
  box.addEventListener('focusout', function () { paused = false; });

  function show(next) {
    box.style.height = box.offsetHeight + 'px'; // hold the old height for a moment
    items[current].classList.remove('is-active');
    items[current].setAttribute('aria-hidden', 'true');
    items[next].classList.add('is-active');
    items[next].removeAttribute('aria-hidden');
    current = next;
    // then ease to the new quote's height
    requestAnimationFrame(function () { box.style.height = items[current].offsetHeight + 'px'; });
  }

  setInterval(function () {
    if (paused || document.hidden) return;
    show((current + 1) % items.length);
  }, 8000);

  // if the screen is resized or rotated, let the box size itself again
  window.addEventListener('resize', function () { box.style.height = ''; });
})();
