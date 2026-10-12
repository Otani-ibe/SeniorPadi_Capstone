// Swipe cards, like a dating app: drag right to say yes, left to skip.
// The buttons on the card still work on their own, so this is only an extra.
(function () {
  var THRESHOLD = 110;

  document.querySelectorAll('[data-swipe-card]').forEach(function (card) {
    var leftTarget = document.getElementById(card.getAttribute('data-left'));
    var rightTarget = document.getElementById(card.getAttribute('data-right'));
    var leftBadge = card.querySelector('[data-badge="left"]');
    var rightBadge = card.querySelector('[data-badge="right"]');
    var startX = 0;
    var dx = 0;
    var dragging = false;
    var done = false;

    // fly the card off screen, then do what the button would have done
    function go(direction) {
      if (done) return;
      done = true;
      var target = direction === 'right' ? rightTarget : leftTarget;
      card.style.transform = 'translateX(' + (direction === 'right' ? 150 : -150) + 'vw) rotate(' + (direction === 'right' ? 24 : -24) + 'deg)';
      card.style.opacity = '0';
      setTimeout(function () {
        if (!target) return;
        if (target.tagName === 'FORM') target.submit();
        else window.location.href = target.getAttribute('href');
      }, 280);
    }

    function setBadges(amount) {
      if (leftBadge) leftBadge.style.opacity = amount < 0 ? Math.min(1, -amount / THRESHOLD) : 0;
      if (rightBadge) rightBadge.style.opacity = amount > 0 ? Math.min(1, amount / THRESHOLD) : 0;
    }

    card.addEventListener('pointerdown', function (e) {
      // let people tap links and buttons normally
      if (e.target.closest('a, button, input')) return;
      dragging = true;
      startX = e.clientX;
      dx = 0;
      card.classList.add('dragging');
      card.setPointerCapture(e.pointerId);
    });

    card.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      dx = e.clientX - startX;
      card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 18) + 'deg)';
      setBadges(dx);
    });

    function release() {
      if (!dragging) return;
      dragging = false;
      card.classList.remove('dragging');
      if (dx > THRESHOLD) return go('right');
      if (dx < -THRESHOLD) return go('left');
      card.style.transform = '';
      setBadges(0);
    }
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', release);

    // keyboard: left and right arrows
    card.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') go('left');
      if (e.key === 'ArrowRight') go('right');
    });

    // pressing the buttons also slides the card away
    [leftTarget, rightTarget].forEach(function (target, i) {
      if (!target || target.tagName !== 'FORM') return;
      target.addEventListener('submit', function (e) {
        if (done) return;
        e.preventDefault();
        go(i === 0 ? 'left' : 'right');
      });
    });
  });
})();
