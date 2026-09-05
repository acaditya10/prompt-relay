#!/usr/bin/env node

/**
 * opencode-bridge — Respond to opencode permission prompts from your phone
 *
 * Prerequisites:
 *   - opencode running on the same machine (with server enabled)
 *   - ntfy app installed on phone, subscribed to your topic
 *
 * Usage:
 *   node bridge.js                    # Uses defaults (port 4096, topic opencode-input)
 *   node bridge.js --port 4096        # Custom opencode server port
 *   node bridge.js --topic my-topic   # Custom ntfy topic
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ─── Config ─────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const CONFIG_PATH = path.join(__dirname, '..', '.config.json');
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

const OPENCODE_PORT = parseInt(getArg('port', '4096'));
const NTFY_TOPIC = getArg('topic', fileConfig.topic || 'opencode-input');
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;
const OPENCODE_URL = `http://127.0.0.1:${OPENCODE_PORT}`;

// Pending permissions: Map<permissionId, { sessionId, message, tool, pattern, timestamp }>
const pendingPermissions = new Map();

// ─── HTTP helpers ───────────────────────────────────────────
function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', ...headers },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpRequest(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

// ─── Send ntfy notification ─────────────────────────────────
async function sendNotification(sessionId, permissionId, event) {
  const tool = event.properties?.tool || event.properties?.action || 'unknown';
  const pattern = event.properties?.pattern || event.properties?.path || '';
  const message = event.properties?.message || `Permission needed for: ${tool}`;

  const id = permissionId;
  pendingPermissions.set(id, {
    sessionId,
    permissionId,
    message,
    tool,
    pattern,
    timestamp: Date.now(),
  });

  const body = [
    `[opencode] ${id}`,
    '',
    `Tool: ${tool}`,
    pattern ? `Pattern: ${pattern}` : '',
    '',
    message,
    '',
    'Tap a button to respond.',
  ].filter(Boolean).join('\n');

  // Action buttons: Allow once, Allow always, Deny
  const actions = [
    `http, ✅ Allow once, ${NTFY_URL}, method=POST, body=${JSON.stringify(id + ':allow')}, clear=true`,
    `http, 🔓 Allow always, ${NTFY_URL}, method=POST, body=${JSON.stringify(id + ':always')}, clear=true`,
    `http, ❌ Deny, ${NTFY_URL}, method=POST, body=${JSON.stringify(id + ':deny')}, clear=true`,
  ].join('; ');

  try {
    await httpPost(NTFY_URL, body, {
      'Title': `Permission: ${tool}`,
      'Tags': 'lock,warning',
      'Priority': 'high',
      'Actions': actions,
    });
    console.log(`  [NOTIFY] Sent: ${tool} (${id})`);
  } catch (err) {
    console.error(`  [NOTIFY] Failed: ${err.message}`);
  }
}

// ─── Respond to opencode permission ─────────────────────────
async function respondToPermission(sessionId, permissionId, response) {
  try {
    const url = `${OPENCODE_URL}/session/${sessionId}/permissions/${permissionId}`;
    const body = JSON.stringify({ response });
    await httpPost(url, body, { 'Content-Type': 'application/json' });
    console.log(`  [REPLY] ${permissionId} → ${response}`);
    pendingPermissions.delete(permissionId);
  } catch (err) {
    console.error(`  [REPLY] Failed: ${err.message}`);
  }
}

// ─── SSE listener for opencode events ───────────────────────
function listenToOpencode() {
  console.log(`\n  Connecting to opencode at ${OPENCODE_URL}...`);

  const req = http.get(`${OPENCODE_URL}/event`, (res) => {
    console.log('  Connected! Listening for events...\n');

    let buffer = '';

    res.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '{}') continue;

        try {
          const event = JSON.parse(data);
          handleEvent(event);
        } catch {}
      }
    });

    res.on('end', () => {
      console.log('  Connection lost. Reconnecting in 3s...');
      setTimeout(listenToOpencode, 3000);
    });
  });

  req.on('error', (err) => {
    console.error(`  Connection failed: ${err.message}`);
    console.log('  Retrying in 3s...');
    setTimeout(listenToOpencode, 3000);
  });

  req.setTimeout(0); // No timeout for SSE
}

// ─── Event handler ──────────────────────────────────────────
function handleEvent(event) {
  const { type, properties } = event;

  if (type === 'permission.asked') {
    const sessionId = properties?.sessionID || properties?.session?.id;
    const permissionId = properties?.permissionID || properties?.id;
    if (sessionId && permissionId) {
      console.log(`  [EVENT] Permission asked: ${properties?.tool || 'unknown'} (${permissionId})`);
      sendNotification(sessionId, permissionId, event);
    }
  } else if (type === 'session.idle') {
    console.log('  [EVENT] Session idle — waiting for input');
  } else if (type === 'session.error') {
    console.log('  [EVENT] Session error');
  } else if (type === 'permission.replied') {
    const permissionId = properties?.permissionID || properties?.id;
    if (permissionId) {
      pendingPermissions.delete(permissionId);
    }
  }
}

// ─── Response listener (polls ntfy for user taps) ───────────
function listenForResponses() {
  let lastMsgId = null;
  console.log(`  Listening for responses on "${NTFY_TOPIC}"...\n`);

  const poll = async () => {
    try {
      const url = lastMsgId
        ? `${NTFY_URL}/json?poll=1&since=${lastMsgId}`
        : `${NTFY_URL}/json?poll=1&since=30s`;

      const data = await httpRequest(url);

      if (Array.isArray(data)) {
        for (const msg of data) {
          if (msg.id) lastMsgId = msg.id;
          if (!msg.message) continue;

          // Parse response: "permissionId:allow" / "permissionId:always" / "permissionId:deny"
          const match = msg.message.trim().match(/^([a-f0-9-]+):(allow|always|deny)$/i);
          if (match) {
            const [, permId, answer] = match;
            const pending = pendingPermissions.get(permId);
            if (pending) {
              const response = answer === 'deny' ? 'deny' : answer === 'always' ? 'allow-always' : 'allow-once';
              respondToPermission(pending.sessionId, permId, response);
            } else {
              console.log(`  [RESPONSE] Unknown or expired: ${permId}`);
            }
          }
        }
      }
    } catch {}
  };

  setInterval(poll, 2000);
  poll();
}

// ─── Cleanup old entries every 5 min ────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of pendingPermissions) {
    if (now - data.timestamp > 300000) {
      pendingPermissions.delete(id);
    }
  }
}, 300000);

// ─── Main ───────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════════╗
║         opencode-bridge                                  ║
║                                                          ║
║  opencode server: ${OPENCODE_URL}              ║
║  ntfy topic:      ${NTFY_TOPIC}                       ║
║                                                          ║
║  Permissions → Phone notifications                       ║
║  Phone taps   → Auto-approve in opencode                 ║
╚══════════════════════════════════════════════════════════╝
`);

listenToOpencode();
listenForResponses();
