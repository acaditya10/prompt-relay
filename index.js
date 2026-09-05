#!/usr/bin/env node

/**
 * prompt-relay — Send input prompts to your phone via ntfy.sh
 *
 * One-time setup:
 *   1. Install "ntfy" app on Android (Play Store)
 *   2. Open ntfy → Subscribe → pick a topic name (e.g. "my-prompts")
 *   3. Run: node index.js config
 *
 * Usage:
 *   node index.js config                          # Set your topic (one-time)
 *   node index.js send "Approve changes?"          # Send notification
 *   node index.js send "Pick one" --choices A,B,C  # With choices
 *   node index.js listen                           # Listen for responses
 *   node index.js test                             # Send test notification
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CONFIG_PATH = path.join(__dirname, '.config.json');
const NTFY_URL = 'https://ntfy.sh';

// ─── Config ─────────────────────────────────────────────────
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function getTopic() {
  const config = loadConfig();
  if (!config?.topic) {
    console.error('\n  Not configured. Run: node index.js config\n');
    process.exit(1);
  }
  return config.topic;
}

// ─── HTTP helpers ───────────────────────────────────────────
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── Send ───────────────────────────────────────────────────
async function send(message, choices = null) {
  const topic = getTopic();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  const lines = [`[prompt-relay] ${id}`, '', message];

  if (choices && choices.length > 0) {
    lines.push('', 'Reply with:');
    choices.forEach((c, i) => lines.push(`  ${id}:${i + 1}  →  ${c}`));
    lines.push('', `Or type: ${id}:<number>`);
  }

  const body = lines.join('\n');

  const headers = {
    'Title': 'Input Required',
    'Tags': 'robot,question',
    'Priority': 'high',
  };

  // Add action buttons for choices
  if (choices && choices.length > 0) {
    const actions = choices.map((c, i) => {
      // User taps button → sends a message to the topic via ntfy POST
      return JSON.stringify({
        action: 'http',
        label: c,
        method: 'POST',
        url: `${NTFY_URL}/${topic}`,
        body: `${id}:${i + 1}`,
        headers: { 'Content-Type': 'text/plain' },
        clear: true,
      });
    });
    headers['Actions'] = actions.join(', ');
  }

  try {
    await httpRequest(`${NTFY_URL}/${topic}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body,
    });
    console.log(`\n  Sent to "${topic}" (id: ${id})`);
    console.log('  Check your phone.\n');
    return id;
  } catch (err) {
    console.error(`\n  Failed to send: ${err.message}\n`);
    process.exit(1);
  }
}

// ─── Listen ─────────────────────────────────────────────────
async function listen() {
  const topic = getTopic();
  let lastId = null;

  console.log(`\n  Listening on "${topic}"...`);
  console.log('  Send responses from your phone (format: promptId:choiceNumber)\n');
  console.log('  Press Ctrl+C to stop.\n');

  // Poll for new messages
  const poll = async () => {
    try {
      const url = lastId
        ? `${NTFY_URL}/${topic}/json?poll=1&since=${lastId}`
        : `${NTFY_URL}/${topic}/json?poll=1&since=1m`;

      const data = await httpRequest(url);

      if (Array.isArray(data)) {
        for (const msg of data) {
          if (msg.id) lastId = msg.id;
          if (msg.message) {
            const parsed = parseResponse(msg.message);
            if (parsed) {
              console.log(`  [RESPONSE] Prompt: ${parsed.id} → Choice: ${parsed.answer}`);
            }
          }
        }
      }
    } catch {
      // Silently retry
    }
  };

  setInterval(poll, 2000);
  await poll();
}

function parseResponse(text) {
  // Match patterns like "abc123:1" or "abc123:yes"
  const match = text.trim().match(/^([a-z0-9]+):(.+)$/i);
  if (match) {
    return { id: match[1], answer: match[2] };
  }
  return null;
}

// ─── Config wizard ──────────────────────────────────────────
async function config() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  console.log('\n  ─── prompt-relay setup ───\n');
  console.log('  1. Install "ntfy" from Play Store');
  console.log('  2. Open the app → tap "Subscribe to topic"');
  console.log('  3. Enter a topic name below (anything, e.g. "my-prompts")\n');

  const topic = (await ask('  Topic name: ')).trim();
  if (!topic) {
    console.error('  No topic entered. Aborting.\n');
    rl.close();
    return;
  }

  // Test connection
  console.log(`\n  Testing connection to ${NTFY_URL}/${topic}...`);
  try {
    await httpRequest(`${NTFY_URL}/${topic}/json?poll=1&since=1h`);
    console.log('  Connected!');
  } catch {
    console.log('  (Will connect when messages arrive)');
  }

  saveConfig({ topic, createdAt: new Date().toISOString() });
  console.log(`\n  Saved! Topic: ${topic}`);
  console.log('  You only need to do this once.\n');
  console.log('  Try it: node index.js send "Hello from laptop!"\n');
  rl.close();
}

// ─── Test ───────────────────────────────────────────────────
async function test() {
  await send('This is a test notification from prompt-relay.', ['OK', 'Got it']);
}

// ─── CLI ────────────────────────────────────────────────────
const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'config':
    config();
    break;
  case 'send': {
    const msg = args[0];
    if (!msg) {
      console.error('\n  Usage: node index.js send "Your message" [--choices A,B,C]\n');
      process.exit(1);
    }
    const choicesIdx = args.indexOf('--choices');
    const choices = choicesIdx >= 0 ? args[choicesIdx + 1]?.split(',') : null;
    send(msg, choices);
    break;
  }
  case 'listen':
    listen();
    break;
  case 'test':
    test();
    break;
  default:
    console.log(`
  prompt-relay — mobile notifications via ntfy.sh

  Commands:
    node index.js config              One-time setup (set topic)
    node index.js send "message"      Send a notification
    node index.js send "msg" --choices Yes,No,Maybe
    node index.js listen              Listen for responses
    node index.js test                Send test notification
    `);
}
