// Optional: changes the upload button text so people know something is happening.
// The form works the same without this file.
document.querySelectorAll('form[data-upload]').forEach(function (form) {
  form.addEventListener('submit', function () {
    var button = form.querySelector('[data-uploading-text]');
    if (button) {
      button.textContent = button.getAttribute('data-uploading-text');
      button.setAttribute('aria-disabled', 'true');
    }
  });
});
