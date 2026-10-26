// "Show password": ticking the box shows the password boxes in that form as plain text.
(function () {
  document.querySelectorAll('[data-show-password]').forEach(function (label) {
    var box = label.querySelector('input');
    var form = label.closest('form');
    label.hidden = false;
    box.addEventListener('change', function () {
      form.querySelectorAll('[data-password]').forEach(function (input) {
        input.type = box.checked ? 'text' : 'password';
      });
    });
  });
})();
