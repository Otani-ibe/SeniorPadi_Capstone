// There used to be a welcome video here. It was retired; old links and bookmarks go to Find events.
const express = require('express');

const router = express.Router();

router.get('/onboarding', (req, res) => res.redirect('/events'));

module.exports = router;
