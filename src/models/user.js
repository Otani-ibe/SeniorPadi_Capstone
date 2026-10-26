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
    lga: DataTypes.STRING(40), // local government area, one of Event.AREAS
    gender: DataTypes.STRING(10), // 'female', 'male' or empty
    profilePictureUrl: DataTypes.STRING,
    profilePicturePublicId: DataTypes.STRING,
    idDocumentPublicId: DataTypes.STRING,
    idDocumentFormat: DataTypes.STRING,
    reminderDaysBefore: { type: DataTypes.INTEGER, defaultValue: 2 },
    remindersEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    phoneVerifiedAt: DataTypes.DATE,
    emailVerifiedAt: DataTypes.DATE,
    onboardingSeenAt: DataTypes.DATE
  }, {
    paranoid: true // never hard delete users
  });

  // phone confirmed, and email confirmed too if they gave one
  User.prototype.contactVerified = function () {
    return Boolean(this.phoneVerifiedAt) && (!this.email || Boolean(this.emailVerifiedAt));
  };

  // 08031234567 instead of +2348031234567
  User.prototype.localPhone = function () {
    return this.phone ? '0' + this.phone.replace('+234', '') : '';
  };

  // first name only, for friendly greetings
  // their photo, or an illustration of an older woman or man until they add one
  User.prototype.avatarUrl = function () {
    if (this.profilePictureUrl) return this.profilePictureUrl;
    if (this.gender === 'female') return '/images/senior-woman.svg';
    if (this.gender === 'male') return '/images/senior-man.svg';
    return '/images/senior-avatar.svg';
  };

  User.prototype.firstName = function () {
    return this.fullName.split(' ')[0];
  };

  return User;
};
