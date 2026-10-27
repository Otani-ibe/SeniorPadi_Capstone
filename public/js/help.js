// Help for visitors: the "Having trouble registering?" pop-up.
// It opens once a visitor has spent a while on the site (counted across pages) without signing up.
// Tapping around doesn't hold it back - that's what being stuck looks like - but it waits while
// someone is typing, so it never interrupts a form. At most once per visit.
(function () {
  var nudge = document.querySelector('[data-help-nudge]');
  if (!nudge) return;
  var SHOWN = 'sp-help-shown';
  var START = 'sp-visit-start';
  var TYPING_PAUSE = 15 * 1000; // quiet time after the last key before it may open

  function get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked: still fine */ } }

  var demo = /[?&]help=now\b/.test(location.search); // for demos: open after 2 seconds, every time
  if (get(SHOWN) && !demo) return;
  var wait = (demo ? 2 : Number(nudge.dataset.wait) || 90) * 1000;
  var start = demo ? Date.now() : Number(get(START)) || Date.now();
  if (!demo && !get(START)) set(START, String(start));

  var dialog = nudge.querySelector('[role=dialog]');
  var lastTyped = 0;
  var lastFocus;
  ['keydown', 'input'].forEach(function (a) {
    document.addEventListener(a, function () { lastTyped = Date.now(); }, true);
  });

  var clock = setInterval(function () {
    var now = Date.now();
    if (document.hidden || now - start < wait || now - lastTyped < TYPING_PAUSE) return;
    // another pop-up is open on screen: don't stack a second one on top
    // (pages keep some pop-ups hidden, ready to open; those don't count)
    var others = document.querySelectorAll('[role=dialog]');
    for (var i = 0; i < others.length; i++) {
      if (others[i] !== dialog && others[i].getClientRects().length) return;
    }
    clearInterval(clock);
    show();
  }, 1000);

  function show() {
    set(SHOWN, '1');
    lastFocus = document.activeElement;
    nudge.hidden = false;
    dialog.focus();
    document.addEventListener('keydown', onKey);
  }

  function hide() {
    nudge.hidden = true;
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKey(e) { if (e.key === 'Escape') hide(); }

  nudge.querySelectorAll('[data-help-close]').forEach(function (el) { el.addEventListener('click', hide); });
})();
