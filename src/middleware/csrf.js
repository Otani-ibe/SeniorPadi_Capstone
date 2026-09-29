const { csrfSync } = require('csrf-sync');

const { csrfSynchronisedProtection, generateToken } = csrfSync({
  // normal forms send it in the body, file upload forms send it in the URL
  // (multer hasn't read the body yet when this check runs)
  getTokenFromRequest: (req) => (req.body && req.body._csrf) || req.query._csrf || req.headers['x-csrf-token']
});

function addCsrfToken(req, res, next) {
  res.locals.csrfToken = generateToken(req);
  next();
}

module.exports = { csrfProtection: csrfSynchronisedProtection, addCsrfToken };
