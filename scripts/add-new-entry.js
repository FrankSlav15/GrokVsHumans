const fs = require('fs');
const path = require('path');

const type = process.argv[2]; // memes, battles, or categories

if (!['memes', 'battles', 'categories'].includes(type)) {
  console.error('Usage: node scripts/add-new-entry.js <memes|battles|categories>');
  process.exit(1);
}

const filePath = path.join('data', `${type}.json`);

let data = [];
try {
  data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
} catch (e) {
  console.error(`Could not read ${filePath}`);
  process.exit(1);
}

// Find highest order number
const maxOrder = data.length > 0 
  ? Math.max(...data.map(item => item.order || 0)) 
  : 0;

let newEntry = {
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

data.push(newEntry);

fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');

console.log(`✅ Added new entry to data/${type}.json with order = ${newEntry.order}`);
if (type !== 'memes') {
  console.log(`   → Includes starter threadPosts (id: 1)`);
}