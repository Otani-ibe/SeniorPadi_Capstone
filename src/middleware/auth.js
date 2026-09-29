function requireAuth(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    req.flash('info', req.t('auth.login_first'));
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl; // e.g. staff scanning a QR code before logging in
    return res.redirect('/login');
  }
  if (req.user.role !== 'admin') {
    return res.status(403).render('error', { title: req.t('error.title'), message: req.t('error.not_allowed') });
  }
  next();
}

// After an admin resets a password, the senior has to pick a new one first
function requirePasswordChanged(req, res, next) {
  if (req.user && req.user.mustChangePassword && req.path !== '/change-password' && req.path !== '/logout') {
    return res.redirect('/change-password');
  }
  next();
}

// Find Seniors and messages are only for seniors whose ID was approved.
// Checked on the server every time, never trusted from the page.
function requireVerified(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'senior' || req.user.verificationStatus !== 'approved') {
    return res.redirect('/find-seniors');
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requirePasswordChanged, requireVerified };
