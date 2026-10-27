// The answer to a Came / Didn't come / Undo tap on an attendance list, for staff and for the host
// organization alike. The page asks in the background (X-Requested-With) and swaps in the updated row;
// without JavaScript the browser goes back to the list.
const { attendanceCounts } = require('../services/attendance');

function doorReply(req, res, { event, reg, back, door }) {
  if (!req.get('X-Requested-With')) return res.redirect(back);
  if (!reg) return res.status(404).json({ error: 'not found' });
  res.render('admin/attendanceRow', { reg, event, door, hasStarted: new Date(event.startsAt) <= new Date() }, async (err, html) => {
    if (err) return res.status(500).json({ error: 'render failed' });
    res.json({ html, status: reg.status, name: reg.senior ? reg.senior.fullName : 'Senior', counts: await attendanceCounts(event.id) });
  });
}

module.exports = { doorReply };
