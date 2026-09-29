// The welcome video, shown once after signing up. Always skippable,
// and the transcript is on the page in case the video won't load.
const express = require('express');
const { OnboardingVideo } = require('../models');
const cloud = require('../services/cloudinary');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function videoFor(lang) {
  return (await OnboardingVideo.findOne({ where: { language: lang } })) ||
    (await OnboardingVideo.findOne({ where: { language: 'en' } }));
}

router.get('/onboarding', requireAuth, async (req, res) => {
  if (req.user.role === 'admin') return res.redirect('/admin');

  const video = await videoFor(req.lang);
  const videoSrc = video && video.videoPublicId ? cloud.videoUrl(video.videoPublicId) : null;
  const transcript = (video && video.transcript) || req.t('onboarding.default_transcript');

  res.render('onboarding', {
    title: req.t('onboarding.title'),
    videoSrc,
    transcript,
    firstTime: !req.user.onboardingSeenAt
  });
});

router.post('/onboarding/done', requireAuth, async (req, res) => {
  if (!req.user.onboardingSeenAt) await req.user.update({ onboardingSeenAt: new Date() });
  res.redirect('/events');
});

module.exports = router;
