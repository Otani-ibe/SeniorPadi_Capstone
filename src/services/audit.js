const { AuditLog } = require('../models');

// Writes one line to the audit log. Never throws, so it can't break a request.
async function audit(actorId, action, entityType, entityId, metadata = {}) {
  try {
    await AuditLog.create({ actorId, action, entityType, entityId, metadata });
  } catch (err) {
    console.error('Could not write audit log:', err.message);
  }
}

module.exports = { audit };
