// Admin lists: picking a category, LGA or status in the filter bar shows the results straight away.
// (Without JavaScript the Search button does the same.)
document.querySelectorAll('[data-filters] select').forEach(function (select) {
  select.addEventListener('change', function () { select.form.submit(); });
});
