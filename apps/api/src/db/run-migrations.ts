import 'reflect-metadata';
import path from 'path';
import { DataSource } from 'typeorm';

const dataSource = new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ??
    'postgresql://postgres:password@localhost:5432/ripple',
  migrations: [path.join(__dirname, 'migrations', `*${__filename.endsWith('.ts') ? '.ts' : '.js'}`)],
});

async function run() {
  await dataSource.initialize();
  const migrations = await dataSource.runMigrations();
  if (migrations.length === 0) {
    console.log('No pending migrations.');
  } else {
    console.log(`Ran ${migrations.length} migration(s):`);
    migrations.forEach((m) => console.log(` - ${m.name}`));
  }
  await dataSource.destroy();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
