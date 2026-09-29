// Scheduled jobs: reminder SMS every morning, and closing finished events.
const cron = require('node-cron');
const { Op } = require('sequelize');
const { Event, Registration, User } = require('../models');
const { notify } = require('./notify');
const { shortDate, formatTime, lagosDayString, TIME_ZONE, DAY_MS } = require('./dates');

// Sends a reminder to everyone whose reminder day is today
async function sendReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 4 * DAY_MS);

  const registrations = await Registration.findAll({
    where: { status: 'registered', reminderSentAt: null },
    include: [
      { model: Event, where: { status: 'published', startsAt: { [Op.gt]: now, [Op.lte]: soon } } },
      { model: User, as: 'senior' } // soft-deleted users are left out automatically
    ]
  });

  let sent = 0;
  for (const reg of registrations) {
    const senior = reg.senior;
    const reminderDay = lagosDayString(new Date(reg.Event.startsAt).getTime() - senior.reminderDaysBefore * DAY_MS);

    if (reminderDay === lagosDayString(now)) {
      notify(senior, 'event.reminder', {
        name: senior.firstName(),
        event: reg.Event.title,
        date: shortDate(reg.Event.startsAt),
        time: formatTime(reg.Event.startsAt),
        place: reg.Event.locationText
      }, ['sms']);
      await reg.update({ reminderSentAt: now });
      sent++;
    }
  }
  return sent;
}

// Marks events that have ended as completed
async function completeFinishedEvents(now = new Date()) {
  const [count] = await Event.update(
    { status: 'completed' },
    { where: { status: 'published', endsAt: { [Op.lt]: now } } }
  );
  return count;
}

// when each job last ran, shown on the admin System page
const lastRuns = { reminders: null, remindersSent: 0, completeEvents: null };

async function runReminders() {
  try {
    lastRuns.remindersSent = await sendReminders();
    lastRuns.reminders = new Date();
  } catch (err) {
    console.error('Reminder job failed:', err.message);
  }
}

async function runCompleteEvents() {
  try {
    await completeFinishedEvents();
    lastRuns.completeEvents = new Date();
  } catch (err) {
    console.error('Closing finished events failed:', err.message);
  }
}

function startJobs() {
  cron.schedule('0 8 * * *', runReminders, { timezone: TIME_ZONE });
  cron.schedule('0 * * * *', runCompleteEvents, { timezone: TIME_ZONE });
  runCompleteEvents(); // tidy up once on start too
}

module.exports = { sendReminders, completeFinishedEvents, startJobs, lastRuns };
