const fs = require('fs');
const path = require('path');

// Get file from command line, or use default
const filePath = process.argv[2] || './conversations.json';

try {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  
  console.log('=== JSON STRUCTURE ===');
  console.log('Type:', Array.isArray(data) ? 'Array' : 'Object');
  
  // Show first few keys
  if (Array.isArray(data)) {
    console.log(`Number of items: ${data.length}`);
    if (data.length > 0) {
      console.log('\n=== FIRST ITEM KEYS ===');
      console.log(Object.keys(data[0]));
      console.log('\n=== FIRST ITEM (sample) ===');
      console.log(JSON.stringify(data[0], null, 2).substring(0, 800));
    }
  } else {
    console.log('Keys:', Object.keys(data));
    console.log('\n=== SAMPLE ===');
    console.log(JSON.stringify(data, null, 2).substring(0, 800));
  }
  
  // Search for any object with 'message' field
  let messageCount = 0;
  function search(obj, path = 'root') {
    if (!obj || typeof obj !== 'object') return;
    if (obj.message) {
      messageCount++;
      console.log(`\n--- Message found at: ${path} ---`);
      console.log('message keys:', Object.keys(obj.message));
      if (obj.message.fragments) {
        console.log('fragments sample:', JSON.stringify(obj.message.fragments).substring(0, 200));
      }
      if (obj.message.content) {
        console.log('content sample:', obj.message.content.substring(0, 100));
      }
    }
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        search(value, path + '.' + key);
      }
    }
  }
  search(data);
  console.log(`\nTotal message objects found: ${messageCount}`);
  
} catch (err) {
  console.error('Error:', err.message);
}