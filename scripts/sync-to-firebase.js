const admin = require("firebase-admin");
const fs = require("fs");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://grokvshumans-default-rtdb.europe-west1.firebasedatabase.app"
});

const db = admin.database();

const files = ["battles", "categories", "memes"];

files.forEach(file => {
  const data = JSON.parse(fs.readFileSync(`data/${file}.json`, "utf8"));
  db.ref(`content/${file}`).set(data);
  console.log(`✅ Synced /content/${file}`);
});