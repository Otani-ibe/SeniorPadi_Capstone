const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    fullName: { type: DataTypes.STRING, allowNull: false },
    phone: { type: DataTypes.STRING, allowNull: false, unique: true },
    email: { type: DataTypes.STRING, allowNull: true, unique: true },
    passwordHash: { type: DataTypes.STRING, allowNull: false },
    mustChangePassword: { type: DataTypes.BOOLEAN, defaultValue: false },
    ageDeclared: { type: DataTypes.BOOLEAN, defaultValue: false },
    preferredLanguage: { type: DataTypes.ENUM('en', 'yo'), defaultValue: 'en' },
    role: { type: DataTypes.ENUM('senior', 'admin'), defaultValue: 'senior' },
    verificationStatus: {
      type: DataTypes.ENUM('unverified', 'pending', 'approved', 'rejected', 'social_removed'),
      defaultValue: 'unverified'
    },
    verificationRejectionReason: DataTypes.TEXT,
    bio: DataTypes.TEXT,
    area: DataTypes.STRING,
    profilePictureUrl: DataTypes.STRING,
    profilePicturePublicId: DataTypes.STRING,
    idDocumentPublicId: DataTypes.STRING,
    idDocumentFormat: DataTypes.STRING,
    reminderDaysBefore: { type: DataTypes.INTEGER, defaultValue: 1 },
    onboardingSeenAt: DataTypes.DATE
  }, {
    paranoid: true // never hard delete users
  });

  // first name only, for friendly greetings
  User.prototype.firstName = function () {
    return this.fullName.split(' ')[0];
  };

  return User;
};
