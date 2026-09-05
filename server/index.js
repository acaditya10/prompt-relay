const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Store pending prompts and responses
const pendingPrompts = new Map();
const completedResponses = new Map();
const connectedClients = new Set();

// ─── Socket.IO ──────────────────────────────────────────────
io.on('connection', (socket) => {
  connectedClients.add(socket.id);
  console.log(`[CONNECT] Mobile client connected: ${socket.id} (total: ${connectedClients.size})`);

  socket.emit('connected', {
    id: socket.id,
    pendingCount: pendingPrompts.size,
    message: 'Connected to opencode notify server'
  });

  socket.on('response', (data) => {
    const { promptId, response } = data;
    console.log(`[RESPONSE] Prompt ${promptId}: ${JSON.stringify(response)}`);

    // Store response
    completedResponses.set(promptId, {
      response,
      timestamp: Date.now(),
      clientId: socket.id
    });

    // Remove from pending
    pendingPrompts.delete(promptId);

    // Acknowledge
    socket.emit('responseAck', { promptId, status: 'received' });

    // Notify opencode via polling endpoint
    console.log(`[RESOLVED] Prompt ${promptId} resolved`);
  });

  socket.on('disconnect', () => {
    connectedClients.delete(socket.id);
    console.log(`[DISCONNECT] Mobile client disconnected: ${socket.id} (total: ${connectedClients.size})`);
  });
});

// ─── REST API (for opencode to call) ────────────────────────

// Health check
app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    connectedClients: connectedClients.size,
    pendingPrompts: pendingPrompts.size,
    uptime: process.uptime()
  });
});

// Send a prompt to the mobile app
// POST /api/prompt
// Body: { "message": "...", "choices": ["Yes","No"] } or { "message": "...", "type": "text" }
app.post('/api/prompt', (req, res) => {
  const { message, choices, type, timeout, meta } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (connectedClients.size === 0) {
    return res.status(503).json({ error: 'No mobile clients connected' });
  }

  const promptId = uuidv4();
  const prompt = {
    id: promptId,
    message,
    type: choices ? 'choice' : (type || 'text'),
    choices: choices || null,
    timeout: timeout || 300000, // 5 min default
    meta: meta || null,
    createdAt: Date.now()
  };

  pendingPrompts.set(promptId, prompt);

  // Push to all connected clients
  io.emit('prompt', prompt);

  console.log(`[PROMPT] Sent: "${message}" (${prompt.type}) id=${promptId}`);

  res.json({
    id: promptId,
    status: 'sent',
    connectedClients: connectedClients.size
  });
});

// Poll for a specific response (for opencode to check)
app.get('/api/prompt/:id', (req, res) => {
  const { id } = req.params;

  if (completedResponses.has(id)) {
    const result = completedResponses.get(id);
    completedResponses.delete(id); // Consume the response
    return res.json({ status: 'completed', response: result.response });
  }

  if (pendingPrompts.has(id)) {
    return res.json({ status: 'pending' });
  }

  res.status(404).json({ error: 'Prompt not found or expired' });
});

// List all pending prompts
app.get('/api/prompts', (req, res) => {
  const prompts = Array.from(pendingPrompts.values());
  res.json({ prompts, connectedClients: connectedClients.size });
});

// Cancel a pending prompt
app.delete('/api/prompt/:id', (req, res) => {
  const { id } = req.params;
  if (pendingPrompts.has(id)) {
    pendingPrompts.delete(id);
    io.emit('promptCancelled', { id });
    return res.json({ status: 'cancelled' });
  }
  res.status(404).json({ error: 'Prompt not found' });
});

// ─── Cleanup old responses every 10 min ─────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of completedResponses) {
    if (now - data.timestamp > 600000) { // 10 min
      completedResponses.delete(id);
    }
  }
  for (const [id, prompt] of pendingPrompts) {
    if (now - prompt.createdAt > prompt.timeout) {
      pendingPrompts.delete(id);
      console.log(`[TIMEOUT] Prompt ${id} expired`);
    }
  }
}, 60000);

// ─── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3077;
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         opencode-mobile-notify server                    ║
║                                                          ║
║  Local:   http://localhost:${PORT}                         ║
║  API:     http://localhost:${PORT}/api/status              ║
║                                                          ║
║  Next: Expose with ngrok:                                ║
║    ngrok http ${PORT}                                     ║
╚══════════════════════════════════════════════════════════╝
  `);
});
