const { DataTypes } = require('sequelize');

// one welcome video per language, uploaded by an admin
module.exports = (sequelize) => {
  return sequelize.define('OnboardingVideo', {
    language: { type: DataTypes.ENUM('en', 'yo'), allowNull: false, unique: true },
    videoUrl: DataTypes.STRING,
    videoPublicId: DataTypes.STRING,
    transcript: { type: DataTypes.TEXT, allowNull: false },
    uploadedByAdminId: DataTypes.INTEGER
  });
};
