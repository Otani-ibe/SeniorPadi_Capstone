const { DataTypes } = require('sequelize');

const CATEGORIES = ['fitness', 'faith', 'learning', 'skills', 'social', 'health', 'charity', 'creativity'];

// line icon for each category (Lucide icon font)
const CATEGORY_ICONS = {
  fitness: 'icon-footprints',
  faith: 'icon-church',
  learning: 'icon-book-open',
  skills: 'icon-scissors',
  social: 'icon-users-round',
  health: 'icon-heart-pulse',
  charity: 'icon-hand-heart',
  creativity: 'icon-palette'
};

// the 11 local government areas of Ibadan. Names are in locales as "area.<key>".
const AREAS = [
  'akinyele', 'egbeda', 'ido', 'ibadan-north', 'ibadan-north-east', 'ibadan-north-west',
  'ibadan-south-east', 'ibadan-south-west', 'lagelu', 'oluyole', 'ona-ara'
];

module.exports = (sequelize) => {
  const Event = sequelize.define('Event', {
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false },
    imageUrl: DataTypes.STRING,
    imagePublicId: DataTypes.STRING,
    imageAlt: DataTypes.TEXT, // what the picture shows, read out by screen readers; empty = "Flyer for {title}"
    startsAt: { type: DataTypes.DATE, allowNull: false },
    endsAt: { type: DataTypes.DATE, allowNull: false },
    locationText: { type: DataTypes.STRING, allowNull: false },
    locationMapsUrl: DataTypes.STRING,
    area: DataTypes.STRING(40), // one of AREAS, or empty if the venue isn't confirmed yet
    category: { type: DataTypes.ENUM(...CATEGORIES), allowNull: false },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    capacity: DataTypes.INTEGER, // empty means no limit, and no "slots left" is shown
    price: DataTypes.INTEGER, // naira; empty means it costs nothing
    volunteerEnabled: { type: DataTypes.BOOLEAN, defaultValue: false },
    volunteerCapacity: DataTypes.INTEGER,
    hostedBySenior: { type: DataTypes.BOOLEAN, defaultValue: false },
    registrationDeadline: { type: DataTypes.DATE, allowNull: false },
    status: {
      type: DataTypes.ENUM('published', 'cancelled', 'completed'),
      defaultValue: 'published'
    },
    createdByAdminId: DataTypes.INTEGER,
    checkinToken: { type: DataTypes.STRING(64), unique: true }, // the host organization's check-in link; empty = none
    checkinTokenAt: DataTypes.DATE
  }, {
    indexes: [{ fields: ['startsAt', 'status'] }]
  });

  Event.CATEGORIES = CATEGORIES;
  Event.CATEGORY_ICONS = CATEGORY_ICONS;
  Event.AREAS = AREAS;

  // "₦2,500" for a paid event, or '' when it costs nothing
  Event.prototype.priceLabel = function () {
    return this.price > 0 ? '₦' + Number(this.price).toLocaleString('en-NG') : '';
  };
  return Event;
};
