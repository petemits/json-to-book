const fs = require('fs');
const path = require('path');

// ---- FIELDS TO EXCLUDE (metadata we don't want to see) ----
const EXCLUDED_FIELDS = new Set([
  'id', 'parent', 'children', 'model', 'inserted_at', 'updated_at',
  'fragments', 'type', 'parent_id', 'child_id', 'message_id',
  'conversation_id', 'timestamp', 'index', 'role'
]);

// ---- Helpers ----
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase()).trim();
}

// ---- Extract ordered messages from the mapping tree ----
function extractConversation(obj) {
  const messages = [];

  // Helper to recursively traverse mapping
  function traverse(node, depth = 0) {
    if (!node || typeof node !== 'object') return;

    // If this node has a 'message' field, extract it
    if (node.message && typeof node.message === 'object') {
      const msg = node.message;
      let content = '';
      let role = 'unknown';

      // Determine role: REQUEST = user, RESPONSE = assistant
      if (msg.type === 'REQUEST') role = 'user';
      else if (msg.type === 'RESPONSE') role = 'assistant';
      else if (msg.type) role = msg.type.toLowerCase();

      // Extract fragments
      if (msg.fragments && Array.isArray(msg.fragments)) {
        for (const frag of msg.fragments) {
          if (typeof frag === 'string') {
            content += frag + '\n';
          } else if (frag && typeof frag === 'object') {
            // Fragments may have 'content' or 'text'
            const text = frag.content || frag.text || '';
            if (text) content += text + '\n';
          }
        }
      } else if (msg.content) {
        content = msg.content;
      } else if (msg.text) {
        content = msg.text;
      }

      if (content.trim()) {
        messages.push({
          role: role,
          content: content.trim(),
          depth: depth,
          id: node.id || null
        });
      }
    }

    // Recursively process children
    if (node.children && Array.isArray(node.children)) {
      for (const childId of node.children) {
        // We need to have the full mapping to lookup children by ID
        // Since we don't have a global map here, we'll assume the parent has a 'mapping' object
        // We'll handle this in the main function.
      }
    }

    // If this node has a 'mapping' property, traverse its values
    if (node.mapping && typeof node.mapping === 'object') {
      for (const [key, value] of Object.entries(node.mapping)) {
        traverse(value, depth + 1);
      }
    }

    // Also traverse any other object properties that might contain messages
    for (const [key, value] of Object.entries(node)) {
      if (EXCLUDED_FIELDS.has(key.toLowerCase())) continue;
      if (typeof value === 'object' && value !== null) {
        traverse(value, depth + 1);
      }
    }
  }

  traverse(obj);
  return messages;
}

// ---- Format message content with code blocks ----
function formatContent(content, role) {
  // Split by code fences (```)
  const parts = content.split(/(```[\s\S]*?```)/g);
  let html = '';

  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      // It's a code block
      const code = part.slice(3, -3).trim();
      // Detect language if present (first line)
      let lang = '';
      let codeBody = code;
      const lines = code.split('\n');
      if (lines.length > 0 && /^[a-zA-Z]+$/.test(lines[0].trim())) {
        lang = lines[0].trim();
        codeBody = lines.slice(1).join('\n');
      }
      const escapedCode = escapeHtml(codeBody);
      html += `<div class="code-block">
        <div class="code-header">
          <span>${lang ? lang : 'code'}</span>
          <button class="copy-btn" onclick="copyCode(this)">Copy</button>
        </div>
        <pre><code class="language-${lang}">${escapedCode}</code></pre>
      </div>`;
    } else {
      // Plain text – split into paragraphs
      const paragraphs = part.split(/\n\s*\n/);
      for (const p of paragraphs) {
        const trimmed = p.trim();
        if (trimmed) {
          // Detect if it's a code block without fences (indented with 4 spaces or more)
          if (/^( {4,}|\t)/.test(trimmed)) {
            // Treat as code
            const escapedCode = escapeHtml(trimmed);
            html += `<div class="code-block">
              <div class="code-header">
                <span>indented code</span>
                <button class="copy-btn" onclick="copyCode(this)">Copy</button>
              </div>
              <pre><code>${escapedCode}</code></pre>
            </div>`;
          } else {
            html += `<p>${escapeHtml(trimmed).replace(/\n/g, '<br>')}</p>`;
          }
        }
      }
    }
  }
  return html;
}

// ---- Get a title from the object ----
function getTitle(obj) {
  if (obj.title && typeof obj.title === 'string' && obj.title.trim()) return obj.title.trim();
  if (obj.name && typeof obj.name === 'string' && obj.name.trim()) return obj.name.trim();
  if (obj.id && typeof obj.id === 'string' && obj.id.trim()) return `Item ${obj.id.trim().substring(0, 12)}`;
  // Fallback: use first message content
  const msgs = extractConversation(obj);
  if (msgs.length > 0 && msgs[0].content.trim()) {
    const first = msgs[0].content.trim();
    return first.substring(0, 60) + (first.length > 60 ? '...' : '');
  }
  return 'Untitled';
}

// ---- Main conversion ----
async function jsonToBook(inputPath, outputHtmlPath, options = {}) {
  const title = options.title || path.basename(inputPath, '.json');
  const fileContent = fs.readFileSync(inputPath, 'utf8');
  let data;
  try {
    data = JSON.parse(fileContent);
  } catch (err) {
    console.error('❌ Error parsing JSON:', err.message);
    process.exit(1);
  }

  const rootIsArray = Array.isArray(data);
  const items = rootIsArray ? data : [data];

  // Build TOC
  const tocEntries = items.map(item => getTitle(item));

  const outStream = fs.createWriteStream(outputHtmlPath, { encoding: 'utf8' });

  outStream.write(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; max-width:900px; margin:2rem auto; padding:0 1.5rem; line-height:1.6; color:#1a1a1a; background:#fefefe; }
  h1 { font-size:2.5rem; border-bottom:3px solid #2c3e50; padding-bottom:0.5rem; margin:2rem 0 1rem; }
  h2 { font-size:2rem; margin:1.8rem 0 0.8rem; color:#2c3e50; }
  h3 { font-size:1.4rem; margin:1.2rem 0 0.6rem; color:#34495e; }
  h4 { font-size:1.1rem; margin:0.8rem 0 0.2rem; color:#4a5b6b; }
  p { margin:0.4rem 0; }
  ul { padding-left:1.8rem; margin:0.4rem 0; }
  dl { margin-left:1.5rem; }
  dt { font-weight:bold; margin-top:0.4rem; }
  dd { margin-left:1.5rem; margin-bottom:0.4rem; }
  .toc { margin:2rem 0; }
  .toc ul { list-style:none; padding:0; }
  .toc li { margin:0.3rem 0; }
  .toc a { text-decoration:none; color:#2c3e50; }
  .toc a:hover { text-decoration:underline; }
  .title-page { text-align:center; margin:3rem 0; }
  hr { border:0; border-top:1px solid #e0e0e0; margin:2rem 0; }

  /* Conversation styles */
  .conversation { margin:1rem 0; }
  .message { padding:0.8rem 1.2rem; margin:0.6rem 0; border-radius:8px; background:#f5f5f5; border-left:4px solid #2c3e50; }
  .message-user { background:#e3f2fd; border-left-color:#1976d2; }
  .message-assistant { background:#f5f5f5; border-left-color:#388e3c; }

  /* Code blocks */
  .code-block { background:#1e1e1e; border-radius:6px; margin:0.8rem 0; overflow:hidden; }
  .code-header { display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.8rem; background:#2d2d2d; color:#ccc; font-size:0.8rem; font-family: monospace; }
  .code-header button { background:#444; color:#fff; border:none; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer; font-size:0.7rem; }
  .code-header button:hover { background:#555; }
  .code-block pre { margin:0; padding:0.8rem; overflow-x:auto; }
  .code-block code { font-family: 'Fira Code', 'Consolas', monospace; font-size:0.9rem; color:#d4d4d4; background:transparent; }
  .language- { background:transparent; }
</style>
</head>
<body>
<div class="title-page"><h1>${escapeHtml(title)}</h1></div>
`);

  // TOC
  if (tocEntries.length > 0) {
    outStream.write(`<div class="toc"><h2>Table of Contents</h2><ul>`);
    tocEntries.forEach((t, idx) => {
      outStream.write(`<li><a href="#ch-${idx}">${escapeHtml(t)}</a></li>`);
    });
    outStream.write(`</ul></div><hr>`);
  }

  // Process each item as a chapter
  for (let i = 0; i < items.length; i++) {
    const obj = items[i];
    const chapterTitle = getTitle(obj);
    outStream.write(`<h2 id="ch-${i}">${escapeHtml(chapterTitle)}</h2>`);

    // Extract conversation messages
    const messages = extractConversation(obj);

    if (messages.length > 0) {
      outStream.write(`<div class="conversation">`);
      for (const msg of messages) {
        const roleClass = msg.role === 'user' ? 'message-user' : (msg.role === 'assistant' ? 'message-assistant' : '');
        outStream.write(`<div class="message ${roleClass}">`);
        // Format content with code blocks
        outStream.write(formatContent(msg.content, msg.role));
        outStream.write(`</div>`);
      }
      outStream.write(`</div>`);
    }

    // Show other non‑message fields (if any)
    for (const [key, value] of Object.entries(obj)) {
      if (EXCLUDED_FIELDS.has(key.toLowerCase())) continue;
      if (key === 'title' || key === 'name' || key === 'id') {
        if (String(value) === chapterTitle) continue;
      }
      outStream.write(`<h4>${escapeHtml(formatKey(key))}</h4>`);
      outStream.write(renderValue(value));
    }
  }

  // Add JavaScript for copy button
  outStream.write(`
<script>
function copyCode(btn) {
  const block = btn.closest('.code-block');
  const code = block.querySelector('code');
  const text = code.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  }).catch(() => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}
</script>
  `);

  outStream.write('</body></html>');
  outStream.end();
  console.log('✅ Book created successfully.');
}

// ---- RenderValue (for non‑message fields) ----
function renderValue(value) {
  if (value === null || value === undefined) return '<em>null</em>';
  if (typeof value === 'string') {
    return `<p>${escapeHtml(value).replace(/\n/g, '<br>')}</p>`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `<span>${escapeHtml(String(value))}</span>`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '<em>[]</em>';
    let html = '<ul>';
    for (const item of value) {
      html += `<li>${renderValue(item)}</li>`;
    }
    html += '</ul>';
    return html;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '<em>{}</em>';
    let html = '<dl>';
    for (const [k, v] of entries) {
      if (EXCLUDED_FIELDS.has(k.toLowerCase())) continue;
      html += `<dt>${escapeHtml(formatKey(k))}</dt>`;
      html += `<dd>${renderValue(v)}</dd>`;
    }
    html += '</dl>';
    return html;
  }
  return escapeHtml(String(value));
}

// ---- CLI ----
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node index.js <input.json> <output.html>');
    process.exit(1);
  }
  jsonToBook(args[0], args[1]).catch(err => { console.error('❌ Error:', err); process.exit(1); });
}