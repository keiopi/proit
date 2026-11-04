import { createPgDb, runMigrations } from './db/db';
import { isSeeded, seed } from './db/seed';
import { createApp } from './app';
import { applyRiskExpiry } from './repos/risk';
import { runReminderSweep } from './repos/notifications';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. This app runs on Railway with its PostgreSQL database.');
  process.exit(1);
}

const db = createPgDb(url);
const applied = await runMigrations(db);
if (applied.length) console.log('Migrations applied:', applied.join(', '));
if (!(await isSeeded(db))) {
  await seed(db);
  console.log('Demo data seeded.');
}

const hourly = async () => {
  try {
    await applyRiskExpiry(db);
    await runReminderSweep(db);
  } catch (err) {
    console.error('Reminder job failed', err);
  }
};
void hourly();
setInterval(hourly, 3_600_000).unref();

const port = Number(process.env.PORT) || 3000;
// Railway needs every interface. Anywhere else the prototype stays on localhost.
const host = process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_ENVIRONMENT_NAME ? '0.0.0.0' : '127.0.0.1';
createApp(db).listen(port, host, () => console.log(`ProIT listening on ${host}:${port}`));
