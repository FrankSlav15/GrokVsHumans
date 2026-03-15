const admin = require("firebase-admin");
const fs = require("fs");
const { execSync } = require("child_process");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://grokvshumans-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

// Get only the files that actually changed in this push
let changedFiles = [];
try {
  changedFiles = execSync('git diff --name-only HEAD^ HEAD', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(f => f.startsWith('data/') && f.endsWith('.json'));
} catch (e) {
  // Fallback for first-ever push or no parent commit
  changedFiles = ['data/battles.json', 'data/categories.json', 'data/memes.json'];
}

const filesToSync = changedFiles.map(f => f.replace('data/', '').replace('.json', ''));

filesToSync.forEach(file => {
  try {
    const data = JSON.parse(fs.readFileSync(`data/${file}.json`, "utf8"));
    db.ref(`content/${file}`).set(data);
    console.log(`✅ Synced /content/${file} (only changed file)`);
  } catch (err) {
    console.error(`❌ Error syncing ${file}:`, err.message);
  }
});

console.log(`Sync complete. Processed: ${filesToSync.join(', ')}`);