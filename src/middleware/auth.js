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

// superadmin only, the one staff account that may open a NIN. Use after requireAdmin
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || !req.user.isSuperAdmin) {
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

// Find Seniors, profiles, messages and calls are only for seniors verified by NIN (services/identity.js).
// checked on the server every time, anyone else is sent to the verification page
function requireVerified(req, res, next) {
  if (!req.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.user.role === 'admin') return res.redirect('/admin');
  if (req.user.verificationStatus !== 'approved') {
    if (req.user.verificationStatus === 'social_removed') return res.redirect('/find-seniors'); // told why, there
    return res.redirect('/identity');
  }
  next();
}

module.exports = { requireAuth, requireAdmin, requireSuperAdmin, requirePasswordChanged, requireVerified };
