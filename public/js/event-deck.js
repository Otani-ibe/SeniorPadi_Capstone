// Find events: a deck of cards, like a dating app.
// Skip (button, drag left or the left arrow key) throws the card away and the next one springs up.
// Register (button, drag right or the right arrow key) signs up, or opens the sign-up pop-up for guests.
// Skipped cards leave the deck. When none are left, a note offers the skipped ones.
// In the skipped-events deck (?skipped=1) they go to the back instead.
// Without JavaScript the buttons are plain forms and links, and the page reloads instead.
(function () {
  // picking an area shows its events straight away
  var areaForm = document.querySelector('[data-area-form]');
  if (areaForm) {
    areaForm.querySelector('select').addEventListener('change', function () { areaForm.submit(); });
  }

  var deck = document.querySelector('[data-deck]');
  if (!deck || !window.fetch || !Element.prototype.animate) return;

  var THRESHOLD = 110;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var status = document.querySelector('[data-deck-status]');
  var donePanel = document.querySelector('[data-deck-done]');
  var hint = document.querySelector('[data-deck-hint]');
  var seeSkipped = document.querySelector('[data-see-skipped]');
  var recycle = deck.hasAttribute('data-deck-skipped');
  var popup = document.querySelector('[data-login-popup]');
  var busy = false;

  function cards() {
    return Array.prototype.slice.call(deck.querySelectorAll('[data-deck-card]'));
  }
  function topCard() {
    return deck.querySelector('[data-deck-card]');
  }

  // the first card is on top, the next two peek out behind it, the rest wait out of sight
  function layout(except) {
    var i = 0;
    cards().forEach(function (card) {
      if (card === except) return;
      var pos = Math.min(i, 3);
      card.setAttribute('data-pos', pos);
      if (pos === 0) {
        card.removeAttribute('inert');
        card.tabIndex = 0;
      } else {
        card.setAttribute('inert', '');
        card.tabIndex = -1;
      }
      i++;
    });
  }

  function stamp(card, which, amount) {
    var el = card.querySelector('[data-stamp="' + which + '"]');
    if (el) el.style.opacity = amount;
  }

  function dragTransform(x) {
    return 'translateX(' + x + 'px) rotate(' + (x / 18) + 'deg)';
  }

  // after a skip: say what's on top now, and move focus with it if it was in the deck
  function announce(hadFocus) {
    var card = topCard();
    if (!card) {
      // nothing new left: offer the skipped ones
      // (style, not hidden: their display classes would win)
      deck.style.display = 'none';
      if (hint) hint.style.display = 'none';
      if (seeSkipped) seeSkipped.hidden = true; // the panel has its own button
      if (donePanel) {
        donePanel.hidden = false;
        donePanel.focus({ preventScroll: false });
      }
      return;
    }
    if (status) status.textContent = card.getAttribute('aria-label');
    if (hadFocus) card.focus({ preventScroll: true });
  }

  function skip(card, fromX) {
    if (busy) return;
    busy = true;
    var hadFocus = card.contains(document.activeElement);

    // remember the skip on the server, so a reload keeps the order
    var form = card.querySelector('[data-deck-skip]');
    fetch(form.action, {
      method: 'POST',
      body: new URLSearchParams(new FormData(form)),
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    }).catch(function () {});

    stamp(card, 'skip', 1);
    card.classList.add('flying');
    if (seeSkipped) seeSkipped.hidden = false;

    // a small wind-up the other way, then a fling off to the left
    var frames = fromX
      ? [{ transform: dragTransform(fromX) }, { transform: 'translate(-140vw, 80px) rotate(-45deg)', opacity: 0 }]
      : [
          { transform: 'none', easing: 'ease-out' },
          { transform: 'translateX(36px) rotate(5deg) scale(1.03)', offset: 0.2, easing: 'cubic-bezier(.6,0,.9,.4)' },
          { transform: 'translate(-140vw, 80px) rotate(-45deg)', opacity: 0 }
        ];
    var flight = card.animate(frames, { duration: reduceMotion ? 1 : (fromX ? 450 : 750), fill: 'forwards' });

    // the next card springs up while this one is still in the air
    setTimeout(function () { layout(card); }, reduceMotion ? 0 : (fromX ? 60 : 180));

    flight.onfinish = function () {
      if (!recycle) {
        card.remove();
        layout();
        busy = false;
        announce(hadFocus);
        return;
      }
      deck.appendChild(card); // to the back of the deck
      card.classList.remove('flying');
      card.style.transform = '';
      stamp(card, 'skip', 0);
      flight.cancel();
      layout();
      // if it's still showing (only a few events), fade it back in gently
      if (card.getAttribute('data-pos') !== '3' && !reduceMotion) {
        card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
      }
      busy = false;
      announce(hadFocus);
    };
  }

  function snapBack(card) {
    card.style.transform = '';
    stamp(card, 'skip', 0);
    stamp(card, 'register', 0);
  }

  function register(card, fromX) {
    var target = card.querySelector('[data-deck-register]');

    // guests sign up first
    if (target.tagName === 'A') {
      snapBack(card);
      openPopup(target.getAttribute('data-event-id'));
      return;
    }

    if (busy) return;
    busy = true;
    stamp(card, 'register', 1);
    card.classList.add('flying');
    var flight = card.animate([
      { transform: fromX ? dragTransform(fromX) : 'none' },
      { transform: 'translate(140vw, -40px) rotate(35deg)', opacity: 0 }
    ], { duration: reduceMotion ? 1 : 500, easing: 'cubic-bezier(.5,0,.9,.5)', fill: 'forwards' });
    flight.onfinish = function () { target.submit(); };
  }

  // ---------- buttons ----------
  deck.addEventListener('submit', function (e) {
    var card = e.target.closest('[data-deck-card]');
    if (card !== topCard()) return;
    e.preventDefault();
    if (e.target.matches('[data-deck-skip]')) skip(card);
    else register(card);
  });

  deck.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-deck-register]');
    if (!link) return;
    e.preventDefault();
    register(link.closest('[data-deck-card]'));
  });

  // ---------- keyboard ----------
  deck.addEventListener('keydown', function (e) {
    var card = topCard();
    if (!card || e.target !== card) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); skip(card); }
    if (e.key === 'ArrowRight') { e.preventDefault(); register(card); }
  });

  // ---------- dragging ----------
  var dragging = null;
  var startX = 0;
  var dx = 0;

  deck.addEventListener('pointerdown', function (e) {
    var card = e.target.closest('[data-deck-card]');
    if (busy || card !== topCard()) return;
    if (e.target.closest('a, button, input, select, textarea')) return; // taps still work normally
    dragging = card;
    startX = e.clientX;
    dx = 0;
    card.classList.add('dragging');
    card.setPointerCapture(e.pointerId);
  });

  deck.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    dx = e.clientX - startX;
    dragging.style.transform = dragTransform(dx);
    stamp(dragging, 'skip', dx < 0 ? Math.min(1, -dx / THRESHOLD) : 0);
    stamp(dragging, 'register', dx > 0 ? Math.min(1, dx / THRESHOLD) : 0);
  });

  function release() {
    if (!dragging) return;
    var card = dragging;
    dragging = null;
    card.classList.remove('dragging');
    if (dx < -THRESHOLD) return skip(card, dx);
    if (dx > THRESHOLD) return register(card, dx);
    snapBack(card); // not far enough: springs back to the middle
  }
  deck.addEventListener('pointerup', release);
  deck.addEventListener('pointercancel', release);

  // ---------- sign-up pop-up for guests ----------
  var lastFocus = null;

  function openPopup(eventId) {
    if (!popup) return;
    popup.querySelectorAll('input[name="registerEventId"]').forEach(function (input) { input.value = eventId; });
    var switchLink = popup.querySelector('[data-modal-switch]');
    if (switchLink) switchLink.href = switchLink.href.replace(/login=\d+/, 'login=' + eventId);
    lastFocus = document.activeElement;
    popup.hidden = false;
    var first = popup.querySelector('input:not([type="hidden"])');
    if (first) first.focus();
  }

  function closePopup() {
    if (!popup || popup.hidden) return;
    popup.hidden = true;
    if (lastFocus) lastFocus.focus();
  }

  if (popup) {
    var close = popup.querySelector('[data-modal-close]');
    if (close) close.addEventListener('click', function (e) { e.preventDefault(); closePopup(); });
    // tapping the dark area behind the pop-up closes it
    var backdrop = popup.firstElementChild;
    if (backdrop) backdrop.addEventListener('click', closePopup);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePopup();
    });
  }
})();
