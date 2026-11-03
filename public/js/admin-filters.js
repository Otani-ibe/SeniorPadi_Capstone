// Admin lists: picking a category, LGA or status shows results at once (without JavaScript the Search button does the same)
document.querySelectorAll('[data-filters] select').forEach(function (select) {
  select.addEventListener('change', function () { select.form.submit(); });
});
