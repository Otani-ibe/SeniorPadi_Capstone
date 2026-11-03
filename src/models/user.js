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
      // 'approved' = verified by NIN (services/identity.js), 'pending' = check running, 'manual_review' = a person must look, 'not_eligible' = NIN shows under 50
      type: DataTypes.ENUM('unverified', 'pending', 'approved', 'rejected', 'social_removed', 'not_eligible', 'manual_review'),
      defaultValue: 'unverified'
    },
    verificationRejectionReason: DataTypes.TEXT,
    bio: DataTypes.TEXT,
    area: DataTypes.STRING,
    lga: DataTypes.STRING(40), // local government area, one of Event.AREAS
    gender: DataTypes.STRING(10), // 'female', 'male' or empty
    profilePictureUrl: DataTypes.STRING,
    profilePicturePublicId: DataTypes.STRING,
    reminderDaysBefore: { type: DataTypes.INTEGER, defaultValue: 2 },
    remindersEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    // the one staff account that may open a NIN (see services/identity.js). Other admins cannot.
    isSuperAdmin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    showOnlineStatus: { type: DataTypes.BOOLEAN, defaultValue: true },
    phoneVerifiedAt: DataTypes.DATE,
    emailVerifiedAt: DataTypes.DATE,
    onboardingSeenAt: DataTypes.DATE,
    createdByName: DataTypes.STRING, // set when a son or daughter signed this senior up
    createdByPhone: DataTypes.STRING,
    // where it is, in degrees. Both or neither. Found from the address by services/geocode.js
    latitude: { type: DataTypes.DOUBLE, validate: { min: -90, max: 90 } },
    longitude: { type: DataTypes.DOUBLE, validate: { min: -180, max: 180 } },
    geoSource: DataTypes.STRING(12), // 'geocoded', or 'area' = the middle of their local government area
    geocodedAt: DataTypes.DATE
  }, {
    validate: {
      coordinatesComplete() {
        if ((this.latitude == null) !== (this.longitude == null)) throw new Error('Latitude and longitude must be given together.');
      }
    },
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

  // first name only, for greetings
  // their photo, or an illustration of an older woman or man until they add one
  User.prototype.avatarUrl = function () {
    if (this.profilePictureUrl) return this.profilePictureUrl;
    if (this.gender === 'female') return '/images/senior-woman.svg';
    if (this.gender === 'male') return '/images/senior-man.svg';
    return '/images/senior-avatar.svg';
  };

  // the name we greet someone by. A title alone ("Mr", "Mama") is not enough so it keeps the next word: "Mr Kunle", "Mama Tolu", "Chief Samuel"
  const TITLES = ['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'chief', 'mama', 'baba', 'papa', 'pa', 'ma', 'iya', 'alhaji', 'alhaja',
    'pastor', 'rev', 'reverend', 'deacon', 'deaconess', 'elder', 'evangelist', 'engr', 'sir', 'lady', 'madam', 'oba', 'olori', 'otunba', 'chief.'];
  User.prototype.firstName = function () {
    const words = this.fullName.trim().split(/\s+/);
    const isTitle = TITLES.includes(words[0].toLowerCase().replace(/\.$/, ''));
    return isTitle && words.length > 1 ? words[0] + ' ' + words[1] : words[0];
  };

  return User;
};
