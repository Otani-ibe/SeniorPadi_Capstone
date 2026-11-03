// notices ("Saved", "Declined. Kehinde won't see your number.") fade away after a few seconds
(function () {
  document.querySelectorAll('[data-flash]').forEach(function (box) {
    var seconds = Number(box.getAttribute('data-seconds')) || 5;
    setTimeout(function () {
      box.style.opacity = '0';
      box.style.maxHeight = box.offsetHeight + 'px';
      // the space closes up after the fade, so the page doesn't jump while it is fading
      setTimeout(function () { box.style.maxHeight = '0'; box.style.margin = '0'; box.style.padding = '0'; }, 450);
      setTimeout(function () { box.remove(); }, 1000);
    }, seconds * 1000);
  });
})();
