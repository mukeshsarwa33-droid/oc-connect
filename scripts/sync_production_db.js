// Automated Production Database Sync Tool for OC Connect
// Pulls the latest live SQLite database from Render production so local development
// and git commits NEVER overwrite real user accounts, messages, or groups.

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PROD_URL = process.env.PROD_URL || 'https://oc-connect-1.onrender.com';
const ADMIN_KEY = process.env.ADMIN_KEY || 'oc_connect_master_key_2026';
const TARGET_DB_PATH = path.join(__dirname, '..', 'data', 'oc_connect.db');
const TEMP_DB_PATH = path.join(__dirname, '..', 'data', 'oc_connect_sync_temp.db');

async function syncProductionDatabase() {
  console.log('====================================================');
  console.log('🔄 SYNCING LIVE PRODUCTION DATABASE FROM RENDER');
  console.log(`Target: ${PROD_URL}/api/admin/db/export`);
  console.log('====================================================\n');

  const exportUrl = `${PROD_URL}/api/admin/db/export?key=${encodeURIComponent(ADMIN_KEY)}`;

  try {
    await new Promise((resolve, reject) => {
      const parsed = new URL(exportUrl);
      const client = parsed.protocol === 'https:' ? https : http;

      const req = client.get(exportUrl, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Server returned HTTP ${res.statusCode}: ${res.statusMessage}`));
        }

        const fileStream = fs.createWriteStream(TEMP_DB_PATH);
        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (err) => {
          fs.unlink(TEMP_DB_PATH, () => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        fs.unlink(TEMP_DB_PATH, () => {});
        reject(err);
      });
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Sync request timed out after 15 seconds.'));
      });
    });

    // Verify downloaded database
    console.log('🔍 Validating downloaded production database integrity...');
    const testDb = new DatabaseSync(TEMP_DB_PATH);
    const userRow = testDb.prepare('SELECT COUNT(*) as count FROM users;').get();
    const msgRow = testDb.prepare('SELECT COUNT(*) as count FROM messages;').get();
    const groupRow = testDb.prepare('SELECT COUNT(*) as count FROM chat_groups;').get();
    testDb.close();

    console.log(`✅ Integrity check passed:`);
    console.log(`   • Total Users:    ${userRow.count}`);
    console.log(`   • Total Messages: ${msgRow.count}`);
    console.log(`   • Total Groups:   ${groupRow.count}`);

    // Clean up old WAL/SHM files to prevent WAL header mismatch
    const walFile = TARGET_DB_PATH + '-wal';
    const shmFile = TARGET_DB_PATH + '-shm';
    if (fs.existsSync(walFile)) { try { fs.unlinkSync(walFile); } catch (_) {} }
    if (fs.existsSync(shmFile)) { try { fs.unlinkSync(shmFile); } catch (_) {} }

    // Replace target DB with validated production DB
    if (fs.existsSync(TARGET_DB_PATH)) {
      const backupPath = TARGET_DB_PATH + '.pre_sync_bak';
      fs.copyFileSync(TARGET_DB_PATH, backupPath);
    }

    fs.renameSync(TEMP_DB_PATH, TARGET_DB_PATH);
    if (fs.existsSync(TARGET_DB_PATH + '.pre_sync_bak')) {
      try { fs.unlinkSync(TARGET_DB_PATH + '.pre_sync_bak'); } catch (_) {}
    }
    console.log(`\n🎉 Success! Live database synced cleanly to: ${TARGET_DB_PATH}`);
    console.log('Your local environment and git repository now mirror production exactly.\n');
  } catch (err) {
    console.error('❌ Failed to sync production database:', err.message);
    if (fs.existsSync(TEMP_DB_PATH)) {
      try { fs.unlinkSync(TEMP_DB_PATH); } catch (_) {}
    }
    process.exit(1);
  }
}

syncProductionDatabase();
