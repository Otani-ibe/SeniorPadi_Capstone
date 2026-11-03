// db side of Recommended for you: reads what a senior did, returns plain objects for recommendationScoring.js. Queries only
const { Op } = require('sequelize');
const { Registration, Event, EventInterest, Attendance } = require('../models');

const EMPTY = { history: [], interests: [], views: [] };

// -> { history, interests, views } as described in recommendationScoring.analyseProfile
async function loadProfile(user) {
  if (!user) return EMPTY;

  const [registrations, attendances, interests] = await Promise.all([
    // cancelled bookings say nothing about taste
    Registration.findAll({
      where: { seniorId: user.id, type: 'attendee', status: { [Op.in]: ['registered', 'attended', 'no_show'] } },
      include: [{ model: Event, attributes: ['id', 'category', 'organizationId', 'startsAt'] }]
    }),
    Attendance.findAll({
      where: { seniorId: user.id },
      include: [{ model: Event, attributes: ['id', 'category', 'organizationId', 'startsAt'] }]
    }),
    EventInterest.findAll({ where: { seniorId: user.id }, attributes: ['category', 'sourceEventId'] })
  ]);

  const toItem = (event, status) => ({
    eventId: event.id, category: event.category, organizationId: event.organizationId, startsAt: event.startsAt, status
  });
  const history = registrations.filter((r) => r.Event).map((r) => toItem(r.Event, r.status));
  // a check-in always counts as attended
  for (const a of attendances) if (a.Event) history.push(toItem(a.Event, 'attended'));

  return {
    history,
    interests: interests.map((i) => ({ category: i.category, sourceEventId: i.sourceEventId })),
    views: [] // page views not recorded yet
  };
}

module.exports = { loadProfile };
