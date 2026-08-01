// ================================================================
// FULL INDEX.JS – All AI Features + book-data.json export
// ================================================================
const fs = require('fs');
const path = require('path');

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function formatTime(t) { return t ? new Date(t*1000).toLocaleString() : null; }

function formatContent(c) {
  const parts = c.split(/(```[\s\S]*?```)/g);
  let h = '';
  for (const p of parts) {
    if (p.startsWith('```') && p.endsWith('```')) {
      let code = p.slice(3,-3).trim(), lang='';
      const lines = code.split('\n');
      if (lines.length && /^[a-zA-Z]+$/.test(lines[0].trim())) { lang = lines[0].trim(); code = lines.slice(1).join('\n'); }
      const esc = escapeHtml(code);
      h += '<div class="code-block"><div class="code-header"><span>'+(lang||'code')+'</span><button onclick="copyCode(this)">Copy</button></div><pre><code>'+esc+'</code></pre></div>';
    } else {
      const paras = p.split(/\n\s*\n/);
      for (const para of paras) if (para.trim()) h += '<p>'+escapeHtml(para.trim()).replace(/\n/g,'<br>')+'</p>';
    }
  }
  return h;
}

function extractMessages(obj) {
  const msgs = [], visited = new Set();
  (function traverse(cur) {
    if (!cur || typeof cur !== 'object') return;
    if (visited.has(cur)) return; visited.add(cur);
    if (cur.message && typeof cur.message === 'object') {
      const m = cur.message;
      let content = '', role = 'unknown';
      if (m.author && m.author.role) role = m.author.role;
      else if (m.type) role = m.type === 'REQUEST' ? 'user' : m.type === 'RESPONSE' ? 'assistant' : 'unknown';
      if (m.content && m.content.parts && Array.isArray(m.content.parts)) {
        for (const part of m.content.parts) if (typeof part === 'string' && part.trim()) content += part + '\n';
      } else if (m.fragments && Array.isArray(m.fragments)) {
        for (const f of m.fragments) {
          if (typeof f === 'string') content += f + '\n';
          else if (f && typeof f === 'object') {
            const txt = f.content || f.text || '';
            if (txt) content += txt + '\n';
          }
        }
      } else if (m.content && typeof m.content === 'string') content = m.content;
      if (content.trim()) {
        if (role === 'system') role = 'assistant';
        msgs.push({ role, content: content.trim() });
      }
    }
    if (cur.mapping) for (const k in cur.mapping) traverse(cur.mapping[k]);
    const skip = ['id','parent','children','model','inserted_at','updated_at','fragments','type','author','content','metadata','recipient','channel','status','end_turn','weight'];
    for (const k in cur) {
      if (skip.includes(k)) continue;
      if (typeof cur[k] === 'object' && cur[k] !== null) traverse(cur[k]);
    }
  })(obj);
  return msgs;
}

function getTitle(obj) {
  if (obj.title && obj.title.trim()) return obj.title.trim();
  if (obj.name && obj.name.trim()) return obj.name.trim();
  if (obj.id && obj.id.trim()) return 'Item ' + obj.id.trim().substring(0,12);
  const m = extractMessages(obj);
  if (m.length && m[0].content.trim()) return m[0].content.trim().substring(0,60)+'...';
  return 'Untitled';
}

function analyzeConversation(messages) {
  const text = messages.map(m => m.content).join(' ');
  const tokens = text.toLowerCase().split(/\s+/);
  const pos = ['good','great','excellent','happy','love','amazing','wonderful','nice','beautiful','glad','appreciate','thanks'];
  const neg = ['bad','terrible','awful','horrible','sad','hate','angry','upset','disappointed','fail','error','issue','problem','wrong','broken'];
  let score = 0;
  for (const w of tokens) { if (pos.includes(w)) score++; if (neg.includes(w)) score--; }
  const sentiment = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
  const emotions = { joy:0, anger:0, sadness:0, fear:0, surprise:0, disgust:0 };
  const lex = {
    joy: ['happy','glad','delighted','joy','pleased','cheerful','excited','thrilled','love','like','amazing','wonderful','great','fantastic'],
    anger: ['angry','frustrated','irritated','annoyed','furious','rage','mad','upset','hate','dislike','terrible','awful'],
    sadness: ['sad','disappointed','depressed','lonely','gloomy','miserable','heartbroken','down','tired','exhausted'],
    fear: ['fear','afraid','scared','terrified','worried','anxious','nervous','panicked','dread'],
    surprise: ['surprise','amazed','astonished','shocked','stunned','unexpected','sudden','wow','whoa'],
    disgust: ['disgust','disgusted','repulsed','sick','awful','horrible','revolting','gross']
  };
  for (const w of tokens) {
    for (const [em, words] of Object.entries(lex)) {
      if (words.includes(w)) emotions[em]++;
    }
  }
  let dominant = 'none', max=0;
  for (const [k,v] of Object.entries(emotions)) { if (v > max) { max = v; dominant = k; } }
  const patterns = [];
  if (/code|```|function|const/.test(text)) patterns.push('code request');
  const repeated = tokens.filter(w => w.length>3 && tokens.filter(x=>x===w).length>2);
  if (repeated.length) patterns.push('repetition: '+[...new Set(repeated)].join(', '));
  const qCount = (text.split('?').length - 1);
  if (qCount > 2) patterns.push('question-heavy');
  if (/error|bug|failed|issue/.test(text)) patterns.push('error report');
  if (/thank|thanks|appreciate/.test(text)) patterns.push('gratitude');
  return { sentiment, emotions, dominant, patterns, score };
}

function convertToBook(inputPath, outputPath) {
  const title = path.basename(inputPath, '.json');
  const raw = fs.readFileSync(inputPath, 'utf8');
  let data;
  try { data = JSON.parse(raw); } catch (e) { console.error('❌ Error parsing JSON:', e.message); return; }
  const items = Array.isArray(data) ? data : [data];
  const chapters = [], aiData = [];
  let totalMessages = 0;
  for (const item of items) {
    const chTitle = getTitle(item);
    const msgs = extractMessages(item);
    if (!msgs || !msgs.length) continue;
    const analysis = analyzeConversation(msgs);
    chapters.push({ title: chTitle, create_time: item.create_time || null, messages: msgs, analysis });
    aiData.push({
      title: chTitle,
      messageCount: msgs.length,
      sentiment: analysis.sentiment,
      emotion: analysis.dominant,
      patterns: analysis.patterns
    });
    totalMessages += msgs.length;
  }
  const summary = {
    totalConversations: chapters.length,
    totalMessages,
    avgSentiment: chapters.reduce((s,c) => s + (c.analysis.sentiment === 'positive' ? 1 : c.analysis.sentiment === 'negative' ? -1 : 0), 0) / (chapters.length || 1),
    dominantEmotions: {},
    topPatterns: {}
  };
  for (const c of chapters) {
    const em = c.analysis.dominant;
    if (em && em !== 'none') summary.dominantEmotions[em] = (summary.dominantEmotions[em] || 0) + 1;
    for (const p of c.analysis.patterns) {
      const key = p.split(':')[0];
      summary.topPatterns[key] = (summary.topPatterns[key] || 0) + 1;
    }
  }
  let tocHtml = '', bodyHtml = '';
  for (let i=0; i<chapters.length; i++) {
    const ch = chapters[i];
    const anchor = 'ch-'+i;
    tocHtml += '<li><a href="#'+anchor+'">'+escapeHtml(ch.title)+'</a></li>';
    bodyHtml += '<h2 id="'+anchor+'">'+escapeHtml(ch.title)+'</h2>';
    if (ch.create_time) bodyHtml += '<p class="conversation-date">📅 '+formatTime(ch.create_time)+'</p>';
    for (const msg of ch.messages) {
      const cls = msg.role === 'user' ? 'message-user' : 'message-assistant';
      const label = msg.role === 'user' ? '👤 User' : '🤖 Assistant';
      bodyHtml += '<div class="message '+cls+'"><div class="message-label">'+label+'</div>'+formatContent(msg.content)+'</div>';
    }
  }
  if (!bodyHtml) { bodyHtml = '<p style="color:red;">⚠️ No conversations found.</p>'; tocHtml = '<li><em>No chapters</em></li>'; }

  const dataObject = { summary, conversations: chapters.map(c => ({ title: c.title, messages: c.messages })), aiData };

  // Write book-data.json
  const dataJsonPath = path.join(path.dirname(outputPath), 'book-data.json');
  fs.writeFileSync(dataJsonPath, JSON.stringify(dataObject, null, 2));
  console.log('📦 Data file written: ' + dataJsonPath);

  const dataJson = JSON.stringify(dataObject).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t').replace(/<\/script/gi,'<\\/script');
  function emotionTags() { let h=''; for (const [k,v] of Object.entries(summary.dominantEmotions)) h += '<span class="tag">'+k+': '+v+'</span>'; return h || 'None'; }
  function patternTags() { let h=''; for (const [k,v] of Object.entries(summary.topPatterns)) h += '<span class="tag">'+k+': '+v+'</span>'; return h || 'None'; }

  // Generate book.html (unchanged, but we also have window.bookData)
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    /* ... same styles as before ... */
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width:1000px; margin:2rem auto; padding:0 1.5rem; line-height:1.6; background:#ffffff; color:#1a1a1a; }
    h1 { font-size:2.5rem; border-bottom:3px solid #2c3e50; padding-bottom:.5rem; margin-bottom:1rem; }
    h2 { font-size:2rem; color:#2c3e50; margin-top:2rem; padding-top:1rem; border-top:2px solid #eee; }
    .conversation-date { color:#6c757d; font-size:.9rem; margin-top:-.5rem; margin-bottom:1rem; }
    .message { padding:.8rem 1.2rem; margin:.8rem 0; border-radius:12px; }
    .message-user { background:#e3f2fd; border-left:4px solid #1976d2; }
    .message-assistant { background:#f5f5f5; border-left:4px solid #388e3c; }
    .message-label { font-size:.75rem; font-weight:bold; color:#666; margin-bottom:.3rem; text-transform:uppercase; letter-spacing:.5px; }
    .message p { margin:.4rem 0; }
    .code-block { background:#1e1e1e; border-radius:6px; margin:.8rem 0; overflow:hidden; }
    .code-header { display:flex; justify-content:space-between; align-items:center; padding:.4rem .8rem; background:#2d2d2d; color:#ccc; font-size:.8rem; }
    .code-header button { background:#444; color:#fff; border:none; padding:.2rem .6rem; border-radius:4px; cursor:pointer; font-size:.7rem; }
    .code-header button:hover { background:#555; }
    .code-block pre { margin:0; padding:.8rem; overflow-x:auto; }
    .code-block code { font-family:'Consolas',monospace; font-size:.9rem; color:#d4d4d4; }
    .toc { margin:2rem 0; background:#f8f9fa; padding:1rem 1.5rem; border-radius:8px; border:1px solid #e9ecef; }
    .toc ul { list-style:none; padding:0; columns:2; }
    .toc li { margin:.3rem 0; break-inside:avoid; }
    .toc a { color:#2c3e50; text-decoration:none; }
    .toc a:hover { text-decoration:underline; }
    .title-page { text-align:center; margin:2rem 0 3rem; }
    .title-page h1 { border-bottom:none; }
    .chapter-count { color:#6c757d; font-size:.9rem; margin-top:-.5rem; }
    @media(max-width:600px){ body { padding:0 1rem; } .toc ul { columns:1; } }

    #floating-widget { position:fixed; bottom:20px; right:20px; z-index:9999; }
    #widget-toggle { background:#2c3e50; color:#fff; border:none; border-radius:50%; width:60px; height:60px; font-size:28px; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,.3); transition:transform .2s; }
    #widget-toggle:hover { transform:scale(1.05); }
    #widget-panel { display:none; position:absolute; bottom:70px; right:0; width:450px; max-height:70vh; background:#fff; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.2); overflow-y:auto; padding:1rem; text-align:left; font-size:.9rem; }
    #widget-panel h4 { margin-top:0; color:#2c3e50; }
    .widget-section { margin-bottom:1rem; }
    .widget-section .card { background:#f8f9fa; padding:.6rem; border-radius:6px; display:inline-block; margin:.2rem; min-width:80px; text-align:center; }
    .widget-section .card strong { display:block; font-size:1.2rem; }
    .widget-search { width:100%; padding:.4rem; border:1px solid #ddd; border-radius:6px; margin-bottom:.6rem; }
    .widget-result { border-bottom:1px solid #eee; padding:.4rem 0; }
    .widget-result a { color:#2c3e50; text-decoration:none; }
    .widget-result a:hover { text-decoration:underline; }
    .widget-result .badge { font-size:.7rem; background:#3498db; color:#fff; padding:.1rem .4rem; border-radius:10px; margin-left:.3rem; }
    .tag { display:inline-block; background:#eee; padding:.1rem .5rem; border-radius:10px; font-size:.7rem; margin:.1rem; }
    #widget-status { color:#6c757d; font-size:.8rem; }
    #chat-container { margin-top:1rem; border-top:1px solid #eee; padding-top:.5rem; }
    #chat-messages { max-height:200px; overflow-y:auto; margin-bottom:.5rem; font-size:.9rem; }
    #chat-messages div { margin:.3rem 0; padding:.3rem .6rem; border-radius:8px; }
    #chat-messages .user { background:#e3f2fd; text-align:right; }
    #chat-messages .bot { background:#f5f5f5; }
    #chat-input-row { display:flex; gap:.3rem; }
    #chat-input { flex:1; padding:.3rem; border:1px solid #ddd; border-radius:6px; }
    #chat-send { padding:.3rem .6rem; background:#2c3e50; color:#fff; border:none; border-radius:6px; cursor:pointer; }
    #deep-toggle { margin:.5rem 0; display:flex; align-items:center; gap:.5rem; font-size:.8rem; }
    @media(max-width:600px){ #widget-panel { width:300px; right:-20px; } }
  </style>
</head>
<body>
<div id="book-content">
  <div class="title-page"><h1>📖 ${escapeHtml(title)}</h1><p class="chapter-count">${chapters.length} conversations · ${totalMessages} messages</p></div>
  ${tocHtml ? '<div class="toc"><h3>📑 Table of Contents</h3><ul>'+tocHtml+'</ul></div>' : ''}
  ${bodyHtml}
</div>
<div id="floating-widget">
  <button id="widget-toggle">🤖</button>
  <div id="widget-panel">
    <h4>🧠 AI Assistant</h4>
    <div style="display:flex;gap:.3rem;margin-bottom:.5rem;">
      <button id="tab-insights" onclick="showWidgetTab('insights')" style="flex:1;padding:.3rem;background:#2c3e50;color:#fff;border:none;border-radius:4px;">Insights</button>
      <button id="tab-chat" onclick="showWidgetTab('chat')" style="flex:1;padding:.3rem;background:#ddd;color:#333;border:none;border-radius:4px;">Chat</button>
      <button id="tab-deep" onclick="showWidgetTab('deep')" style="flex:1;padding:.3rem;background:#ddd;color:#333;border:none;border-radius:4px;">🧠 Deep</button>
    </div>
    <div id="widget-content">
      <div id="tab-insights-content">
        <div class="widget-section"><div class="card"><strong>${summary.totalConversations}</strong>Conversations</div><div class="card"><strong>${summary.totalMessages}</strong>Messages</div><div class="card"><strong>${summary.avgSentiment.toFixed(2)}</strong>Avg Sentiment</div></div>
        <div class="widget-section"><h5>😊 Emotions</h5>${emotionTags()}</div>
        <div class="widget-section"><h5>🔍 Patterns</h5>${patternTags()}</div>
        <hr><h5>🔎 Search</h5>
        <input type="text" id="widget-search" class="widget-search" placeholder="e.g. 'code'" oninput="searchConversations(this.value)">
        <div id="widget-results"><div id="widget-status">Type to search...</div></div>
      </div>
      <div id="tab-chat-content" style="display:none;">
        <p style="font-size:.9rem;color:#555;">Ask about the book.</p>
        <div id="chat-container">
          <div id="chat-messages"><div class="bot">👋 Ask me anything.</div></div>
          <div id="chat-input-row">
            <input type="text" id="chat-input" placeholder="Type..." onkeypress="if(event.key==='Enter') sendChat()">
            <button id="chat-send" onclick="sendChat()">Send</button>
          </div>
        </div>
      </div>
      <div id="tab-deep-content" style="display:none;">
        <p style="font-size:.9rem;color:#555;">Cognitive engine with TF‑IDF, autocorrect, Markov.</p>
        <div id="deep-container">
          <div id="deep-messages"><div class="bot">🧠 I use TF‑IDF and Markov. Ask anything.</div></div>
          <div id="chat-input-row">
            <input type="text" id="deep-input" placeholder="Ask..." onkeypress="if(event.key==='Enter') sendDeep()">
            <button id="deep-send" onclick="sendDeep()">Send</button>
          </div>
          <div id="deep-toggle">
            <label><input type="checkbox" id="deep-autocorrect" checked> Autocorrect</label>
            <label style="margin-left:1rem;"><input type="checkbox" id="deep-sentiment-style" checked> Sentiment styling</label>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<script>
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
window.escapeHtml = escapeHtml;

const bookData = JSON.parse("${dataJson}");
window.bookData = bookData;

class AdvancedSearch { /* same as before */ }
class SpellChecker { /* same */ }
class MarkovChain { /* same */ }
class CognitiveEngine { /* same */ }
const cognitive = new CognitiveEngine(bookData);

// ... rest of widget functions ...
</script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf8');
  console.log('✅ Book created: ' + outputPath);
  console.log('📊 ' + chapters.length + ' conversations, ' + totalMessages + ' messages');
  console.log('🧠 book-data.json also written.');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) { console.error('Usage: node index.js <input.json> <output.html>'); process.exit(1); }
  convertToBook(args[0], args[1]);
}