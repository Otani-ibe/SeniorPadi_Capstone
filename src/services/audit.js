const { AuditLog } = require('../models');

// writes one audit line, never throws
async function audit(actorId, action, entityType, entityId, metadata = {}) {
  try {
    await AuditLog.create({ actorId, action, entityType, entityId, metadata });
  } catch (err) {
    console.error('Could not write audit log:', err.message);
  }
}

module.exports = { audit };
