const { DataTypes } = require('sequelize');

const STATUSES = ['submitted', 'verified', 'not_eligible', 'rejected'];

// one row per NIN a senior sent. Waits here encrypted until the superadmin checks it on NIMC, erased the moment they decide
// (the database refuses to keep it longer). See docs/nin-verification.md
module.exports = (sequelize) => {
  const IdentityVerification = sequelize.define('IdentityVerification', {
    userId: { type: DataTypes.INTEGER, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'submitted', validate: { isIn: [STATUSES] } },
    encryptedNin: DataTypes.TEXT, // only while status is 'submitted'
    ninHash: DataTypes.STRING(64), // a keyed hash, so one NIN cannot be verified on two accounts; kept only for 'verified'
    decisionNote: DataTypes.STRING(300), // the reason, when it was turned down
    consentAt: { type: DataTypes.DATE, allowNull: false },
    submittedAt: { type: DataTypes.DATE, allowNull: false },
    completedAt: DataTypes.DATE,
    reviewedByAdminId: DataTypes.INTEGER,
    reviewedAt: DataTypes.DATE
  }, {
    indexes: [
      { fields: ['userId', 'createdAt'] },
      { fields: ['status'] },
      { unique: true, fields: ['ninHash'], where: { status: 'verified' }, name: 'identity_verifications_verified_nin_unique' }
    ]
  });

  IdentityVerification.STATUSES = STATUSES;
  return IdentityVerification;
};
