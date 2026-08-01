const fs = require('fs');
const path = require('path');

// Path to the folder containing individual conversation JSON files
// The exporter puts them in 'conversations' folder
const jsonFolder = './chatgpt-export/conversations';
const outputCombined = './combined.json';

const fullPath = path.join(__dirname, jsonFolder);

if (!fs.existsSync(fullPath)) {
  console.error(`❌ Folder not found: ${fullPath}`);
  console.error('\nMake sure you have run the export and have a "conversations" folder inside chatgpt-export.');
  console.error('Run: dir chatgpt-export to see what\'s inside.');
  process.exit(1);
}

const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.error(`❌ No JSON files found in: ${fullPath}`);
  process.exit(1);
}

console.log(`📂 Found ${files.length} JSON files. Combining...`);

let allConversations = [];

for (const file of files) {
  const filePath = path.join(fullPath, file);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    allConversations.push(data);
  } catch (err) {
    console.error(`❌ Error reading ${file}:`, err.message);
  }
}

fs.writeFileSync(outputCombined, JSON.stringify(allConversations, null, 2));
console.log(`✅ Combined ${allConversations.length} conversations into ${outputCombined}`);