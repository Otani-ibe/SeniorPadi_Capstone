const { DataTypes } = require('sequelize');

// Saved Google Translate results, so the same text is only paid for once.
module.exports = (sequelize) => {
  return sequelize.define('Translation', {
    sourceHash: { type: DataTypes.STRING(64), allowNull: false },
    targetLang: { type: DataTypes.STRING(8), allowNull: false },
    sourceText: { type: DataTypes.TEXT, allowNull: false },
    translatedText: { type: DataTypes.TEXT, allowNull: false }
  }, {
    updatedAt: false,
    indexes: [{ unique: true, fields: ['sourceHash', 'targetLang'] }]
  });
};
