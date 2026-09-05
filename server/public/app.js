const SWRegistration = '/sw.js';
const SERVER_URL = window.location.origin;

// ─── Socket.IO ──────────────────────────────────────────────
const socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: Infinity
});

// ─── DOM ────────────────────────────────────────────────────
const $statusBadge = document.getElementById('status-badge');
const $statusText = $statusBadge.querySelector('.status-text');
const $emptyState = document.getElementById('empty-state');
const $queue = document.getElementById('prompt-queue');
const $toast = document.getElementById('toast');

// ─── Connection ─────────────────────────────────────────────
socket.on('connect', () => {
  $statusBadge.className = 'status connected';
  $statusText.textContent = 'Connected';
  $emptyState.classList.toggle('hidden', $queue.children.length > 0);
  console.log('[WS] Connected:', socket.id);
});

socket.on('disconnect', () => {
  $statusBadge.className = 'status disconnected';
  $statusText.textContent = 'Reconnecting...';
  console.log('[WS] Disconnected');
});

socket.on('reconnect', () => {
  $statusBadge.className = 'status connected';
  $statusText.textContent = 'Connected';
});

// ─── Incoming Prompt ────────────────────────────────────────
socket.on('prompt', (prompt) => {
  console.log('[PROMPT]', prompt);
  addPromptCard(prompt);
  showNotification(prompt);
  vibrate();
});

socket.on('promptCancelled', ({ id }) => {
  const card = document.getElementById(`prompt-${id}`);
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'translateX(100px)';
    setTimeout(() => card.remove(), 300);
    updateEmptyState();
  }
});

// ─── Prompt Card ────────────────────────────────────────────
function addPromptCard(prompt) {
  const card = document.createElement('div');
  card.className = 'prompt-card new';
  card.id = `prompt-${prompt.id}`;

  const time = new Date(prompt.createdAt).toLocaleTimeString();
  const badgeClass = prompt.type === 'choice' ? 'choice' : 'text';
  const badgeLabel = prompt.type === 'choice' ? `${prompt.choices.length} options` : 'text input';

  card.innerHTML = `
    <div class="prompt-header">
      <span class="prompt-badge ${badgeClass}">${badgeLabel}</span>
      <span class="prompt-time">${time}</span>
    </div>
    <div class="prompt-message">${escapeHtml(prompt.message)}</div>
    <div class="prompt-body"></div>
  `;

  const body = card.querySelector('.prompt-body');

  if (prompt.type === 'choice' && prompt.choices) {
    const choicesDiv = document.createElement('div');
    choicesDiv.className = 'choices';
    prompt.choices.forEach((choice, i) => {
      const btn = document.createElement('button');
      btn.className = `choice-btn${i === 0 ? ' primary' : ''}`;
      btn.innerHTML = `<span class="choice-key">${i + 1}</span> ${escapeHtml(choice)}`;
      btn.onclick = () => sendChoice(prompt.id, choice, card);
      choicesDiv.appendChild(btn);
    });
    body.appendChild(choicesDiv);
  } else {
    // Free text input
    const inputArea = document.createElement('div');
    inputArea.className = 'text-input-area';
    inputArea.innerHTML = `
      <textarea class="text-input" placeholder="Type your response..." rows="3"></textarea>
      <button class="send-btn">Send</button>
    `;
    const textarea = inputArea.querySelector('textarea');
    const sendBtn = inputArea.querySelector('send-btn');
    sendBtn.onclick = () => sendText(prompt.id, textarea.value, card);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendText(prompt.id, textarea.value, card);
      }
    });
    body.appendChild(inputArea);
  }

  $queue.prepend(card);
  updateEmptyState();

  // Remove "new" highlight after 2s
  setTimeout(() => card.classList.remove('new'), 2000);
}

// ─── Send Response ──────────────────────────────────────────
function sendChoice(promptId, choice, card) {
  socket.emit('response', { promptId, response: choice });
  card.classList.add('responded');
  showToast(`Sent: ${choice}`, 'success');
  setTimeout(() => { card.remove(); updateEmptyState(); }, 1500);
}

function sendText(promptId, text, card) {
  if (!text.trim()) return;
  socket.emit('response', { promptId, response: text.trim() });
  card.classList.add('responded');
  showToast('Response sent', 'success');
  setTimeout(() => { card.remove(); updateEmptyState(); }, 1500);
}

// ─── Ack ────────────────────────────────────────────────────
socket.on('responseAck', ({ promptId, status }) => {
  console.log(`[ACK] Prompt ${promptId}: ${status}`);
});

// ─── Background Notification ────────────────────────────────
function showNotification(prompt) {
  if (document.visibilityState === 'visible') return; // Don't notify if app is open

  if ('serviceWorker' in navigator && 'Notification' in window) {
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification('opencode needs input', {
        body: prompt.message,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: `prompt-${prompt.id}`,
        data: { promptId: prompt.id },
        actions: prompt.type === 'choice'
          ? prompt.choices.slice(0, 3).map((c, i) => ({ action: `choice-${i}`, title: c }))
          : [{ action: 'open', title: 'Reply' }],
        requireInteraction: true,
        vibrate: [200, 100, 200]
      });
    });
  }
}

// ─── Helpers ────────────────────────────────────────────────
function updateEmptyState() {
  $emptyState.classList.toggle('hidden', $queue.children.length > 0);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(msg, type = '') {
  $toast.textContent = msg;
  $toast.className = `toast ${type}`;
  setTimeout(() => $toast.classList.add('hidden'), 3000);
}

function vibrate() {
  if ('vibrate' in navigator) {
    navigator.vibrate([200, 100, 200]);
  }
}

// ─── Service Worker ─────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(SWRegistration)
    .then((reg) => console.log('[SW] Registered'))
    .catch((err) => console.error('[SW] Failed:', err));

  // Listen for notification clicks from SW
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'NOTIFICATION_CLICK') {
      const { promptId } = event.data;
      window.focus();
    }
  });
}

// ─── Notification Permission ────────────────────────────────
if ('Notification' in window && Notification.permission === 'default') {
  // Will ask on first user interaction
  document.addEventListener('click', function askPerm() {
    Notification.requestPermission();
    document.removeEventListener('click', askPerm);
  }, { once: true });
}
