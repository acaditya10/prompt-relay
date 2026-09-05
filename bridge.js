#!/usr/bin/env node

/**
 * opencode-bridge — Connect to opencode and send permission prompts to phone
 *
 * Requires opencode to be running with server.port: 4096 (in opencode.json config).
 * Connects to the existing server — does NOT start anything.
 */

import { createOpencodeClient } from '@opencode-ai/sdk';
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
const OPENCODE_URL = 'http://127.0.0.1:4096';
const LOG_PATH = path.join(__dirname, 'bridge.log');

// ─── Logging (console + file, since bridge runs hidden) ─────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch {}
}

// Pending permissions: Map<permissionId, { sessionId, tool, timestamp }>
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

function httpGetJson(url) {
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
  const tool = props?.tool || props?.type || 'unknown';
  const pattern = Array.isArray(props?.pattern) ? props.pattern.join(', ') : (props?.pattern || '');
  const title = props?.title || `Permission: ${tool}`;

  pendingPermissions.set(permissionId, { sessionId, tool, timestamp: Date.now() });

  const body = [
    `[opencode] ${permissionId}`,
    '',
    `Tool: ${tool}`,
    pattern ? `Pattern: ${pattern}` : '',
    '',
    title,
  ].filter(Boolean).join('\n');

  const actions = [
    `http, ✅ Allow once, ${NTFY_URL}, method=POST, body=${JSON.stringify(permissionId + ':allow')}, clear=true`,
    `http, 🔓 Always, ${NTFY_URL}, method=POST, body=${JSON.stringify(permissionId + ':always')}, clear=true`,
    `http, ❌ Deny, ${NTFY_URL}, method=POST, body=${JSON.stringify(permissionId + ':deny')}, clear=true`,
  ].join('; ');

  try {
    await httpPost(NTFY_URL, body, {
      'Title': title,
      'Tags': 'lock,warning',
      'Priority': 'high',
      'Actions': actions,
    });
    log(`Sent notification: ${tool} (${permissionId})`);
  } catch (err) {
    log(`Failed to send notification: ${err.message}`);
  }
}

// ─── Respond to permission (SDK method: postSessionIdPermissionsPermissionId) ──
async function respondPermission(client, sessionId, permissionId, response) {
  try {
    await client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response },
    });
    log(`Responded: ${permissionId} → ${response}`);
    pendingPermissions.delete(permissionId);
  } catch (err) {
    log(`Response FAILED: ${permissionId} → ${response}: ${err.message}`);
  }
}

// ─── Poll ntfy for user taps ────────────────────────────────
function startResponsePoller(client) {
  let lastMsgId = null;
  log(`Listening for responses on "${NTFY_TOPIC}"`);

  const poll = async () => {
    try {
      const url = lastMsgId
        ? `${NTFY_URL}/json?poll=1&since=${lastMsgId}`
        : `${NTFY_URL}/json?poll=1&since=60s`;

      const data = await httpGetJson(url);
      if (!Array.isArray(data)) return;

      for (const msg of data) {
        if (msg.id) lastMsgId = msg.id;
        if (!msg.message) continue;

        const match = msg.message.trim().match(/^([a-f0-9-]+):(allow|always|deny)$/i);
        if (!match) continue;

        const [, permId, answer] = match;
        const pending = pendingPermissions.get(permId);
        if (!pending) { log(`Ignored expired tap: ${permId}`); continue; }

        const response = answer === 'deny' ? 'reject' : answer === 'always' ? 'always' : 'once';
        log(`Phone answered ${permId}: ${answer} → ${response}`);
        await respondPermission(client, pending.sessionId, permId, response);
      }
    } catch (err) {
      log(`Poll error: ${err.message}`);
    }
  };

  setInterval(poll, 2000);
  poll();
}

// ─── Wait for opencode server ───────────────────────────────
async function waitForServer(maxWait = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await httpGetJson(OPENCODE_URL);
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return false;
}

// ─── Handle events from SSE stream ──────────────────────────
async function handleEvent(client, event) {
  const { type, properties } = event;

  if (type === 'permission.asked') {
    const sessionId = properties?.sessionID;
    const permissionId = properties?.id || properties?.permissionID;

    log(`🔒 Permission asked: type=${properties?.type || '?'} id=${permissionId} session=${sessionId}`);

    if (sessionId && permissionId) {
      await sendNotification(sessionId, permissionId, properties);
    } else {
      log(`⚠️ Missing IDs — full event: ${JSON.stringify(properties)}`);
    }
  } else if (type === 'permission.replied') {
    const permissionId = properties?.permissionID || properties?.id;
    if (permissionId) pendingPermissions.delete(permissionId);
    log(`✅ Permission resolved: ${permissionId}`);
  }
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  log('========================================');
  log('opencode-bridge v4 starting');
  log(`Target: ${OPENCODE_URL}, ntfy topic: ${NTFY_TOPIC}`);

  // Wait for opencode server (start opencode first)
  process.stdout.write('Waiting for opencode server...');
  const ready = await waitForServer();
  if (!ready) {
    log('❌ opencode server not found at ' + OPENCODE_URL + '. Start opencode first, then run bridge.js');
    process.exit(1);
  }
  log('Connected to opencode server');

  // Create client
  const client = createOpencodeClient({ baseUrl: OPENCODE_URL });

  // Start ntfy response poller
  startResponsePoller(client);

  // Subscribe to ALL events via /global/event
  log('Subscribing to /global/event ...');
  const events = await client.global.event();

  for await (const event of events.stream) {
    try {
      await handleEvent(client, event);
    } catch (err) {
      log(`Event error: ${err.message}`);
    }
  }
}

main().catch((err) => {
  log(`❌ Fatal: ${err.message}`);
  process.exit(1);
});