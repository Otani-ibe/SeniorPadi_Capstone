// The search box above the list of people: hides the rows that don't match what was typed.
(function () {
  // the chat fills what is left of the window under the site header, whatever the window or text size
  var shell = document.querySelector('.chat-shell');
  function fit() {
    if (!shell) return;
    var top = shell.getBoundingClientRect().top + window.scrollY;
    var cs = getComputedStyle(shell);
    var below = window.innerWidth >= 768 ? parseFloat(cs.marginBottom) || 0 : 0;
    var nav = document.querySelector('nav[aria-label="Main"].fixed');
    var bar = nav && nav.getClientRects().length ? nav.getBoundingClientRect().height : 0; // the bottom menu, when it is showing
    shell.style.height = Math.max(300, window.innerHeight - top - below - bar) + 'px';
  }
  if (shell) { fit(); window.addEventListener('resize', fit); window.addEventListener('load', fit); }

  var input = document.querySelector('[data-chat-search]');
  var list = document.querySelector('[data-chat-list]');
  if (!input || !list) return;
  var none = document.querySelector('[data-chat-no-results]');

  input.addEventListener('input', function () {
    var q = input.value.trim().toLowerCase();
    var shown = 0;
    list.querySelectorAll('[data-chat-name]').forEach(function (row) {
      var match = !q || row.getAttribute('data-chat-name').indexOf(q) !== -1;
      row.hidden = !match;
      if (match) shown++;
    });
    if (none) none.hidden = shown > 0 || !q;
  });
})();
