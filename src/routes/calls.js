// Voice calls: hands the browser the relay servers it needs. The call itself is set up over Socket.IO.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getIceServers } = require('../services/calls');

const router = express.Router();

router.get('/calls/ice', requireAuth, async (req, res) => {
  if (req.user.role !== 'senior' || req.user.verificationStatus !== 'approved') return res.status(403).json({ iceServers: [] });
  res.set('Cache-Control', 'no-store');
  res.json({ iceServers: await getIceServers() });
});

module.exports = router;
