// Stops things like /events/abc from reaching the database
function numericId(req, res, next, id) {
  if (/^\d+$/.test(id)) return next();
  res.status(404).render('error', { title: req.t('error.not_found_title'), message: req.t('error.not_found') });
}

module.exports = numericId;
