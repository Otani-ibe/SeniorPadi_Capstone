const { Sequelize } = require('sequelize');
const env = process.env.NODE_ENV || 'development';
const config = require('../config/config')[env];

const sequelize = new Sequelize(config.url, config);

const User = require('./user')(sequelize);
const Organization = require('./organization')(sequelize);
const Event = require('./event')(sequelize);
const Registration = require('./registration')(sequelize);
const EventInterest = require('./eventInterest')(sequelize);
const PasswordReset = require('./passwordReset')(sequelize);
const AuditLog = require('./auditLog')(sequelize);
const Message = require('./message')(sequelize);
const Skip = require('./skip')(sequelize);
const Block = require('./block')(sequelize);
const Report = require('./report')(sequelize);
const ReportHide = require('./reportHide')(sequelize);
const Notification = require('./notification')(sequelize);
const OnboardingVideo = require('./onboardingVideo')(sequelize);

// associations
Organization.hasMany(Event, { foreignKey: 'organizationId' });
Event.belongsTo(Organization, { foreignKey: 'organizationId' });

Event.hasMany(Registration, { foreignKey: 'eventId' });
Registration.belongsTo(Event, { foreignKey: 'eventId' });

User.hasMany(Registration, { foreignKey: 'seniorId' });
Registration.belongsTo(User, { foreignKey: 'seniorId', as: 'senior' });

User.hasMany(EventInterest, { foreignKey: 'seniorId' });
EventInterest.belongsTo(User, { foreignKey: 'seniorId', as: 'senior' });

User.hasMany(PasswordReset, { foreignKey: 'userId' });
PasswordReset.belongsTo(User, { foreignKey: 'userId' });

Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });
Message.belongsTo(User, { foreignKey: 'recipientId', as: 'recipient' });

Report.belongsTo(User, { foreignKey: 'reporterId', as: 'reporter' });
Report.belongsTo(User, { foreignKey: 'reportedId', as: 'reported' });

Notification.belongsTo(User, { foreignKey: 'userId' });

module.exports = {
  sequelize,
  Sequelize,
  User,
  Organization,
  Event,
  Registration,
  EventInterest,
  PasswordReset,
  AuditLog,
  Message,
  Skip,
  Block,
  Report,
  ReportHide,
  Notification,
  OnboardingVideo
};
