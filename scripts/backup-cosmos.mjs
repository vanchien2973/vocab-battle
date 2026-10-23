// Backup the "decks" and "progress" containers to JSON before deploying a data migration.
// Usage (the connection string stays in your own terminal, never in the repo):
//   COSMOS_CONNECTION_STRING="AccountEndpoint=...;AccountKey=...;" npm run backup:cosmos
// Optional: COSMOS_DATABASE (default "vocabbattle"), BACKUP_DIR (default "backups").
import { CosmosClient } from '@azure/cosmos';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const conn = process.env.COSMOS_CONNECTION_STRING;
if (!conn) {
  console.error('Set COSMOS_CONNECTION_STRING first (Azure Portal → Cosmos DB account → Keys → Primary connection string).');
  process.exit(1);
}
const dbName = process.env.COSMOS_DATABASE ?? 'vocabbattle';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(process.env.BACKUP_DIR ?? 'backups', stamp);
await mkdir(dir, { recursive: true });

const db = new CosmosClient(conn).database(dbName);
let totalRu = 0;
for (const name of ['decks', 'progress']) {
  const iterator = db.container(name).items.readAll({ maxItemCount: 100 });
  const docs = [];
  while (iterator.hasMoreResults()) {
    const page = await iterator.fetchNext();
    totalRu += page.requestCharge ?? 0;
    docs.push(...(page.resources ?? []));
  }
  const file = path.join(dir, `${name}.json`);
  await writeFile(file, JSON.stringify(docs, null, 2));
  console.log(`${name}: ${docs.length} documents → ${file}`);
}
console.log(`Done (${totalRu.toFixed(1)} RU). Keep this folder until the new version is verified.`);
