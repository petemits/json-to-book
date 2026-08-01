const fs = require('fs');
const path = require('path');

// Possible locations for conversation JSON files
const possiblePaths = [
  './chatgpt-export/conversations',
  './chatgpt-export/json',
  '../chatgpt-export/conversations',
  '../chatgpt-export/json',
];

let jsonFolder = null;

for (const p of possiblePaths) {
  const fullPath = path.join(__dirname, p);
  if (fs.existsSync(fullPath)) {
    jsonFolder = fullPath;
    break;
  }
}

if (!jsonFolder) {
  console.error('❌ Could not find folder containing conversation JSON files.');
  console.error('Searched in:');
  for (const p of possiblePaths) {
    console.error(`  - ${path.join(__dirname, p)}`);
  }
  process.exit(1);
}

console.log(`✅ Found conversations at: ${jsonFolder}`);

const files = fs.readdirSync(jsonFolder).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.error(`❌ No JSON files found in: ${jsonFolder}`);
  process.exit(1);
}

console.log(`📂 Found ${files.length} JSON files. Combining...`);

let allConversations = [];

for (const file of files) {
  const filePath = path.join(jsonFolder, file);
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    allConversations.push(data);
  } catch (err) {
    console.error(`❌ Error reading ${file}:`, err.message);
  }
}

const outputCombined = './combined.json';
fs.writeFileSync(outputCombined, JSON.stringify(allConversations, null, 2));
console.log(`✅ Combined ${allConversations.length} conversations into ${outputCombined}`);