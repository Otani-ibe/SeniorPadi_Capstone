const { DataTypes } = require('sequelize');

const CATEGORIES = ['fitness', 'faith', 'learning', 'skills', 'social', 'health', 'charity', 'creativity'];

// Font Awesome icon for each category
const CATEGORY_ICONS = {
  fitness: 'fa-person-walking',
  faith: 'fa-hands-praying',
  learning: 'fa-book-open-reader',
  skills: 'fa-scissors',
  social: 'fa-people-group',
  health: 'fa-heart-pulse',
  charity: 'fa-hand-holding-heart',
  creativity: 'fa-palette'
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
    createdByAdminId: DataTypes.INTEGER
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
