// Home page, Find seniors card: the two square photos take turns changing to other seniors,
// one every few seconds, with a soft fade. Stays still for people who prefer less motion.
(function () {
  var box = document.querySelector('[data-face-pool]');
  if (!box || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var pool = JSON.parse(box.getAttribute('data-face-pool'));
  var slots = Array.prototype.slice.call(box.querySelectorAll('.face-slot img'));
  if (slots.length === 0 || pool.length <= slots.length) return;

  // load every picture once up front, so a swap never shows a half-loaded image
  pool.forEach(function (src) { new Image().src = src; });

  var turn = 0;
  function showing() {
    return slots.map(function (img) { return img.getAttribute('src'); });
  }

  function swapNext() {
    if (document.hidden) return; // don't change faces nobody is looking at
    var img = slots[turn % slots.length];
    turn++;
    var onScreen = showing();
    var choices = pool.filter(function (src) { return onScreen.indexOf(src) === -1; });
    var next = choices[Math.floor(Math.random() * choices.length)];

    img.style.transition = 'opacity 0.5s ease';
    img.style.opacity = '0';
    setTimeout(function () {
      img.setAttribute('src', next);
      img.style.opacity = '1';
    }, 500);
  }

  setInterval(swapNext, 3000);
})();
