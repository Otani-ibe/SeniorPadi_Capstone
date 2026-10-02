// Phone number boxes: numbers only, exactly 11 digits.
// Shows a red message straight away if something is wrong.
// The server checks again, so this is only here to help people as they type.
(function () {
  var PATTERN = /^0(70|71|80|81|90|91)\d{8}$/;

  document.querySelectorAll('input[data-phone]').forEach(function (input) {
    var error = document.getElementById(input.id + '-error');
    var form = input.form;
    if (!error) return;
    if (form) form.noValidate = true; // we show our own, clearer messages

    function show(message) {
      error.textContent = message;
      error.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.classList.remove('phone-shake');
      void input.offsetWidth; // restart the shake
      input.classList.add('phone-shake');
    }

    function clear() {
      error.textContent = '';
      error.hidden = true;
      input.removeAttribute('aria-invalid');
    }

    // full check: used when they leave the box or press the button
    function check() {
      var value = input.value;
      if (value.length === 0) { show(input.getAttribute('data-msg-empty')); return false; }
      if (value.length < 11) { show(input.getAttribute('data-msg-short')); return false; }
      if (!PATTERN.test(value)) { show(input.getAttribute('data-msg-start')); return false; }
      clear();
      return true;
    }

    input.addEventListener('input', function () {
      var cleaned = input.value.replace(/\D/g, '');

      // they typed a letter or symbol: remove it and say so
      if (cleaned !== input.value) {
        input.value = cleaned.slice(0, 11);
        show(input.getAttribute('data-msg-letters'));
        return;
      }
      // more than 11 digits (e.g. pasted)
      if (cleaned.length > 11) {
        input.value = cleaned.slice(0, 11);
        show(input.getAttribute('data-msg-long'));
        return;
      }
      // hide the message once it's complete and valid
      if (cleaned.length === 11 && PATTERN.test(cleaned)) clear();
      else if (!error.hidden && error.textContent === input.getAttribute('data-msg-letters')) clear();
    });

    input.addEventListener('blur', function () {
      if (input.value.length > 0) check();
    });

    if (form) {
      form.addEventListener('submit', function (event) {
        if (!check()) {
          event.preventDefault();
          input.focus();
        }
      });
    }
  });
})();