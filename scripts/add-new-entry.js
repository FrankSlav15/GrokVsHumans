const fs = require('fs');
const path = require('path');

const type = process.argv[2]; // memes, battles, or categories

if (!['memes', 'battles', 'categories'].includes(type)) {
  console.error('Usage: node scripts/add-new-entry.js <memes|battles|categories>');
  process.exit(1);
}

const filePath = path.join('data', `${type}.json`);

let data;
try {
  data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (e) {
  console.error(`Could not read ${filePath}`);
  process.exit(1);
}

// Find highest order number (keys are strings like "54")
const keys = Object.keys(data).map(Number);
const maxOrder = keys.length > 0 ? Math.max(...keys) : 0;
const newOrder = String(maxOrder + 1);

// Build the new entry
const newEntry = {
  order: maxOrder + 1,
  title: "",
  description: "",
  image: "",
  tags: "",
  xLink: ""
};

if (type === 'memes') {
  newEntry.genre = "";
  newEntry.context = "";
} else {
  // battles and categories get starter threadPosts
  newEntry.threadPosts = [
    {
      id: 1,
      author: "human",
      username: "",
      text: "",
      image: ""
    }
  ];
}

// Add the new entry using the correct key
data[newOrder] = newEntry;

// Write back with clean, consistent 2-space indentation
fs.writeFileSync(
  filePath,
  JSON.stringify(data, null, 2) + '\n',
  'utf8'
);

console.log(`✅ Added new entry to data/${type}.json`);
console.log(`   → Key: "${newOrder}"`);
console.log(`   → Order: ${newOrder}`);
if (type !== 'memes') {
  console.log(`   → Includes starter threadPosts (id: 1)`);
}