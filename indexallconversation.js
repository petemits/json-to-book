const fs = require('fs');
const path = require('path');

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

// ---- Extract messages from both formats (with cycle detection) ----
function extractMessages(obj) {
  const messages = [];
  const visited = new Set(); // Track visited objects to avoid circular references
  
  function traverse(current) {
    if (!current || typeof current !== 'object') return;
    // Avoid circular references
    if (visited.has(current)) return;
    visited.add(current);
    
    // If this object has a 'message' field with content
    if (current.message && typeof current.message === 'object') {
      const msg = current.message;
      let content = '';
      let role = 'unknown';
      
      // Determine role (author.role or type)
      if (msg.author && msg.author.role) {
        role = msg.author.role; // 'user', 'assistant', 'system'
      } else if (msg.type) {
        if (msg.type === 'REQUEST') role = 'user';
        else if (msg.type === 'RESPONSE') role = 'assistant';
      }
      
      // Extract content from parts or fragments
      if (msg.content && msg.content.parts && Array.isArray(msg.content.parts)) {
        // New format: content.parts array of strings
        for (const part of msg.content.parts) {
          if (typeof part === 'string' && part.trim()) {
            content += part + '\n';
          }
        }
      } else if (msg.fragments && Array.isArray(msg.fragments)) {
        // Old format: fragments array
        for (const frag of msg.fragments) {
          if (typeof frag === 'string') {
            content += frag + '\n';
          } else if (frag && typeof frag === 'object') {
            const text = frag.content || frag.text || '';
            if (text) content += text + '\n';
          }
        }
      } else if (msg.content && typeof msg.content === 'string') {
        // Fallback: content as string
        content = msg.content;
      }
      
      if (content.trim()) {
        // Map role: 'system' → 'assistant' (for display)
        let displayRole = role;
        if (role === 'system') displayRole = 'assistant';
        messages.push({ role: displayRole, content: content.trim() });
      }
    }
    
    // Recursively traverse mapping
    if (current.mapping && typeof current.mapping === 'object') {
      for (const key in current.mapping) {
        traverse(current.mapping[key]);
      }
    }
    
    // Traverse other properties (skip known metadata fields)
    for (const key in current) {
      if (['id', 'parent', 'children', 'model', 'inserted_at', 'updated_at', 'fragments', 'type', 'author', 'content', 'metadata', 'recipient', 'channel', 'status', 'end_turn', 'weight'].includes(key)) continue;
      if (typeof current[key] === 'object' && current[key] !== null) {
        traverse(current[key]);
      }
    }
  }
  
  traverse(obj);
  return messages;
}

// ---- Get title from object ----
function getTitle(obj) {
  if (obj.title && typeof obj.title === 'string' && obj.title.trim()) return obj.title.trim();
  if (obj.name && typeof obj.name === 'string' && obj.name.trim()) return obj.name.trim();
  if (obj.id && typeof obj.id === 'string' && obj.id.trim()) return 'Item ' + obj.id.trim().substring(0, 12);
  const msgs = extractMessages(obj);
  if (msgs.length && msgs[0].content.trim()) {
    return msgs[0].content.trim().substring(0, 60) + '...';
  }
  return 'Untitled';
}

// ---- Format content with code blocks ----
function formatContent(content) {
  const parts = content.split(/(```[\s\S]*?```)/g);
  let html = '';
  for (const part of parts) {
    if (part.startsWith('```') && part.endsWith('```')) {
      let code = part.slice(3, -3).trim();
      let lang = '';
      const lines = code.split('\n');
      if (lines.length > 0 && /^[a-zA-Z]+$/.test(lines[0].trim())) {
        lang = lines[0].trim();
        code = lines.slice(1).join('\n');
      }
      const escaped = escapeHtml(code);
      html += `<div class="code-block">
        <div class="code-header"><span>${lang || 'code'}</span><button onclick="copyCode(this)">Copy</button></div>
        <pre><code>${escaped}</code></pre>
      </div>`;
    } else {
      const paragraphs = part.split(/\n\s*\n/);
      for (const p of paragraphs) {
        if (p.trim()) {
          html += `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`;
        }
      }
    }
  }
  return html;
}

// ---- Main conversion ----
function convertToBook(inputPath, outputPath) {
  const title = path.basename(inputPath, '.json');
  const raw = fs.readFileSync(inputPath, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.error('❌ Error parsing JSON:', err.message);
    return;
  }

  const items = Array.isArray(data) ? data : [data];
  
  let tocHtml = '';
  let bodyHtml = '';
  let totalMessages = 0;
  let chapterIndex = 0;

  for (const item of items) {
    // Get the chapter title
    const chapterTitle = getTitle(item);
    const messages = extractMessages(item);
    
    if (messages.length === 0) continue;
    
    totalMessages += messages.length;
    
    // Add to Table of Contents
    tocHtml += `<li><a href="#ch-${chapterIndex}">${escapeHtml(chapterTitle)}</a></li>`;
    
    // Render chapter
    bodyHtml += `<h2 id="ch-${chapterIndex}">${escapeHtml(chapterTitle)}</h2>`;
    
    for (const msg of messages) {
      const cls = msg.role === 'user' ? 'message-user' : 'message-assistant';
      const label = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
      bodyHtml += `<div class="message ${cls}">
        <div class="message-label">${label}</div>
        ${formatContent(msg.content)}
      </div>`;
    }
    
    chapterIndex++;
  }

  // If no messages found, show error
  if (!bodyHtml) {
    bodyHtml = `
      <div style="background:#fff3cd;padding:2rem;border-radius:8px;border-left:4px solid #ffc107;margin:2rem 0;">
        <h3 style="color:#856404;">⚠️ No conversations found</h3>
        <p>The script couldn't find any message content in this JSON file.</p>
        <p><strong>Debug:</strong> Run <code>node debug.js &lt;file&gt;</code> to see the structure.</p>
      </div>
    `;
    tocHtml = `<li><em>No chapters found</em></li>`;
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width:1000px; margin:2rem auto; padding:0 1.5rem; line-height:1.6; background:#fefefe; color:#1a1a1a; }
  h1 { font-size:2.5rem; border-bottom:3px solid #2c3e50; padding-bottom:0.5rem; margin-bottom:1rem; }
  h2 { font-size:2rem; color:#2c3e50; margin-top:2rem; padding-top:1rem; border-top:2px solid #eee; }
  h3 { font-size:1.4rem; color:#34495e; margin:1.2rem 0 0.6rem; }
  .message { padding:0.8rem 1.2rem; margin:0.8rem 0; border-radius:12px; }
  .message-user { background:#e3f2fd; border-left:4px solid #1976d2; }
  .message-assistant { background:#f5f5f5; border-left:4px solid #388e3c; }
  .message-label { font-size:0.75rem; font-weight:bold; color:#666; margin-bottom:0.3rem; text-transform:uppercase; letter-spacing:0.5px; }
  .message p { margin:0.4rem 0; }
  .code-block { background:#1e1e1e; border-radius:6px; margin:0.8rem 0; overflow:hidden; }
  .code-header { display:flex; justify-content:space-between; align-items:center; padding:0.4rem 0.8rem; background:#2d2d2d; color:#ccc; font-size:0.8rem; }
  .code-header button { background:#444; color:#fff; border:none; padding:0.2rem 0.6rem; border-radius:4px; cursor:pointer; font-size:0.7rem; }
  .code-header button:hover { background:#555; }
  .code-block pre { margin:0; padding:0.8rem; overflow-x:auto; }
  .code-block code { font-family: 'Consolas', 'Monaco', monospace; font-size:0.9rem; color:#d4d4d4; line-height:1.5; }
  .toc { margin:2rem 0; background:#f8f9fa; padding:1rem 1.5rem; border-radius:8px; border:1px solid #e9ecef; }
  .toc h3 { margin-top:0; }
  .toc ul { list-style:none; padding:0; columns:2; }
  .toc li { margin:0.3rem 0; break-inside:avoid; }
  .toc a { color:#2c3e50; text-decoration:none; }
  .toc a:hover { text-decoration:underline; color:#1976d2; }
  .title-page { text-align:center; margin:2rem 0 3rem; }
  .title-page h1 { border-bottom:none; }
  .chapter-count { color:#6c757d; font-size:0.9rem; margin-top:-0.5rem; }
  @media (max-width: 600px) { body { padding:0 1rem; } .toc ul { columns:1; } }
</style>
</head>
<body>
<div class="title-page">
  <h1>📖 ${escapeHtml(title)}</h1>
  <p class="chapter-count">${chapterIndex} conversations · ${totalMessages} messages</p>
</div>
${tocHtml ? `<div class="toc"><h3>📑 Table of Contents</h3><ul>${tocHtml}</ul></div>` : ''}
${bodyHtml}
<script>
function copyCode(btn) {
  const block = btn.closest('.code-block');
  const code = block.querySelector('code');
  const text = code.textContent;
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied! ✓';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  }).catch(() => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    btn.textContent = 'Copied! ✓';
    setTimeout(() => btn.textContent = 'Copy', 2000);
  });
}
</script>
</body></html>`;

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log(`✅ Book created: ${outputPath}`);
  console.log(`📊 ${chapterIndex} conversations with ${totalMessages} total messages`);
}

// ---- CLI ----
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node index.js <input.json> <output.html>');
    process.exit(1);
  }
  convertToBook(args[0], args[1]);
}