const { DataTypes } = require('sequelize');

const CATEGORIES = ['fitness', 'faith', 'learning', 'skills', 'social', 'health'];

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
    category: { type: DataTypes.ENUM(...CATEGORIES), allowNull: false },
    organizationId: { type: DataTypes.INTEGER, allowNull: false },
    capacity: { type: DataTypes.INTEGER, allowNull: false },
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
  return Event;
};
