// NIN box: numbers only, 11 maximum. Letters are dropped as typed, a pasted number with spaces or dashes (701 2345 6789) is cleaned first so no digit is lost to the limit
(function () {
  var box = document.querySelector('[data-nin]');
  if (!box) return;
  var counter = document.querySelector('[data-nin-count]');
  var template = box.getAttribute('data-count-text') || '{n} of 11';

  function clean(text) { return String(text).replace(/\D/g, '').slice(0, 11); }
  function show() {
    if (counter) counter.textContent = box.value.length > 0 ? '(' + template.replace('{n}', box.value.length) + ')' : '';
  }

  box.addEventListener('input', function () {
    var cleaned = clean(box.value);
    if (cleaned !== box.value) box.value = cleaned;
    show();
  });

  box.addEventListener('paste', function (event) {
    var text = (event.clipboardData || window.clipboardData).getData('text');
    event.preventDefault();
    var start = box.selectionStart, end = box.selectionEnd;
    box.value = clean(box.value.slice(0, start) + clean(text) + box.value.slice(end));
    show();
  });
  show();
})();
