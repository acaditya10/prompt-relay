#!/usr/bin/env node

/**
 * opencode-bridge — Start opencode server + send permission prompts to phone
 *
 * This starts its own opencode server. No need to run "opencode" separately.
 * Just run this script and it handles everything.
 *
 * Usage:
 *   node bridge.js
 */

import { createOpencode, createOpencodeClient } from '@opencode-ai/sdk';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ─────────────────────────────────────────────────
const CONFIG_PATH = path.join(__dirname, '.config.json');
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

const NTFY_TOPIC = fileConfig.topic || 'opencode-input';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

// Pending permissions: Map<permissionId, { sessionId, message, tool, timestamp }>
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
    mod.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    }).on('error', reject);
  });
}

// ─── Send ntfy notification with action buttons ─────────────
async function sendNotification(sessionId, permissionId, props) {
  const tool = props?.tool || props?.action || 'unknown';
  const pattern = props?.pattern || props?.path || '';
  const message = props?.message || `Permission needed for: ${tool}`;

  pendingPermissions.set(permissionId, {
    sessionId,
    permissionId,
    message,
    tool,
    pattern,
    timestamp: Date.now(),
  });

  const body = [
    `[opencode] ${permissionId}`,
    '',
    `Tool: ${tool}`,
    pattern ? `Pattern: ${pattern}` : '',
    '',
    message,
  ].filter(Boolean).join('\n');

  const actions = [
    `http, ✅ Allow once, ${NTFY_URL}, method=POST, body=${JSON.stringify(permissionId + ':allow')}, clear=true`,
    `http, 🔓 Allow always, ${NTFY_URL}, method=POST, body=${JSON.stringify(permissionId + ':always')}, clear=true`,
    `http, ❌ Deny, ${NTFY_URL}, method=POST, body=${JSON.stringify(permissionId + ':deny')}, clear=true`,
  ].join('; ');

  try {
    await httpPost(NTFY_URL, body, {
      'Title': `Permission: ${tool}`,
      'Tags': 'lock,warning',
      'Priority': 'high',
      'Actions': actions,
    });
    console.log(`  ✅ Sent: ${tool} (${permissionId})`);
  } catch (err) {
    console.error(`  ❌ Failed to send: ${err.message}`);
  }
}

// ─── Respond to opencode permission via SDK ─────────────────
async function respondToPermission(client, sessionId, permissionId, response) {
  try {
    await client.postSessionByIdPermissionsByPermissionId({
      path: { id: sessionId, permissionId: permissionId },
      body: { response },
    });
    console.log(`  ✅ Responded: ${permissionId} → ${response}`);
    pendingPermissions.delete(permissionId);
  } catch (err) {
    console.error(`  ❌ Response failed: ${err.message}`);
  }
}

// ─── Poll ntfy for user responses ───────────────────────────
function startResponsePoller(client) {
  let lastMsgId = null;
  console.log(`\n  📱 Listening for responses on "${NTFY_TOPIC}"...`);

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

          const match = msg.message.trim().match(/^([a-f0-9-]+):(allow|always|deny)$/i);
          if (match) {
            const [, permId, answer] = match;
            const pending = pendingPermissions.get(permId);
            if (pending) {
              const response = answer === 'deny' ? 'deny' : answer === 'always' ? 'allow-always' : 'allow-once';
              await respondToPermission(client, pending.sessionId, permId, response);
            } else {
              console.log(`  ⚠️  Expired or unknown: ${permId}`);
            }
          }
        }
      }
    } catch {}
  };

  setInterval(poll, 2000);
  poll();
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         opencode-bridge                                  ║
║                                                          ║
║  Starting opencode server...                             ║
║  ntfy topic: ${NTFY_TOPIC.padEnd(40)}║
║                                                          ║
║  Permission prompts → Phone notifications                 ║
║  Phone taps         → Auto-approve                       ║
╚══════════════════════════════════════════════════════════╝
`);

  // Start opencode server + get client
  const { client } = await createOpencode({
    hostname: '127.0.0.1',
    port: 4096,
  });

  console.log('  ✅ opencode server running at http://127.0.0.1:4096\n');

  // Start response poller
  const respondClient = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });
  startResponsePoller(respondClient);

  // Subscribe to events via SSE
  console.log('  🔍 Listening for permission events...\n');

  const events = await client.event.subscribe();

  for await (const event of events.stream) {
    const { type, properties } = event;

    if (type === 'permission.asked') {
      const sessionId = properties?.sessionID || properties?.session?.id || properties?.session_id;
      const permissionId = properties?.permissionID || properties?.id || properties?.permission_id;

      console.log(`  🔒 Permission asked: ${properties?.tool || '?'}`);
      console.log(`     session=${sessionId} perm=${permissionId}`);

      if (sessionId && permissionId) {
        await sendNotification(sessionId, permissionId, properties);
      } else {
        console.log('  ⚠️  Missing IDs — cannot respond from phone');
        console.log('     Full event:', JSON.stringify(properties).slice(0, 300));
      }
    } else if (type === 'permission.replied') {
      const permissionId = properties?.permissionID || properties?.id;
      if (permissionId) {
        pendingPermissions.delete(permissionId);
        console.log(`  ✅ Permission resolved: ${permissionId}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(`\n  ❌ Fatal: ${err.message}\n`);
  process.exit(1);
});
