// Home page, WhatsApp button: common questions seniors have take turns, one every few seconds,
// with a soft fade. Tapping opens WhatsApp with the question that is showing.
// Stays on the first one for people who prefer less motion.
(function () {
  var link = document.querySelector('[data-wa]');
  if (!link) return;
  var text = link.querySelector('[data-wa-text]');
  var messages = JSON.parse(link.getAttribute('data-wa-messages'));
  var base = link.getAttribute('data-wa-base');
  if (!text || messages.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var current = 0;
  var paused = false;
  link.addEventListener('mouseenter', function () { paused = true; });
  link.addEventListener('mouseleave', function () { paused = false; });
  link.addEventListener('focusin', function () { paused = true; });
  link.addEventListener('focusout', function () { paused = false; });

  setInterval(function () {
    if (paused || document.hidden) return;
    current = (current + 1) % messages.length;
    text.style.opacity = '0';
    setTimeout(function () {
      text.textContent = messages[current];
      link.setAttribute('href', base + '?text=' + encodeURIComponent(messages[current]));
      text.style.opacity = '1';
    }, 300);
  }, 4000);
})();
