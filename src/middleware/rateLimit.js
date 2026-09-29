const rateLimit = require('express-rate-limit');

function limiter(max, minutes) {
  return rateLimit({
    windowMs: minutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (req, res) => {
      res.status(429).render('error', { title: req.t('error.title'), message: req.t('error.too_many') });
    }
  });
}

module.exports = {
  loginLimiter: limiter(10, 15),
  signupLimiter: limiter(5, 60),
  resetLimiter: limiter(5, 60),
  uploadLimiter: limiter(20, 60),
  messageLimiter: limiter(60, 10)
};
