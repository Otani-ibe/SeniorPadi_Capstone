// keeps coordinates in step with the address words, wherever a record is saved (signup, settings, admin forms, scripts).
// address changes: old coordinates are cleared at once (they would be wrong) and a lookup is queued (services/geocode.js).
// `fields` = the columns that make up the address
module.exports = function installGeoHooks(model, kind, fields) {
  const addressChanged = (record) => fields.some((field) => record.changed(field));

  model.addHook('beforeSave', (record) => {
    // remembered now, clearing the numbers below would look like someone setting them
    record.coordinatesSetByHand = Boolean(record.changed('latitude') || record.changed('longitude'));
    if (!record.isNewRecord && addressChanged(record) && !record.coordinatesSetByHand) {
      record.latitude = null;
      record.longitude = null;
      record.geoSource = null;
      record.geocodedAt = null;
    }
  });

  model.addHook('afterSave', (record, options) => {
    if (!addressChanged(record) || record.coordinatesSetByHand) return;
    const start = () => require('../services/geocode').queue(kind, record.id);
    // inside a transaction the row is not visible to other connections until it is saved for good
    if (options && options.transaction) options.transaction.afterCommit(start);
    else start();
  });
};
