import { createPgDb, runMigrations } from './db';
import { isSeeded, seed } from './seed';

const command = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. This command is meant to run in the Railway environment.');
  process.exit(1);
}

const db = createPgDb(url);
try {
  if (command === 'migrate') {
    console.log('Applied:', await runMigrations(db));
  } else if (command === 'seed') {
    await runMigrations(db);
    if (await isSeeded(db)) console.log('The database already has data. Nothing was changed.');
    else {
      await seed(db);
      console.log('Seed complete.');
    }
  } else if (command === 'reset') {
    if (process.env.CONFIRM_RESET !== 'yes') {
      console.error('This deletes all data. Set CONFIRM_RESET=yes to continue.');
      process.exitCode = 1;
    } else {
      await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      await runMigrations(db);
      await seed(db);
      console.log('Database reset and reseeded.');
    }
  } else {
    console.error('Usage: cli.js <migrate|seed|reset>');
    process.exitCode = 1;
  }
} finally {
  await db.close();
}
