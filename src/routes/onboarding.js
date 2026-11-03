// the welcome video was retired, old links go to Find events
const express = require('express');

const router = express.Router();

router.get('/onboarding', (req, res) => res.redirect('/events'));

module.exports = router;
