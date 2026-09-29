// Starts SeniorPadi. Does all the setup on its own:
// checks settings, waits for the database, runs any new migrations,
// adds default content and the first admin, then opens the website.
const startup = require('./services/startup');

const startedAt = new Date();

async function start() {
  console.log('\nStarting SeniorPadi...');

  const warnings = startup.prepareEnvironment();

  // these read the settings, so they're loaded after prepareEnvironment
  const http = require('http');
  const models = require('./models');
  const { ensureDatabase } = require('./services/migrate');

  await startup.waitForDatabase(models.sequelize);
  startup.line('Database connected (' + models.sequelize.config.host + ')');

  const { ran, repaired } = await ensureDatabase(models.sequelize);
  startup.line(ran.length ? 'Database updated: ' + ran.length + ' change(s) applied' : 'Database already up to date');
  if (repaired.length) startup.line('Recreated missing tables: ' + repaired.join(', '));

  const added = await startup.ensureDefaultContent(models);
  if (added) startup.line('Added the default welcome guide text');

  const admin = await startup.ensureFirstAdmin(models);
  if (admin === 'created') startup.line('Created the first admin account (' + process.env.ADMIN_PHONE + ')');
  if (admin === 'promoted') startup.line('Made ' + process.env.ADMIN_PHONE + ' an admin');
  if (admin === 'missing') {
    warnings.push('There is no admin account yet. Set ADMIN_NAME, ADMIN_PHONE and ADMIN_PASSWORD (8+ characters), then restart.');
  }

  const css = startup.ensureCss();
  if (css === 'built') startup.line('Built the stylesheet');
  if (css === 'failed') warnings.push('The stylesheet is missing and could not be built. Pages will look unstyled.');

  const app = require('./app');
  const setupSockets = require('./sockets');
  const { startJobs } = require('./services/cron');

  app.set('startedAt', startedAt);
  app.set('startupWarnings', warnings);

  const server = http.createServer(app);
  const io = setupSockets(server);
  app.set('io', io); // so the normal form can push messages live too

  startJobs();

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    for (const warning of warnings) console.log('  ! ' + warning);
    console.log('SeniorPadi is running at ' + process.env.APP_URL + '\n');
  });
}

start().catch((err) => {
  console.error('\nSeniorPadi could not start.\n  ' + err.message + '\n');
  process.exit(1);
});
