const API = {
  bootstrap: '/api/bootstrap',
  register: '/api/register',
  login: '/api/login',
  passwordResetRequest: '/api/password-reset/request',
  passwordResetConfirm: '/api/password-reset/confirm',
  createServer: '/api/server',
  deleteServer: '/api/server/delete',
  serverInvite: '/api/server/invite',
  joinServer: '/api/server/join',
  createCategory: '/api/category',
  createChannel: '/api/channel',
  changeRole: '/api/role',
  moderation: '/api/moderation',
  report: '/api/report',
  presence: '/api/presence',
  avatar: '/api/avatar',
  social: '/api/social',
  rtcConfig: '/api/rtc-config'
};

let ws = null;
let currentUser = null;
let appState = {
  servers: [],
  messages: {},
  directMessages: {},
  voicePresence: {},
  presence: {},
  users: [],
  social: { friends: [], blocked: [], incomingRequests: [], outgoingRequests: [] },
  callPresence: {},
  typingState: {},
  rtcIceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
let currentServerId = null;
let currentChannelId = null;
let currentVoiceChannelId = null;
let activeCallChannelId = null;
let activeSidebarTab = 'members';
let activeDmUser = null;
let unreadDmCounts = {};
let typingTimer = null;
let localStream = null;
let audioContext = null;
let notificationsEnabled = false;
let notificationCenter = [];
let speakingAnimationFrame = null;
const speakingUsers = new Set();
const speakingMeters = new Map();
const peerConnections = new Map();
const remoteStreams = new Map();
const peerDisconnectTimers = new Map();
const peerOfferState = new Map();
const pendingIceCandidates = new Map();
const makingOffers = new Set();
const ignoredOffers = new Set();
const announcedCallStarts = new Set();
let lastCallCapabilityMessage = '';
let pendingAttachment = null;
const pendingOutgoingMessages = new Map();

const serverList = document.getElementById('serverList');
const channelTree = document.getElementById('channelTree');
const currentLocation = document.getElementById('currentLocation');
const userBadge = document.getElementById('userBadge');
const serverInfoName = document.getElementById('serverInfoName');
const pinnedMessageText = document.getElementById('pinnedMessageText');
const presenceSelect = document.getElementById('presenceSelect');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatArea = document.getElementById('chatArea');
const memberList = document.getElementById('memberList');
const dmList = document.getElementById('dmList');
const voicePanel = document.getElementById('voicePanel');
const appShell = document.getElementById('appShell');
const channelsPanel = document.querySelector('.channels');
const mobileBackdrop = document.getElementById('mobileBackdrop');
const reportList = document.getElementById('reportList');
const pollList = document.getElementById('pollList');
const videoPanel = document.getElementById('videoPanel');
const callOverlay = document.getElementById('callOverlay');
const callTitle = document.getElementById('callTitle');
const callSubtitle = document.getElementById('callSubtitle');
const callStatusText = document.getElementById('callStatusText');
const callNotesText = document.getElementById('callNotesText');
const callParticipantList = document.getElementById('callParticipantList');
const minimizeCallBtn = document.getElementById('minimizeCallBtn');
const closeCallBtn = document.getElementById('closeCallBtn');
const joinVoiceFromCallBtn = document.getElementById('joinVoiceFromCallBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modal = document.getElementById('modal');
const createServerBtn = document.getElementById('createServerBtn');
const createCategoryBtn = document.getElementById('createCategoryBtn');
const createChannelBtn = document.getElementById('createChannelBtn');
const inviteServerBtn = document.getElementById('inviteServerBtn');
const joinServerBtn = document.getElementById('joinServerBtn');
const assignRoleBtn = document.getElementById('assignRoleBtn');
const moderateBtn = document.getElementById('moderateBtn');
const friendRequestsBtn = document.getElementById('friendRequestsBtn');
const reportBtn = document.getElementById('reportBtn');
const deleteServerBtn = document.getElementById('deleteServerBtn');
const joinVoiceBtn = document.getElementById('joinVoiceBtn');
const leaveVoiceBtn = document.getElementById('leaveVoiceBtn');
const logoutBtn = document.getElementById('logoutBtn');
const helperText = document.getElementById('helperText');
const permissionsList = document.getElementById('permissionsList');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const searchBtn = document.getElementById('searchBtn');
const notificationCenterBtn = document.getElementById('notificationCenterBtn');
const notificationBadge = document.getElementById('notificationBadge');
const pinBtn = document.getElementById('pinBtn');
const videoBtn = document.getElementById('videoBtn');
const membersToggleBtn = document.getElementById('membersToggleBtn');
const navHomeBtn = document.getElementById('navHomeBtn');
const navChatBtn = document.getElementById('navChatBtn');
const navGameBtn = document.getElementById('navGameBtn');
const navAppsBtn = document.getElementById('navAppsBtn');
const startVideoBtn = document.getElementById('startVideoBtn');
const endVideoBtn = document.getElementById('endVideoBtn');
const toggleMicBtn = document.getElementById('toggleMicBtn');
const toggleCameraBtn = document.getElementById('toggleCameraBtn');
const sidebar = document.querySelector('.sidebar');
const membersTabBtn = document.getElementById('membersTabBtn');
const dmTabBtn = document.getElementById('dmTabBtn');
const composerAddBtn = document.getElementById('composerAddBtn');
const membersPanelTitle = document.getElementById('membersPanelTitle');
const membersPanelSubtitle = document.getElementById('membersPanelSubtitle');
const membersCountPill = document.getElementById('membersCountPill');
const attachmentInput = document.getElementById('attachmentInput');

let currentTheme = localStorage.getItem('community-theme') || 'dark';
let micEnabled = true;
let cameraEnabled = true;
let lastSeenMarkers = {};

function isMobileLayout() {
  return window.matchMedia('(max-width: 860px)').matches;
}

function updateMobileBackdrop() {
  const visible = channelsPanel.classList.contains('mobile-open') || sidebar.classList.contains('mobile-open');
  mobileBackdrop.classList.toggle('visible', visible);
}

function closeMobilePanels() {
  channelsPanel.classList.remove('mobile-open');
  sidebar.classList.remove('mobile-open');
  updateMobileBackdrop();
}

function openMobilePanel(panel) {
  if (!isMobileLayout()) {
    return;
  }

  const openChannels = panel === 'channels';
  channelsPanel.classList.toggle('mobile-open', openChannels);
  sidebar.classList.toggle('mobile-open', !openChannels);
  updateMobileBackdrop();
}

function handleResponsiveLayout() {
  if (isMobileLayout()) {
    sidebar.classList.remove('hidden-panel');
  } else {
    closeMobilePanels();
  }
}

function applyTheme(theme) {
  currentTheme = theme;
  document.body.classList.toggle('light-mode', theme === 'light');
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  localStorage.setItem('community-theme', theme);
}

function request(url, options = {}) {
  return fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Request failed');
    }
    return data;
  });
}

function lastSeenStorageKey() {
  return `community-last-seen:${currentUser || 'guest'}`;
}

function loadLastSeenMarkers() {
  try {
    lastSeenMarkers = JSON.parse(localStorage.getItem(lastSeenStorageKey()) || '{}');
    if (!lastSeenMarkers || typeof lastSeenMarkers !== 'object') {
      lastSeenMarkers = {};
    }
  } catch {
    lastSeenMarkers = {};
  }
}

function saveLastSeenMarkers() {
  localStorage.setItem(lastSeenStorageKey(), JSON.stringify(lastSeenMarkers));
}

function conversationKey() {
  return activeSidebarTab === 'dm' && activeDmUser
    ? `dm:${activeDmUser}`
    : `channel:${currentChannelId}`;
}

function getUnreadBoundary(list) {
  const key = conversationKey();
  const lastSeenTime = lastSeenMarkers[key] || 0;
  if (!lastSeenTime) {
    return -1;
  }
  return list.findIndex((message) => message.time > lastSeenTime && message.user !== currentUser);
}

function markConversationSeen() {
  const list = getActiveConversationMessages();
  const latest = [...list].reverse().find((message) => message.user !== currentUser) || list[list.length - 1];
  if (!latest) {
    return;
  }
  lastSeenMarkers[conversationKey()] = latest.time;
  saveLastSeenMarkers();
}

function notificationStorageKey() {
  return `community-notifications:${currentUser || 'guest'}`;
}

function loadNotificationCenter() {
  try {
    notificationCenter = JSON.parse(localStorage.getItem(notificationStorageKey()) || '[]');
    if (!Array.isArray(notificationCenter)) {
      notificationCenter = [];
    }
  } catch {
    notificationCenter = [];
  }
}

function saveNotificationCenter() {
  localStorage.setItem(notificationStorageKey(), JSON.stringify(notificationCenter.slice(0, 40)));
}

function isUserSpeaking(username) {
  return speakingUsers.has(username);
}

function ensureAudioContext() {
  audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

function stopSpeakingMonitor(username) {
  const meter = speakingMeters.get(username);
  if (!meter) {
    return;
  }
  try {
    meter.source.disconnect();
    meter.analyser.disconnect();
  } catch {
    // ignore disconnect issues
  }
  speakingMeters.delete(username);
  if (speakingUsers.delete(username)) {
    renderVoicePanel();
    renderVideoPanel();
  }
}

function runSpeakingLoop() {
  if (!speakingMeters.size) {
    speakingAnimationFrame = null;
    return;
  }

  let changed = false;
  speakingMeters.forEach((meter, username) => {
    meter.analyser.getByteFrequencyData(meter.data);
    const average = meter.data.reduce((sum, value) => sum + value, 0) / meter.data.length;
    const speaking = average > 18;
    if (speaking && !speakingUsers.has(username)) {
      speakingUsers.add(username);
      changed = true;
    } else if (!speaking && speakingUsers.has(username)) {
      speakingUsers.delete(username);
      changed = true;
    }
  });

  if (changed) {
    renderVoicePanel();
    renderVideoPanel();
  }

  speakingAnimationFrame = requestAnimationFrame(runSpeakingLoop);
}

function startSpeakingMonitor(stream, username) {
  if (!stream?.getAudioTracks().length) {
    return;
  }
  stopSpeakingMonitor(username);
  try {
    const ctx = ensureAudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.72;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    speakingMeters.set(username, {
      analyser,
      source,
      data: new Uint8Array(analyser.frequencyBinCount)
    });
    if (!speakingAnimationFrame) {
      speakingAnimationFrame = requestAnimationFrame(runSpeakingLoop);
    }
  } catch {
    // ignore analyser issues in unsupported browsers
  }
}

function renderNotificationBadge() {
  if (!notificationBadge) {
    return;
  }
  const unread = notificationCenter.filter((item) => !item.read).length;
  notificationBadge.textContent = String(unread);
  notificationBadge.classList.toggle('hidden', unread === 0);
}

function addNotification(type, title, text) {
  notificationCenter.unshift({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    title,
    text,
    time: Date.now(),
    read: false
  });
  notificationCenter = notificationCenter.slice(0, 40);
  saveNotificationCenter();
  renderNotificationBadge();
}

function markNotificationsRead() {
  notificationCenter = notificationCenter.map((item) => ({ ...item, read: true }));
  saveNotificationCenter();
  renderNotificationBadge();
}

function showNotificationCenter() {
  const items = notificationCenter.length
    ? notificationCenter.map((item) => `
        <div class="notification-card ${item.read ? '' : 'unread'}">
          <div class="notification-card-head">
            <div class="notification-title">${escapeHtml(item.title)}</div>
            <div class="notification-time">${formatTime(item.time)}</div>
          </div>
          <div class="notification-type">${escapeHtml(item.type)}</div>
          <div class="panel-subtitle">${escapeHtml(item.text)}</div>
        </div>
      `).join('')
    : '<div class="empty-state">Henuz bildirim yok.</div>';

  showModal(`
    <h2>Bildirim Merkezi</h2>
    <div class="action-grid">
      <button id="markNotificationsReadBtn" class="modal-btn secondary">Tumunu Okundu Yap</button>
      <button id="clearNotificationsBtn" class="modal-btn secondary">Temizle</button>
    </div>
    <div class="notification-list">${items}</div>
  `);

  document.getElementById('markNotificationsReadBtn').onclick = () => {
    markNotificationsRead();
    showNotificationCenter();
  };
  document.getElementById('clearNotificationsBtn').onclick = () => {
    notificationCenter = [];
    saveNotificationCenter();
    renderNotificationBadge();
    showNotificationCenter();
  };

  markNotificationsRead();
}

function resizeImageFile(file, maxSize = 320, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    if (!file.type.startsWith('image/')) {
      reject(new Error('Lutfen bir gorsel sec.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');

        if (!context) {
          resolve(reader.result);
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      image.onerror = () => reject(new Error('Gorsel okunamadi.'));
      image.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Dosya okunamadi.'));
    reader.readAsDataURL(file);
  });
}

function getCurrentServer() {
  return appState.servers.find((server) => server.id === currentServerId);
}

function getCurrentChannel() {
  const server = getCurrentServer();
  if (!server) {
    return null;
  }

  for (const category of server.categories) {
    for (const channel of category.channels) {
      if (channel.id === currentChannelId) {
        return channel;
      }
    }
  }

  return null;
}

function findVisibleChannel(channelId) {
  for (const server of appState.servers) {
    for (const category of server.categories || []) {
      const channel = (category.channels || []).find((item) => item.id === channelId);
      if (channel) {
        return { server, channel };
      }
    }
  }
  return null;
}

function getCurrentVoiceMembers() {
  return appState.voicePresence[currentVoiceChannelId] || [];
}

function mySocial() {
  return appState.social || { friends: [], blocked: [], incomingRequests: [], outgoingRequests: [] };
}

function isFriend(username) {
  return mySocial().friends.includes(username);
}

function isBlockedUser(username) {
  return mySocial().blocked.includes(username);
}

function hasIncomingRequest(username) {
  return mySocial().incomingRequests.includes(username);
}

function hasOutgoingRequest(username) {
  return mySocial().outgoingRequests.includes(username);
}

function getCurrentCallMembers() {
  return appState.callPresence[activeCallChannelId || currentChannelId] || [];
}

function getActiveConversationMessages() {
  if (activeSidebarTab === 'dm' && activeDmUser) {
    return appState.directMessages[activeDmUser] || [];
  }
  const channel = getCurrentChannel();
  return channel ? (appState.messages[channel.id] || []) : [];
}

function createClientMessageId() {
  return `client_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeMessageList(existingMessages = [], incomingMessages = []) {
  const merged = [...existingMessages];

  incomingMessages.forEach((incoming) => {
    const index = merged.findIndex((message) => (
      message.id === incoming.id
      || (incoming.clientId && message.clientId === incoming.clientId)
      || (incoming.clientId && message.id === incoming.clientId)
    ));

    if (index >= 0) {
      merged[index] = { ...incoming, pending: false };
      if (incoming.clientId) {
        pendingOutgoingMessages.delete(incoming.clientId);
      }
      return;
    }

    merged.push({ ...incoming, pending: false });
  });

  return merged;
}

function removePendingMessage(clientId) {
  const pending = pendingOutgoingMessages.get(clientId);
  if (!pending) {
    return;
  }

  if (pending.scope === 'dm') {
    appState.directMessages[pending.peerUsername] = (appState.directMessages[pending.peerUsername] || [])
      .filter((message) => message.clientId !== clientId && message.id !== clientId);
  } else {
    appState.messages[pending.channelId] = (appState.messages[pending.channelId] || [])
      .filter((message) => message.clientId !== clientId && message.id !== clientId);
  }
  pendingOutgoingMessages.delete(clientId);
  renderMessages();
}

function dmScopeKey(username) {
  return `dm:${[currentUser, username].sort().join('__')}`;
}

function showToast(message) {
  helperText.textContent = message;
}

function syncSocialState(nextSocial) {
  appState.social = nextSocial || { friends: [], blocked: [], incomingRequests: [], outgoingRequests: [] };
  if (friendRequestsBtn) {
    friendRequestsBtn.textContent = mySocial().incomingRequests.length
      ? `Istekler (${mySocial().incomingRequests.length})`
      : 'Istekler';
  }
}

function isSecureMediaContext() {
  return window.isSecureContext || ['localhost', '127.0.0.1'].includes(location.hostname);
}

function explainMediaError(error) {
  if (!isSecureMediaContext()) {
    return 'Goruntulu konusma icin guvenli baglanti gerekli. Bu ozelligi localhost veya HTTPS adresinde ac.';
  }

  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Tarayici kamera veya mikrofon iznini engelledi. Adres cubugundan izin verip tekrar dene.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Kamera veya mikrofon bulunamadi.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Kamera veya mikrofon baska bir uygulama tarafindan kullaniliyor olabilir.';
  }
  return 'Goruntulu konusma baslatilamadi.';
}

async function ensureNotificationsEnabled() {
  if (!('Notification' in window)) {
    return false;
  }

  if (Notification.permission === 'granted') {
    notificationsEnabled = true;
    return true;
  }

  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    notificationsEnabled = permission === 'granted';
    return notificationsEnabled;
  }

  return false;
}

function showBrowserNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  try {
    const notification = new Notification(title, { body });
    setTimeout(() => notification.close(), 4000);
  } catch {
    // Ignore notification errors in unsupported browser contexts.
  }
}

function playNotificationSound() {
  try {
    const ctx = ensureAudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.18);
  } catch {
    // Browser may block audio until user interaction.
  }
}

function showModal(html, variant = 'default') {
  if (variant === 'auth') {
    modal.innerHTML = `
      <div class="auth-grid"></div>
      <div class="auth-orbit"></div>
      <div class="auth-orbit-two"></div>
      ${html}
    `;
  } else {
    modal.innerHTML = html;
  }
  modal.classList.toggle('auth-modal', variant === 'auth');
  modalOverlay.classList.toggle('auth-overlay', variant === 'auth');
  modalOverlay.classList.remove('hidden');
}

function hideModal() {
  modal.classList.remove('auth-modal');
  modalOverlay.classList.remove('auth-overlay');
  modalOverlay.classList.add('hidden');
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDateLabel(timestamp) {
  return new Date(timestamp).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function userInitials(username) {
  return (username || '?').trim().slice(0, 1).toUpperCase();
}

function turkceDurum(status) {
  const map = { online: 'cevrimici', offline: 'cevrimdisi', away: 'uzakta', busy: 'mesgul' };
  return map[status] || status;
}

function turkceRol(role) {
  const map = { admin: 'yonetici', mod: 'moderatör', member: 'uye' };
  return map[role] || role;
}

function getUserRecord(username) {
  return appState.users.find((user) => user.username === username) || null;
}

function avatarMarkup(username, className = 'message-avatar') {
  const user = getUserRecord(username);
  if (user?.avatar) {
    return `<img class="${className} avatar-image" src="${user.avatar}" alt="${escapeHtml(username)}" />`;
  }
  return `<div class="${className}">${userInitials(username)}</div>`;
}

function myRole() {
  const server = getCurrentServer();
  return server?.members.find((member) => member.username === currentUser)?.role || 'member';
}

function canManageMessage(message) {
  return message.user === currentUser || ['admin', 'mod'].includes(myRole());
}

function roleBadgeMarkup(username) {
  const server = getCurrentServer();
  const role = server?.members.find((member) => member.username === username)?.role || 'member';
  return `<span class="role-badge ${role}">${escapeHtml(turkceRol(role))}</span>`;
}

function getPinnedMessage() {
  const list = getActiveConversationMessages();
  const server = getCurrentServer();
  const pinnedIds = server?.pinnedMessageIds || [];
  const pinnedSource = list.find((message) => pinnedIds.includes(message.id)) || list.find((message) => message.user === 'admin' || message.user === 'system' || message.user === 'bot') || list[0];
  if (!pinnedSource) {
    return 'Bu alanda sabitlenecek onemli mesaj henuz yok.';
  }
  return pinnedSource.text || pinnedSource.attachment?.name || 'Sabitlenmis mesaj';
}

function wsProtocol() {
  return location.protocol === 'https:' ? 'wss' : 'ws';
}

function closePeerConnection(username) {
  const disconnectTimer = peerDisconnectTimers.get(username);
  if (disconnectTimer) {
    clearTimeout(disconnectTimer);
    peerDisconnectTimers.delete(username);
  }
  const pc = peerConnections.get(username);
  if (pc) {
    pc.close();
    peerConnections.delete(username);
  }
  remoteStreams.delete(username);
  stopSpeakingMonitor(username);
  peerOfferState.delete(username);
  pendingIceCandidates.delete(username);
  makingOffers.delete(username);
  ignoredOffers.delete(username);
}

function schedulePeerDisconnect(username) {
  const existing = peerDisconnectTimers.get(username);
  if (existing) {
    clearTimeout(existing);
  }
  const timeout = setTimeout(() => {
    closePeerConnection(username);
    renderVideoPanel();
  }, 6000);
  peerDisconnectTimers.set(username, timeout);
}

function clearPeerDisconnect(username) {
  const timeout = peerDisconnectTimers.get(username);
  if (timeout) {
    clearTimeout(timeout);
    peerDisconnectTimers.delete(username);
  }
}

function upsertRemoteStream(username, incomingStream) {
  const existingStream = remoteStreams.get(username);
  if (!existingStream) {
    remoteStreams.set(username, incomingStream);
    return incomingStream;
  }

  incomingStream.getTracks().forEach((track) => {
    if (!existingStream.getTracks().some((item) => item.id === track.id)) {
      existingStream.addTrack(track);
    }
  });
  remoteStreams.set(username, existingStream);
  return existingStream;
}

function attachStreamToVideo(element, stream, muted = false) {
  if (!element || !stream) {
    return;
  }
  if (element.srcObject !== stream) {
    element.srcObject = stream;
  }
  element.muted = muted;
  const playPromise = element.play?.();
  if (playPromise?.catch) {
    playPromise.catch(() => {});
  }
}

function isPeerConnected(pc) {
  return ['connected', 'completed'].includes(pc?.iceConnectionState) || ['connected', 'completed'].includes(pc?.connectionState);
}

function queueIceCandidate(username, candidate) {
  pendingIceCandidates.set(username, [...(pendingIceCandidates.get(username) || []), candidate]);
}

async function flushIceCandidates(username, pc) {
  const candidates = pendingIceCandidates.get(username) || [];
  if (!candidates.length || !pc.remoteDescription) {
    return;
  }
  pendingIceCandidates.delete(username);
  for (const candidate of candidates) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore stale candidates from replaced connections.
    }
  }
}

function cleanupCallUi() {
  remoteStreams.clear();
  [...peerConnections.keys()].forEach(closePeerConnection);
  [...speakingMeters.keys()].forEach(stopSpeakingMonitor);
  micEnabled = true;
  cameraEnabled = true;
  lastCallCapabilityMessage = '';
  renderVideoPanel();
}

function openCallPanel() {
  callOverlay.classList.remove('hidden');
  renderVideoPanel();
}

function closeCallPanel() {
  callOverlay.classList.add('hidden');
}

function renderVideoPanel() {
  const participants = getCurrentCallMembers();
  const hasCall = Boolean(localStream || participants.length || remoteStreams.size);
  const hasAudioTrack = Boolean(localStream?.getAudioTracks().length);
  const hasVideoTrack = Boolean(localStream?.getVideoTracks().length);
  const callChannel = getCurrentServer()?.categories
    .flatMap((category) => category.channels)
    .find((channel) => channel.id === (activeCallChannelId || currentChannelId));
  const cameraCount = Number(Boolean(localStream?.getVideoTracks().length)) + remoteStreams.size;
  const micCount = Number(Boolean(localStream?.getAudioTracks().length)) + participants.filter((username) => username !== currentUser).length;

  callTitle.textContent = `Voice / ${callChannel?.name || 'sesli oda'}`;
  callSubtitle.textContent = `${participants.length || Number(Boolean(localStream))} kisi | ${cameraCount} kamera | ${micCount} mikrofon`;
  callStatusText.textContent = hasCall
    ? `${callChannel?.name || 'Sesli oda'} kanalinda cagri acik.`
    : 'Henuz aktif goruntulu konusma yok. Voice kanala girip buradan cagri baslat.';
  callNotesText.textContent = lastCallCapabilityMessage || (localStream
    ? 'Kamera baglandi. Katilimcilar baglandikca sahnede gorunur.'
    : 'Yerel kamera henuz baglanmadi. Kamera izni verip Goruntulu Baslat dugmesine bas.');
  toggleMicBtn.textContent = hasAudioTrack ? (micEnabled ? 'Mikrofon Acik' : 'Mikrofon Kapali') : 'Mikrofon Yok';
  toggleCameraBtn.textContent = hasVideoTrack ? (cameraEnabled ? 'Kamera Acik' : 'Kamera Kapali') : 'Kamera Yok';
  toggleMicBtn.disabled = !hasAudioTrack;
  toggleCameraBtn.disabled = !hasVideoTrack;

  callParticipantList.innerHTML = participants.length
    ? participants.map((username) => `
        <div class="call-participant">
          ${avatarMarkup(username, 'member-avatar')}
          <span>${escapeHtml(username)}${username === currentUser ? ' (sen)' : ''}</span>
        </div>
      `).join('')
    : '<div class="empty-state">Henuz katilimci yok.</div>';

  if (!hasCall) {
    const secureHint = isSecureMediaContext()
      ? 'Henuz aktif gorusme yok. Ayni kanaldaki iki kullanici Baslat ile gorusmeye girebilir.'
      : 'Bu adres guvenli degil. Goruntulu konusma icin localhost veya HTTPS kullan.';
    videoPanel.innerHTML = `
      <div class="call-empty">
        <strong>Canli sahne hazir</strong>
        <span>${escapeHtml(lastCallCapabilityMessage || secureHint)}</span>
      </div>
    `;
    return;
  }

  const cards = [];
  if (localStream) {
    cards.push(`
      <div class="video-card ${isUserSpeaking(currentUser) ? 'speaking' : ''}">
        <video id="localVideo" autoplay muted playsinline></video>
        <div class="video-label">Sen ${isUserSpeaking(currentUser) ? '• konusuyor' : ''}</div>
      </div>
    `);
  }

  for (const [username] of remoteStreams.entries()) {
    cards.push(`
      <div class="video-card ${isUserSpeaking(username) ? 'speaking' : ''}">
        <video id="remoteVideo_${username}" autoplay playsinline></video>
        <div class="video-label">${escapeHtml(username)} ${isUserSpeaking(username) ? '• konusuyor' : ''}</div>
      </div>
    `);
  }

  if (!cards.length) {
    cards.push(`
      <div class="call-empty">
        <strong>Cagri acik</strong>
        <span>Diger katilimcilari bekliyorsun.</span>
      </div>
    `);
  }

  videoPanel.innerHTML = `
    <div class="video-grid">${cards.join('')}</div>
  `;

  if (localStream) {
    const localVideo = document.getElementById('localVideo');
    if (localVideo) {
      attachStreamToVideo(localVideo, localStream, true);
    }
  }

  for (const [username, stream] of remoteStreams.entries()) {
    const el = document.getElementById(`remoteVideo_${username}`);
    if (el) {
      attachStreamToVideo(el, stream, false);
    }
  }
}

function createPeerConnection(peerUsername) {
  if (peerConnections.has(peerUsername)) {
    return peerConnections.get(peerUsername);
  }

  const pc = new RTCPeerConnection({
    iceServers: appState.rtcIceServers
  });

  if (localStream) {
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  }

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({
        type: 'webrtcSignal',
        username: currentUser,
        target: peerUsername,
        channelId: activeCallChannelId || currentChannelId,
        signal: { type: 'candidate', candidate: event.candidate }
      }));
    }
  };

  pc.ontrack = (event) => {
    const stream = upsertRemoteStream(peerUsername, event.streams[0]);
    startSpeakingMonitor(stream, peerUsername);
    renderVideoPanel();
  };

  pc.onconnectionstatechange = () => {
    if (['connecting', 'connected', 'completed'].includes(pc.connectionState)) {
      clearPeerDisconnect(peerUsername);
      if (['connected', 'completed'].includes(pc.connectionState)) {
        peerOfferState.set(peerUsername, 'connected');
      }
      return;
    }
    if (pc.connectionState === 'disconnected') {
      schedulePeerDisconnect(peerUsername);
      return;
    }
    if (['failed', 'closed'].includes(pc.connectionState)) {
      closePeerConnection(peerUsername);
      renderVideoPanel();
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      try {
        pc.restartIce();
      } catch {
        closePeerConnection(peerUsername);
        renderVideoPanel();
      }
    }
  };

  peerConnections.set(peerUsername, pc);
  return pc;
}

async function ensureLocalMedia() {
  if (localStream) {
    return localStream;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Bu tarayici kamera/mikrofon erisimini desteklemiyor.');
  }

  if (!isSecureMediaContext()) {
    throw new Error('Goruntulu konusma icin guvenli baglanti gerekli. localhost veya HTTPS kullan.');
  }

  const attempts = [
    { video: true, audio: true, label: '' },
    { video: true, audio: false, label: 'Mikrofon izni olmadigi icin sadece kamera acildi.' },
    { video: false, audio: true, label: 'Kamera izni olmadigi icin sadece mikrofon acildi.' }
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia(attempt);
      micEnabled = Boolean(localStream.getAudioTracks().length);
      cameraEnabled = Boolean(localStream.getVideoTracks().length);
      lastCallCapabilityMessage = attempt.label;
      startSpeakingMonitor(localStream, currentUser);
      renderVideoPanel();
      return localStream;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Kamera veya mikrofon acilamadi.');
}

async function initiateOffer(peerUsername) {
  const pc = createPeerConnection(peerUsername);
  const offerState = peerOfferState.get(peerUsername);
  if (offerState === 'pending') {
    return;
  }
  if (pc.signalingState !== 'stable') {
    return;
  }
  try {
    makingOffers.add(peerUsername);
    peerOfferState.set(peerUsername, 'pending');
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({
      type: 'webrtcSignal',
      username: currentUser,
      target: peerUsername,
      channelId: activeCallChannelId || currentChannelId,
      signal: { type: 'offer', sdp: offer }
    }));
    peerOfferState.set(peerUsername, 'sent');
  } finally {
    makingOffers.delete(peerUsername);
  }
}

async function handleIncomingSignal(data) {
  const { from, signal } = data;
  if (data.channelId && activeCallChannelId && data.channelId !== activeCallChannelId) {
    return;
  }
  if (signal.type === 'offer' && data.channelId) {
    activeCallChannelId = data.channelId;
  }
  try {
    await ensureLocalMedia();
  } catch (error) {
    showToast(explainMediaError(error));
    return;
  }
  const pc = createPeerConnection(from);

  if (signal.type === 'offer') {
    const polite = currentUser > from;
    const offerCollision = makingOffers.has(from) || pc.signalingState !== 'stable';
    ignoredOffers.delete(from);
    if (offerCollision && !polite) {
      ignoredOffers.add(from);
      return;
    }
    if (offerCollision && polite) {
      await pc.setLocalDescription({ type: 'rollback' });
    }
    peerOfferState.set(from, 'received');
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    await flushIceCandidates(from, pc);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({
      type: 'webrtcSignal',
      username: currentUser,
      target: from,
      channelId: activeCallChannelId || currentChannelId,
      signal: { type: 'answer', sdp: answer }
    }));
    return;
  }

  if (signal.type === 'answer') {
    if (pc.signalingState === 'stable') {
      return;
    }
    await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    await flushIceCandidates(from, pc);
    peerOfferState.set(from, 'connected');
    return;
  }

  if (signal.type === 'candidate' && signal.candidate) {
    if (ignoredOffers.has(from)) {
      return;
    }
    if (!pc.remoteDescription) {
      queueIceCandidate(from, signal.candidate);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch {
      // Ignore transient ICE timing issues in this MVP.
    }
  }
}

function renderServers() {
  serverList.innerHTML = '';
  appState.servers.forEach((server) => {
    const button = document.createElement('button');
    button.className = `server-pill ${server.id === currentServerId ? 'active' : ''}`;
    button.textContent = server.name.slice(0, 2).toUpperCase();
    button.title = server.name;
    button.onclick = () => switchServer(server.id);
    serverList.appendChild(button);
  });
}

function renderChannels() {
  const server = getCurrentServer();
  channelTree.innerHTML = '';

  if (!server) {
    return;
  }

  server.categories.forEach((category) => {
    const group = document.createElement('div');
    group.className = 'channel-group';

    const title = document.createElement('div');
    title.className = 'channel-group-title';
    title.textContent = category.name;
    group.appendChild(title);

    category.channels.forEach((channel) => {
      const item = document.createElement('button');
      item.className = `channel-item ${channel.id === currentChannelId ? 'active' : ''}`;
      item.innerHTML = `<span>${channel.kind === 'voice' ? '🔊' : '#'}</span><span>${channel.name}</span>`;
      item.onclick = () => switchChannel(channel.id);
      group.appendChild(item);
    });

    channelTree.appendChild(group);
  });
}

function renderHeader() {
  const server = getCurrentServer();
  const channel = getCurrentChannel();
  if (!server || !channel) {
    return;
  }

  currentLocation.textContent = activeSidebarTab === 'dm' && activeDmUser
    ? `Mesaj / ${activeDmUser}`
    : `${channel.kind === 'voice' ? '🔊' : '#'} ${channel.name}`;
  const me = server.members.find((member) => member.username === currentUser);
  userBadge.textContent = `${currentUser} (${turkceRol(me?.role || 'member')})`;
  serverInfoName.textContent = server.name;
  helperText.textContent = activeSidebarTab === 'dm'
    ? 'Direkt mesaj alani'
    : (channel.kind === 'voice' ? 'Sesli oda kanali' : 'Topluluk yazi kanali');
  pinnedMessageText.textContent = getPinnedMessage();
  deleteServerBtn.style.display = server.isCreator ? 'inline-flex' : 'none';
}

function renderMessages() {
  chatArea.innerHTML = '';
  const list = getActiveConversationMessages();
  if (!list.length) {
    const channel = getCurrentChannel();
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.innerHTML = `
      <strong>${escapeHtml(activeSidebarTab === 'dm' && activeDmUser ? `${activeDmUser} ile ozel mesaj` : `${channel?.name || 'kanal'} alanina hos geldin`)}</strong>
      <div>${escapeHtml(activeSidebarTab === 'dm' ? `${activeDmUser} ile ozel mesajlasma buradan gorunur.` : '')}</div>
      <div>${escapeHtml(activeSidebarTab === 'dm' ? 'Bu ozel konusmada henuz mesaj yok. Ilk mesaji gondererek akisi baslatabilirsin.' : 'Bu kanalda henuz mesaj yok. Toplulugu baslatmak icin ilk mesaji sen gonderebilirsin.')}</div>
    `;
    chatArea.appendChild(empty);
    return;
  }

  let lastDateKey = '';
  const unreadBoundaryIndex = getUnreadBoundary(list);
  const server = getCurrentServer();
  const pinnedIds = server?.pinnedMessageIds || [];
  list.forEach((message, index) => {
    const messageDateKey = new Date(message.time).toDateString();
    if (messageDateKey !== lastDateKey) {
      const divider = document.createElement('div');
      divider.className = 'date-divider';
      divider.textContent = formatDateLabel(message.time);
      chatArea.appendChild(divider);
      lastDateKey = messageDateKey;
    }

    if (index === unreadBoundaryIndex) {
      const unreadDivider = document.createElement('div');
      unreadDivider.className = 'unread-divider';
      unreadDivider.textContent = 'Okunmamis mesajlar';
      chatArea.appendChild(unreadDivider);
    }

    const row = document.createElement('div');
    const mentionedMe = message.user !== currentUser && messageMentionsUser(message.text, currentUser);
    row.className = `message-row ${mentionedMe ? 'mention-highlight' : ''} ${message.pending ? 'pending-message' : ''}`;
    const reactions = message.pending ? '' : Object.entries(message.reactions || {})
      .map(([emoji, users]) => {
        const active = users.includes(currentUser) ? 'active' : '';
        return `<button class="reaction-chip ${active}" data-message-id="${message.id}" data-emoji="${emoji}">${emoji} ${users.length}</button>`;
      })
      .join('');
    const controls = !message.pending && canManageMessage(message)
      ? `
        <div class="message-controls">
          ${['admin', 'mod'].includes(myRole()) ? `<button class="tiny-action" data-action="pin" data-message-id="${message.id}">${pinnedIds.includes(message.id) ? 'Pinden Cikar' : 'Pinle'}</button>` : ''}
          <button class="tiny-action" data-action="edit" data-message-id="${message.id}">Duzenle</button>
          <button class="tiny-action danger" data-action="delete" data-message-id="${message.id}">Sil</button>
        </div>
      `
      : '';
    const attachment = message.attachment
      ? `
        <div class="attachment-card">
          ${message.attachment.type?.startsWith('image/')
            ? `<img class="attachment-image" src="${message.attachment.data}" alt="${escapeHtml(message.attachment.name || 'gorsel')}" />`
            : `<div class="attachment-file">📎 ${escapeHtml(message.attachment.name || 'dosya')}</div>`}
          <a class="attachment-link" href="${message.attachment.data}" download="${escapeHtml(message.attachment.name || 'dosya')}">Indir</a>
        </div>
      `
      : '';
    row.innerHTML = `
      ${avatarMarkup(message.user)}
      <div class="message-content">
        <div class="message-meta">
          <span class="message-author">${escapeHtml(message.user)}</span>
          ${roleBadgeMarkup(message.user)}
          <span>${formatTime(message.time)}</span>
          ${message.pending ? '<span>gonderiliyor...</span>' : ''}
          ${message.editedAt ? '<span>(duzenlendi)</span>' : ''}
          ${activeSidebarTab === 'dm' && message.user === currentUser && activeDmUser
            ? `<span>${(message.seenBy || []).includes(activeDmUser) ? 'goruldu' : 'gonderildi'}</span>`
            : ''}
          ${mentionedMe ? '<span class="mention-badge">@sen</span>' : ''}
        </div>
        <div class="message-stack">
          <div class="message-body">${escapeHtml(message.text)}</div>
          ${attachment}
          <div class="reactions-row">${reactions}</div>
          <div class="message-actions-row">
            <div class="reaction-palette ${message.pending ? 'hidden' : ''}">
              <button class="emoji-btn" data-message-id="${message.id}" data-emoji="👍">👍</button>
              <button class="emoji-btn" data-message-id="${message.id}" data-emoji="❤️">❤️</button>
              <button class="emoji-btn" data-message-id="${message.id}" data-emoji="😂">😂</button>
              <button class="emoji-btn" data-message-id="${message.id}" data-emoji="😮">😮</button>
              <button class="emoji-btn" data-message-id="${message.id}" data-emoji="👏">👏</button>
            </div>
            ${controls}
          </div>
        </div>
      </div>
    `;
    chatArea.appendChild(row);
  });

  chatArea.querySelectorAll('.emoji-btn').forEach((button) => {
    button.onclick = () => {
      ws.send(JSON.stringify({
        type: 'react',
        serverId: currentServerId,
        channelId: currentChannelId,
        username: currentUser,
        messageId: button.dataset.messageId,
        emoji: button.dataset.emoji
      }));
    };
  });

  chatArea.querySelectorAll('.reaction-chip').forEach((button) => {
    button.onclick = () => {
      ws.send(JSON.stringify({
        type: 'react',
        serverId: currentServerId,
        channelId: currentChannelId,
        username: currentUser,
        messageId: button.dataset.messageId,
        emoji: button.dataset.emoji
      }));
    };
  });

  chatArea.querySelectorAll('.tiny-action').forEach((button) => {
    button.onclick = () => {
      const messageId = button.dataset.messageId;
      const action = button.dataset.action;
      if (action === 'delete') {
        ws.send(JSON.stringify({
          type: 'deleteMessage',
          serverId: currentServerId,
          channelId: currentChannelId,
          username: currentUser,
          messageId
        }));
        return;
      }

      if (action === 'pin') {
        ws.send(JSON.stringify({
          type: 'pinMessage',
          serverId: currentServerId,
          channelId: currentChannelId,
          username: currentUser,
          messageId
        }));
        return;
      }

      const targetMessage = (appState.messages[currentChannelId] || []).find((message) => message.id === messageId);
      const nextText = prompt('Mesaji duzenle:', targetMessage?.text || '');
      if (nextText && nextText.trim()) {
        ws.send(JSON.stringify({
          type: 'editMessage',
          serverId: currentServerId,
          channelId: currentChannelId,
          username: currentUser,
          messageId,
          text: nextText.trim()
        }));
      }
    };
  });

  chatArea.scrollTop = chatArea.scrollHeight;
}

function renderMembers() {
  const server = getCurrentServer();
  memberList.innerHTML = '';
  if (!server) {
    return;
  }

  const sortedMembers = [...server.members].sort((a, b) => {
    const presenceOrder = { online: 0, away: 1, busy: 2, offline: 3 };
    const aPresence = appState.presence[a.username]?.status || 'offline';
    const bPresence = appState.presence[b.username]?.status || 'offline';
    const diff = (presenceOrder[aPresence] ?? 4) - (presenceOrder[bPresence] ?? 4);
    if (diff !== 0) {
      return diff;
    }
    return a.username.localeCompare(b.username, 'tr');
  });

  const activeCount = sortedMembers.filter((member) => (appState.presence[member.username]?.status || 'offline') !== 'offline').length;
  membersPanelTitle.textContent = 'Uyeler';
  membersPanelSubtitle.textContent = `${activeCount} aktif, ${sortedMembers.length} toplam uye`;
  membersCountPill.textContent = String(sortedMembers.length);

  sortedMembers.forEach((member) => {
    const presence = appState.presence[member.username]?.status || 'offline';
    const item = document.createElement('div');
    item.className = 'member-row';
    item.innerHTML = `
      <div style="display:flex; gap:10px; align-items:center;">
        ${avatarMarkup(member.username, 'member-avatar')}
        <div>
          <div class="member-name">${member.username}</div>
          <div class="member-role">${turkceRol(member.role)}</div>
        </div>
      </div>
      <div class="member-actions">
        <span class="presence ${presence}">${turkceDurum(presence)}</span>
        <button class="mini-action-btn member-profile-btn" data-username="${member.username}">Profil</button>
      </div>
    `;
    item.onclick = () => showUserProfile(member.username);
    memberList.appendChild(item);
  });

  memberList.querySelectorAll('.member-profile-btn').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      showUserProfile(button.dataset.username);
    };
  });
}

function renderDmList() {
  dmList.innerHTML = '';
  const users = appState.users.filter((user) => user.username !== currentUser);
  membersPanelTitle.textContent = 'Mesajlar';
  membersPanelSubtitle.textContent = `${users.length} kullanici ile direkt mesaj`;
  membersCountPill.textContent = String(users.length);
  dmList.innerHTML = users.map((user) => `
    ${(() => {
      const presence = appState.presence[user.username]?.status || 'offline';
      return `
    <div class="dm-row">
      <button class="dm-user ${activeDmUser === user.username ? 'active' : ''}" data-username="${user.username}">
        <span>${escapeHtml(user.username)}</span>
        <span style="display:flex; gap:8px; align-items:center;">
          ${unreadDmCounts[user.username] ? `<span class="badge-dot">${unreadDmCounts[user.username]}</span>` : ''}
          <span class="presence ${presence}">${turkceDurum(presence)}</span>
        </span>
      </button>
      <button class="mini-action-btn dm-profile-btn" data-username="${user.username}">Profil</button>
    </div>
      `;
    })()}
  `).join('');

  dmList.querySelectorAll('.dm-user').forEach((button) => {
    button.onclick = () => openDm(button.dataset.username);
    button.oncontextmenu = (event) => {
      event.preventDefault();
      showUserProfile(button.dataset.username);
    };
  });

  dmList.querySelectorAll('.dm-profile-btn').forEach((button) => {
    button.onclick = () => showUserProfile(button.dataset.username);
  });
}

function showUserProfile(username) {
  const server = getCurrentServer();
  const member = server?.members.find((item) => item.username === username);
  const user = appState.users.find((item) => item.username === username);
  const presence = appState.presence[username]?.status || user?.status || 'offline';
  const dmCount = (appState.directMessages[username] || []).length;
  const voiceEntry = Object.entries(appState.voicePresence).find(([, users]) => users.includes(username));
  const voiceChannel = server?.categories.flatMap((category) => category.channels).find((channel) => channel.id === voiceEntry?.[0]);
  const myServerRole = myRole();
  const canModerateTarget = username !== currentUser && ['admin', 'mod'].includes(myServerRole);
  const isMuted = Boolean(user?.mutedUntil && user.mutedUntil > Date.now());
  const friend = isFriend(username);
  const blocked = isBlockedUser(username);
  const incomingRequest = hasIncomingRequest(username);
  const outgoingRequest = hasOutgoingRequest(username);
  const blockedByTarget = Array.isArray(user?.blocked) && user.blocked.includes(currentUser);
  const dmBlocked = blocked || blockedByTarget;

  showModal(`
    <h2>Kullanici Profili</h2>
    <div style="display:flex; justify-content:center; margin-bottom:4px;">${avatarMarkup(username, 'profile-avatar')}</div>
    <div class="report-card">
      <div><strong>${escapeHtml(username)}</strong></div>
      <div class="report-meta">Durum: ${escapeHtml(turkceDurum(presence))}</div>
      <div class="report-meta">Rol: ${escapeHtml(turkceRol(member?.role || 'member'))}</div>
      <div class="report-meta">Mesaj sayisi: ${dmCount}</div>
      <div class="report-meta">Sesli oda: ${escapeHtml(voiceChannel?.name || 'yok')}</div>
      ${username !== currentUser ? `<div class="report-meta">Iliski: ${blocked ? 'engelli' : (blockedByTarget ? 'seni engellemis' : (friend ? 'arkadas' : (incomingRequest ? 'gelen istek' : (outgoingRequest ? 'istek gonderildi' : 'normal'))))}</div>` : ''}
    </div>
    ${username === currentUser ? `
      <input id="avatarFileInput" type="file" accept="image/*" class="modal-input" />
      <button id="saveAvatarBtn" class="modal-btn secondary">Profil Fotosu Yukle</button>
    ` : ''}
    ${username !== currentUser ? `
      <div class="action-grid">
        ${friend
          ? '<button id="profileFriendBtn" class="modal-btn secondary">Arkadas Sil</button>'
          : incomingRequest
            ? '<button id="profileAcceptFriendBtn" class="modal-btn primary">Kabul Et</button><button id="profileRejectFriendBtn" class="modal-btn secondary">Reddet</button>'
            : `<button id="profileFriendBtn" class="modal-btn secondary">${outgoingRequest ? 'Istek Iptal' : 'Arkadaslik Istegi Gonder'}</button>`}
        <button id="profileBlockBtn" class="modal-btn ${blocked ? 'secondary' : 'primary'}">${blocked ? 'Engeli Kaldir' : 'Engelle'}</button>
      </div>
    ` : ''}
    ${canModerateTarget ? `
      <div class="action-grid">
        <button id="profileMuteBtn" class="modal-btn secondary">${isMuted ? 'Susturmayi Kaldir' : 'Sustur'}</button>
        <button id="profileBanBtn" class="modal-btn primary">Yasakla</button>
      </div>
    ` : ''}
    <button id="profileDmBtn" class="modal-btn primary" ${dmBlocked ? 'disabled' : ''}>Mesaj Ac</button>
  `);

  const profileDmBtn = document.getElementById('profileDmBtn');
  if (profileDmBtn) {
    profileDmBtn.onclick = () => {
      if (dmBlocked) {
        showToast(blocked ? 'Engelledigin kullanici ile DM acamazsin.' : 'Bu kullanici seninle DM kurmaya uygun degil.');
        return;
      }
      hideModal();
      openDm(username);
    };
  }

  if (username !== currentUser) {
    const profileFriendBtn = document.getElementById('profileFriendBtn');
    if (profileFriendBtn) {
      profileFriendBtn.onclick = async () => {
        try {
          const data = await request(API.social, {
            method: 'POST',
            body: JSON.stringify({
              actor: currentUser,
              targetUser: username,
              action: friend ? 'remove-friend' : (outgoingRequest ? 'cancel-request' : 'send-request')
            })
          });
          syncSocialState(data.social);
          hideModal();
          renderAll();
          showToast(friend ? 'Arkadas silindi.' : (outgoingRequest ? 'Arkadaslik istegi iptal edildi.' : 'Arkadaslik istegi gonderildi.'));
        } catch (error) {
          alert(error.message);
        }
      };
    }

    const profileAcceptFriendBtn = document.getElementById('profileAcceptFriendBtn');
    if (profileAcceptFriendBtn) {
      profileAcceptFriendBtn.onclick = async () => {
        try {
          const data = await request(API.social, {
            method: 'POST',
            body: JSON.stringify({
              actor: currentUser,
              targetUser: username,
              action: 'accept-request'
            })
          });
          syncSocialState(data.social);
          hideModal();
          renderAll();
          showToast('Arkadaslik istegi kabul edildi.');
        } catch (error) {
          alert(error.message);
        }
      };
    }

    const profileRejectFriendBtn = document.getElementById('profileRejectFriendBtn');
    if (profileRejectFriendBtn) {
      profileRejectFriendBtn.onclick = async () => {
        try {
          const data = await request(API.social, {
            method: 'POST',
            body: JSON.stringify({
              actor: currentUser,
              targetUser: username,
              action: 'reject-request'
            })
          });
          syncSocialState(data.social);
          hideModal();
          renderAll();
          showToast('Arkadaslik istegi reddedildi.');
        } catch (error) {
          alert(error.message);
        }
      };
    }

    document.getElementById('profileBlockBtn').onclick = async () => {
      const action = blocked ? 'unblock' : 'block';
      const confirmed = blocked ? true : confirm(`${username} kullanicisini engellemek istiyor musun?`);
      if (!confirmed) {
        return;
      }

      try {
        const data = await request(API.social, {
          method: 'POST',
          body: JSON.stringify({
            actor: currentUser,
            targetUser: username,
            action
          })
        });
        syncSocialState(data.social);
        hideModal();
        renderAll();
        showToast(blocked ? 'Kullanici engelden cikarildi.' : 'Kullanici engellendi.');
      } catch (error) {
        alert(error.message);
      }
    };
  }

  if (username === currentUser) {
    document.getElementById('saveAvatarBtn').onclick = async () => {
      const file = document.getElementById('avatarFileInput').files?.[0];
      if (!file) {
        alert('Lutfen bir gorsel sec.');
        return;
      }

      try {
        const optimizedAvatar = await resizeImageFile(file);
        const targetUser = getUserRecord(currentUser);
        if (targetUser) {
          targetUser.avatar = optimizedAvatar;
        }
        hideModal();
        renderAll();
        showToast('Profil fotosu yukleniyor...');
        await request(API.avatar, {
          method: 'POST',
          body: JSON.stringify({
            username: currentUser,
            avatar: optimizedAvatar
          })
        });
        showToast('Profil fotosu guncellendi.');
      } catch (error) {
        alert(error.message);
      }
    };
  }

  if (canModerateTarget) {
    document.getElementById('profileMuteBtn').onclick = async () => {
      try {
        await request(API.moderation, {
          method: 'POST',
          body: JSON.stringify({
            serverId: currentServerId,
            targetUser: username,
            action: isMuted ? 'unmute' : 'mute',
            reason: 'Profil karti uzerinden moderasyon',
            actor: currentUser
          })
        });
        hideModal();
        showToast(`${username} icin ${isMuted ? 'susturma kaldirildi' : 'susturma uygulandi'}.`);
      } catch (error) {
        alert(error.message);
      }
    };

    document.getElementById('profileBanBtn').onclick = async () => {
      const confirmed = confirm(`${username} kullanicisini banlamak istiyor musun?`);
      if (!confirmed) {
        return;
      }
      try {
        await request(API.moderation, {
          method: 'POST',
          body: JSON.stringify({
            serverId: currentServerId,
            targetUser: username,
            action: 'ban',
            reason: 'Profil karti uzerinden moderasyon',
            actor: currentUser
          })
        });
        hideModal();
        showToast(`${username} banlandi.`);
      } catch (error) {
        alert(error.message);
      }
    };
  }
}

function renderSidebarTab() {
  const isDm = activeSidebarTab === 'dm';
  membersTabBtn.classList.toggle('active', !isDm);
  dmTabBtn.classList.toggle('active', isDm);
  memberList.classList.toggle('hidden', isDm);
  dmList.classList.toggle('hidden', !isDm);
  renderDmList();
}

function renderVoicePanel() {
  const channel = getCurrentChannel();
  const server = getCurrentServer();
  const voiceMembers = getCurrentVoiceMembers();
  const activeVoiceChannel =
    server?.categories.flatMap((category) => category.channels).find((item) => item.id === currentVoiceChannelId) || null;

  const targetChannel = channel?.kind === 'voice' ? channel : activeVoiceChannel;
  const title = targetChannel ? targetChannel.name : 'voice-lounge';
  const list = targetChannel ? appState.voicePresence[targetChannel.id] || [] : voiceMembers;

  voicePanel.innerHTML = `
    <div class="panel-title">Sesli Oda</div>
    <div class="voice-name">${title}</div>
    <div class="voice-subtitle">Katil/ayril simulasyonu ve anlik durum</div>
    <div class="voice-members">
      ${(list.length ? list : ['Kimse odada degil.'])
        .map((username) => typeof username === 'string'
          ? `<div class="voice-member ${isUserSpeaking(username) ? 'speaking' : ''}"><span>${username}</span><span>${isUserSpeaking(username) ? 'konusuyor' : 'sessiz'}</span></div>`
          : `<div class="voice-member">${username}</div>`)
        .join('')}
    </div>
  `;
}

function renderReports() {
  const server = getCurrentServer();
  reportList.innerHTML = '';
  if (!server) {
    return;
  }

  const reports = server.reports.slice(0, 5);
  const logs = (server.moderationLogs || []).slice(0, 6);
  const reportMarkup = reports.length
    ? reports.map(
        (report) => `
          <div class="report-card">
            <div><strong>${report.targetUser}</strong> icin rapor</div>
            <div>${report.reason}</div>
            <div class="report-meta">${report.reporter} • ${formatTime(report.time)} • ${report.status}</div>
          </div>
        `
      ).join('')
    : '<div class="empty-state">Henuz rapor yok.</div>';
  const logMarkup = logs.length
    ? logs.map(
        (log) => `
          <div class="report-card">
            <div><strong>${escapeHtml(log.action)}</strong> • ${escapeHtml(log.targetUser || '-')}</div>
            <div>${escapeHtml(log.reason || 'Detay yok')}</div>
            <div class="report-meta">${escapeHtml(log.actor || 'system')} • ${formatTime(log.time)}</div>
          </div>
        `
      ).join('')
    : '<div class="empty-state">Henuz moderasyon kaydi yok.</div>';

  reportList.innerHTML = `
    <div class="panel-subtitle">Raporlar</div>
    ${reportMarkup}
    <div class="panel-subtitle" style="margin-top:8px;">Moderasyon Loglari</div>
    ${logMarkup}
  `;
}

function collectModerationNotifications(nextServers) {
  nextServers.forEach((server) => {
    const previousServer = appState.servers.find((item) => item.id === server.id);
    const previousKeys = new Set((previousServer?.moderationLogs || []).map((log) => `${log.time}_${log.action}_${log.targetUser}_${log.actor}`));
    (server.moderationLogs || []).forEach((log) => {
      const key = `${log.time}_${log.action}_${log.targetUser}_${log.actor}`;
      if (!previousKeys.has(key)) {
        addNotification(
          'moderasyon',
          `${server.name} sunucusunda moderasyon`,
          `${log.actor || 'Sistem'} • ${log.action} • ${log.targetUser || '-'}`
        );
      }
    });
  });
}

function renderPolls() {
  const server = getCurrentServer();
  pollList.innerHTML = '';
  if (!server) {
    return;
  }

  const polls = server.polls.slice(0, 4);
  pollList.innerHTML = polls.length
    ? polls
        .map(
          (poll) => `
            <div class="poll-card">
              <div><strong>${poll.question}</strong></div>
              <div>${poll.options.map((option) => option.label).join(' / ')}</div>
              <div class="report-meta">${poll.createdBy} • ${formatTime(poll.time)}</div>
            </div>
          `
        )
        .join('')
    : '<div class="empty-state">/poll komutuyla anket olustur.</div>';
}

function renderPermissions() {
  const server = getCurrentServer();
  permissionsList.innerHTML = '';
  if (!server) {
    return;
  }

  const rows = server.categories
    .flatMap((category) => category.channels.map((channel) => ({ category: category.name, channel })));

  permissionsList.innerHTML = rows.length
    ? rows
        .map(
          ({ category, channel }) => `
            <div class="permission-card">
              <div><strong>${category} / ${channel.name}</strong></div>
              <div class="report-meta">${channel.kind === 'voice' ? 'sesli' : 'yazi'}</div>
              <div class="permission-tags">
                ${channel.allowedRoles.map((role) => `<span class="mini-tag">${turkceRol(role)}</span>`).join('')}
              </div>
            </div>
          `
        )
        .join('')
    : '<div class="empty-state">Henuz kanal izni yok.</div>';
}

function renderAll() {
  syncSocialState(appState.social);
  renderNotificationBadge();
  renderServers();
  renderChannels();
  renderHeader();
  renderMessages();
  renderMembers();
  renderSidebarTab();
  renderVoicePanel();
  renderReports();
  renderPolls();
  renderPermissions();
  renderVideoPanel();
  renderTypingIndicator();
}

function renderTypingIndicator() {
  if (activeSidebarTab === 'dm' && activeDmUser) {
    const users = (appState.typingState[dmScopeKey(activeDmUser)] || []).filter((user) => user !== currentUser);
    if (users.length) {
      helperText.textContent = `${users.join(', ')} yaziyor...`;
      return;
    }
  }

  if (activeSidebarTab === 'members' && currentChannelId) {
    const users = (appState.typingState[`channel:${currentChannelId}`] || []).filter((user) => user !== currentUser);
    if (users.length) {
      helperText.textContent = `${users.join(', ')} yaziyor...`;
      return;
    }
  }
}

function switchServer(serverId) {
  currentServerId = serverId;
  const server = getCurrentServer();
  const firstChannel = server?.categories[0]?.channels[0];
  if (firstChannel) {
    switchChannel(firstChannel.id);
  }
  if (isMobileLayout()) {
    closeMobilePanels();
  }
  renderAll();
}

function switchChannel(channelId) {
  activeSidebarTab = 'members';
  activeDmUser = null;
  currentChannelId = channelId;
  const server = getCurrentServer();
  const channel = getCurrentChannel();
  if (!server || !channel) {
    return;
  }

  if (channel.kind === 'voice') {
    showToast('Bu kanal sesli oda. Katil butonuyla girebilirsin.');
  } else {
    showToast('Slash komutlari: /help, /stats, /poll soru | secenek1 | secenek2');
  }

  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'switchChannel',
      username: currentUser,
      serverId: currentServerId,
      channelId
    }));
  }
  markConversationSeen();
  if (isMobileLayout()) {
    closeMobilePanels();
  }
  renderAll();
}

function openDm(username) {
  activeSidebarTab = 'dm';
  activeDmUser = username;
  unreadDmCounts[username] = 0;
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'openDm',
      username: currentUser,
      peerUsername: username
    }));
  }
  markConversationSeen();
  if (isMobileLayout()) {
    closeMobilePanels();
  }
  renderAll();
}

function connectWS() {
  ws = new WebSocket(`${wsProtocol()}://${location.host}`);
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'identify', username: currentUser }));
    if (currentServerId && currentChannelId) {
      ws.send(JSON.stringify({
        type: 'switchChannel',
        username: currentUser,
        serverId: currentServerId,
        channelId: currentChannelId
      }));
    }
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'messages') {
      if (activeSidebarTab === 'members') {
        appState.messages[data.channelId] = mergeMessageList(appState.messages[data.channelId], data.messages);
      }
      if (data.channelId === currentChannelId && activeSidebarTab === 'members') {
        markConversationSeen();
      }
      renderMessages();
      return;
    }

    if (data.type === 'dmMessages') {
      const previousCount = (appState.directMessages[data.peerUsername] || []).length;
      appState.directMessages[data.peerUsername] = mergeMessageList(appState.directMessages[data.peerUsername], data.messages);
      if (activeSidebarTab === 'dm' && activeDmUser === data.peerUsername) {
        unreadDmCounts[data.peerUsername] = 0;
        markConversationSeen();
        renderMessages();
      } else {
        const incomingCount = Math.max(0, data.messages.length - previousCount);
        unreadDmCounts[data.peerUsername] = (unreadDmCounts[data.peerUsername] || 0) + incomingCount;
        if (incomingCount > 0) {
          playNotificationSound();
          showToast(`${data.peerUsername} sana ozel mesaj gonderdi.`);
          const latestMessage = data.messages[data.messages.length - 1];
          addNotification('ozel mesaj', `${data.peerUsername} sana yazdi`, latestMessage?.text || 'Yeni ozel mesaj');
          showBrowserNotification(`${data.peerUsername} sana ozel mesaj gonderdi`, latestMessage?.text || 'Yeni mesaj');
        }
      }
      renderDmList();
      return;
    }

    if (data.type === 'message') {
      const { channelId, message } = data;
      if (!appState.messages[channelId]) {
        appState.messages[channelId] = [];
      }
      appState.messages[channelId] = mergeMessageList(appState.messages[channelId], [message]);
      const isMention = message.user !== currentUser && messageMentionsUser(message.text, currentUser);
      if (message.user !== currentUser) {
        playNotificationSound();
        addNotification(
          isMention ? 'bahsetme' : 'mesaj',
          isMention ? `${message.user} senden bahsetti` : `${message.user} yeni mesaj gonderdi`,
          message.text || 'Yeni kanal mesaji'
        );
        showBrowserNotification(
          isMention ? `${message.user} senden bahsetti` : `${message.user} yeni mesaj`,
          message.text || 'Yeni kanal mesaji'
        );
      }
      if (channelId === currentChannelId) {
        renderMessages();
        if (message.user !== currentUser) {
          showToast(isMention ? `${message.user} senden bahsetti.` : `${message.user} yeni mesaj gonderdi.`);
        }
      } else if (isMention) {
        showToast(`${message.user} bir mesajda senden bahsetti.`);
      }
      return;
    }

    if (data.type === 'messageUpdated') {
      const list = appState.messages[data.channelId] || [];
      const index = list.findIndex((message) => message.id === data.message.id);
      if (index >= 0) {
        list[index] = data.message;
      } else {
        list.push(data.message);
      }
      if (data.channelId === currentChannelId) {
        renderMessages();
      }
      return;
    }

    if (data.type === 'messageDeleted') {
      const list = appState.messages[data.channelId] || [];
      appState.messages[data.channelId] = list.filter((message) => message.id !== data.messageId);
      if (data.channelId === currentChannelId) {
        renderMessages();
      }
      return;
    }

    if (data.type === 'stateUpdated') {
      const previousIncoming = mySocial().incomingRequests.length;
      appState.users = data.users;
      syncSocialState(data.social);
      appState.presence = data.presence;
      appState.voicePresence = data.voicePresence;
      appState.callPresence = data.callPresence || {};
      appState.typingState = data.typingState || {};
      if (mySocial().incomingRequests.length > previousIncoming) {
        playNotificationSound();
        showToast('Yeni bir arkadaslik istegi geldi.');
        addNotification('arkadaslik', 'Yeni arkadaslik istegi', 'Istekler panelinden kabul edebilirsin.');
        showBrowserNotification('Yeni arkadaslik istegi', 'Istekler panelinden kabul edebilirsin.');
      }
      currentVoiceChannelId = appState.presence[currentUser]?.voiceChannelId || null;
      renderMembers();
      renderDmList();
      renderVoicePanel();
      renderHeader();
      renderVideoPanel();
      renderTypingIndicator();
      return;
    }

    if (data.type === 'serverUpdated') {
      collectModerationNotifications([data.server]);
      const index = appState.servers.findIndex((server) => server.id === data.server.id);
      if (index >= 0) {
        appState.servers[index] = data.server;
      } else {
        appState.servers.push(data.server);
      }
      appState.messages = data.messages;
      appState.directMessages = data.directMessages || appState.directMessages;
      appState.voicePresence = data.voicePresence;
      appState.presence = data.presence;
      appState.callPresence = data.callPresence || {};
      appState.typingState = data.typingState || {};
      currentVoiceChannelId = appState.presence[currentUser]?.voiceChannelId || null;
      renderAll();
      return;
    }

    if (data.type === 'typingState') {
      appState.typingState[data.scopeKey] = data.users || [];
      renderTypingIndicator();
      return;
    }

    if (data.type === 'callState') {
      const visibleCall = findVisibleChannel(data.channelId);
      if (!visibleCall) {
        return;
      }
      appState.callPresence[data.channelId] = data.participants || [];
      if ((data.participants || []).includes(currentUser)) {
        activeCallChannelId = data.channelId;
      }
      const callNoticeKey = `${data.channelId}:${data.startedBy || ''}:${data.startedAt || ''}`;
      if (
        data.isNewJoin &&
        data.startedBy &&
        data.startedBy !== currentUser &&
        !announcedCallStarts.has(callNoticeKey)
      ) {
        announcedCallStarts.add(callNoticeKey);
        const channelName = visibleCall.channel?.name || 'sesli oda';
        playNotificationSound();
        showToast(`${data.startedBy} ${channelName} kanalinda goruntulu konusma baslatti.`);
        addNotification(
          'goruntulu konusma',
          `${data.startedBy} goruntulu konusma baslatti`,
          `${channelName} kanalindan katilabilirsin.`
        );
        showBrowserNotification(
          `${data.startedBy} goruntulu konusma baslatti`,
          `${channelName} kanalindan katilabilirsin.`
        );
      }
      renderVideoPanel();
      const peers = (data.participants || []).filter((username) => username !== currentUser);
      peers.forEach((peerUsername) => {
        const pc = peerConnections.get(peerUsername);
        const shouldCreateOffer = !pc
          || ['closed', 'failed'].includes(pc.connectionState)
          || (pc.signalingState === 'stable' && !isPeerConnected(pc) && !peerOfferState.get(peerUsername));
        if (localStream && shouldCreateOffer) {
          initiateOffer(peerUsername).catch(() => showToast('Video baglantisi baslatilamadi.'));
        }
      });
      return;
    }

    if (data.type === 'callLeft') {
      if (data.channelId && appState.callPresence[data.channelId]) {
        appState.callPresence[data.channelId] = appState.callPresence[data.channelId].filter((item) => item !== data.username);
      }
      if (data.username === currentUser) {
        activeCallChannelId = null;
      }
      closePeerConnection(data.username);
      renderVideoPanel();
      return;
    }

    if (data.type === 'webrtcSignal') {
      handleIncomingSignal(data).catch(() => showToast('Goruntulu konusma sinyali islenemedi.'));
      return;
    }

    if (data.type === 'system') {
      showToast(data.text);
      return;
    }

    if (data.type === 'error') {
      if (data.clientId) {
        removePendingMessage(data.clientId);
      }
      alert(data.message);
    }
  };

  ws.onclose = () => {
    setTimeout(connectWS, 1000);
  };
}

async function bootstrap() {
  const data = await request(`${API.bootstrap}?username=${encodeURIComponent(currentUser)}`);
  const rtcConfig = await request(API.rtcConfig).catch(() => null);
  appState = data;
  appState.rtcIceServers = rtcConfig?.iceServers?.length ? rtcConfig.iceServers : appState.rtcIceServers;
  loadNotificationCenter();
  loadLastSeenMarkers();
  syncSocialState(appState.social);
  unreadDmCounts = {};
  currentServerId = appState.servers[0]?.id || null;
  currentChannelId = appState.servers[0]?.categories[0]?.channels[0]?.id || null;
  currentVoiceChannelId = appState.presence[currentUser]?.voiceChannelId || null;
  appState.callPresence = appState.callPresence || {};
  presenceSelect.value = appState.presence[currentUser]?.status || 'online';
  markConversationSeen();
  renderAll();
  connectWS();
}

function showLogin() {
  const resetToken = new URLSearchParams(location.search).get('resetToken');
  if (resetToken) {
    showResetPassword(resetToken);
    return;
  }

  showModal(`
    <div class="auth-sparkle">Hos Geldiniz</div>
    <div class="auth-caption">
      <strong>Pembe gece modu</strong>
      Topluluguna tek dokunusta baglan.
    </div>
    <h2>Topluluk Sunucusu Giris</h2>
    <p class="modal-copy">Kullanici adi ve sifrenizi girin.</p>
    <input id="loginUser" class="modal-input" placeholder="Kullanici adi" />
    <input id="loginPass" class="modal-input" type="password" placeholder="Sifre" />
    <button id="loginSubmit" class="modal-btn primary">Giris Yap</button>
    <button id="showForgotPassword" class="modal-btn secondary">Sifremi Unuttum</button>
    <button id="showRegister" class="modal-btn secondary">Kayit Ol</button>
  `, 'auth');

  document.getElementById('loginSubmit').onclick = async () => {
    try {
      currentUser = document.getElementById('loginUser').value.trim();
      const password = document.getElementById('loginPass').value;
      await request(API.login, { method: 'POST', body: JSON.stringify({ username: currentUser, password }) });
      hideModal();
      document.getElementById('appShell').classList.remove('hidden');
      bootstrap();
    } catch (error) {
      alert(error.message);
    }
  };

  document.getElementById('showRegister').onclick = showRegister;
  document.getElementById('showForgotPassword').onclick = showForgotPassword;
}

function showRegister() {
  showModal(`
    <div class="auth-sparkle">Yeni Baslangic</div>
    <div class="auth-caption">
      <strong>Kendi alanini kur</strong>
      Profilini olustur ve sunucuna katil.
    </div>
    <h2>Yeni Uye</h2>
    <p class="modal-copy">E-posta adresin sifre kurtarma icin kullanilir.</p>
    <input id="regUser" class="modal-input" placeholder="Kullanici adi" />
    <input id="regEmail" class="modal-input" type="email" placeholder="E-posta adresi" />
    <input id="regPass" class="modal-input" type="password" placeholder="Sifre" />
    <label class="auth-file-field" for="regAvatar">
      <span>Profil fotografi</span>
      <small>Istege bagli. JPG veya PNG yukleyebilirsin.</small>
      <strong id="regAvatarLabel">Profil fotografi sec</strong>
    </label>
    <input id="regAvatar" class="hidden" type="file" accept="image/*" />
    <button id="registerSubmit" class="modal-btn primary">Kayit Ol</button>
    <button id="showLogin" class="modal-btn secondary">Geri Don</button>
  `, 'auth');

  document.getElementById('regAvatar').onchange = (event) => {
    const fileName = event.target.files?.[0]?.name;
    document.getElementById('regAvatarLabel').textContent = fileName || 'Profil fotografi sec';
  };

  document.getElementById('registerSubmit').onclick = async () => {
    try {
      const username = document.getElementById('regUser').value.trim();
      const email = document.getElementById('regEmail').value.trim();
      const password = document.getElementById('regPass').value;
      const file = document.getElementById('regAvatar').files?.[0];

      const submitRegister = async (avatar = null) => {
        await request(API.register, {
          method: 'POST',
          body: JSON.stringify({ username, email, password, avatar })
        });
        alert('Kayit tamam. Giris yapabilirsin.');
        showLogin();
      };

      if (!file) {
        await submitRegister(null);
        return;
      }

      const optimizedAvatar = await resizeImageFile(file);
      await submitRegister(optimizedAvatar);
    } catch (error) {
      alert(error.message);
    }
  };

  document.getElementById('showLogin').onclick = showLogin;
}

function showForgotPassword() {
  showModal(`
    <div class="auth-sparkle">Sifre Kurtarma</div>
    <div class="auth-caption">
      <strong>Hesabini geri al</strong>
      Kullanici adin ve e-postan eslesirse mailine kod ve baglanti gonderilir.
    </div>
    <h2>Sifremi Unuttum</h2>
    <p class="modal-copy">Kayit olurken kullandigin kullanici adi ve e-posta adresini gir.</p>
    <input id="resetUser" class="modal-input" placeholder="Kullanici adi" />
    <input id="resetEmail" class="modal-input" type="email" placeholder="E-posta adresi" />
    <button id="requestResetSubmit" class="modal-btn primary">Kurtarma Baglantisi Gonder</button>
    <button id="resetBackLogin" class="modal-btn secondary">Giris Ekranina Don</button>
  `, 'auth');

  document.getElementById('requestResetSubmit').onclick = async () => {
    try {
      const username = document.getElementById('resetUser').value.trim();
      const email = document.getElementById('resetEmail').value.trim();
      const data = await request(API.passwordResetRequest, {
        method: 'POST',
        body: JSON.stringify({ username, email })
      });

      showModal(`
        <div class="auth-sparkle">Kontrol Et</div>
        <div class="auth-caption">
          <strong>E-postani kontrol et</strong>
          Kod ve sifirlama baglantisi 30 dakika gecerlidir.
        </div>
        <h2>Kurtarma Maili Gonderildi</h2>
        <p class="modal-copy">${escapeHtml(data.message || 'Bilgiler eslesiyorsa sifre sifirlama baglantisi e-postana gonderildi.')}</p>
        <p class="modal-copy">Maildeki baglantiya tiklayabilir veya gelen 6 haneli kodu burada kullanabilirsin.</p>
        <button id="showResetWithCode" class="modal-btn primary">Kod ile Sifremi Yenile</button>
        <button id="resetDoneLogin" class="modal-btn secondary">Giris Ekranina Don</button>
      `, 'auth');

      document.getElementById('showResetWithCode').onclick = () => showResetPassword(null, { username, email });
      document.getElementById('resetDoneLogin').onclick = showLogin;
    } catch (error) {
      alert(error.message);
    }
  };

  document.getElementById('resetBackLogin').onclick = showLogin;
}

function showResetPassword(token, account = {}) {
  showModal(`
    <div class="auth-sparkle">Yeni Sifre</div>
    <div class="auth-caption">
      <strong>Son adim</strong>
      Hesabin icin yeni sifreni belirle.
    </div>
    <h2>Sifreyi Yenile</h2>
    <p class="modal-copy">${token ? 'Maildeki baglanti dogrulandi. Yeni sifreni yaz.' : 'Mailine gelen 6 haneli kodu ve yeni sifreni yaz.'}</p>
    ${token ? '' : `
      <input id="codeResetUser" class="modal-input" placeholder="Kullanici adi" value="${escapeHtml(account.username || '')}" />
      <input id="codeResetEmail" class="modal-input" type="email" placeholder="E-posta adresi" value="${escapeHtml(account.email || '')}" />
      <input id="resetCode" class="modal-input" inputmode="numeric" maxlength="6" placeholder="6 haneli kod" />
    `}
    <input id="newResetPass" class="modal-input" type="password" placeholder="Yeni sifre" />
    <input id="newResetPassAgain" class="modal-input" type="password" placeholder="Yeni sifre tekrar" />
    <button id="confirmResetSubmit" class="modal-btn primary">Sifreyi Guncelle</button>
    <button id="resetCancelLogin" class="modal-btn secondary">Giris Ekranina Don</button>
  `, 'auth');

  document.getElementById('confirmResetSubmit').onclick = async () => {
    try {
      const password = document.getElementById('newResetPass').value;
      const passwordAgain = document.getElementById('newResetPassAgain').value;
      if (password !== passwordAgain) {
        alert('Sifreler ayni olmali.');
        return;
      }
      await request(API.passwordResetConfirm, {
        method: 'POST',
        body: JSON.stringify({
          token,
          username: token ? null : document.getElementById('codeResetUser').value.trim(),
          email: token ? null : document.getElementById('codeResetEmail').value.trim(),
          code: token ? null : document.getElementById('resetCode').value.trim(),
          password
        })
      });
      history.replaceState(null, '', location.pathname);
      alert('Sifren guncellendi. Yeni sifrenle giris yapabilirsin.');
      showLogin();
    } catch (error) {
      alert(error.message);
    }
  };

  document.getElementById('resetCancelLogin').onclick = () => {
    history.replaceState(null, '', location.pathname);
    showLogin();
  };
}

function sendMessage() {
  const text = messageInput.value.trim();
  const channel = getCurrentChannel();
  if (!text && !pendingAttachment) {
    return;
  }

  if (activeSidebarTab === 'dm' && activeDmUser) {
    const clientId = createClientMessageId();
    const outgoingText = text || (pendingAttachment?.name || 'Ek paylasildi');
    const outgoingAttachment = pendingAttachment;
    appState.directMessages[activeDmUser] = appState.directMessages[activeDmUser] || [];
    appState.directMessages[activeDmUser].push({
      id: clientId,
      clientId,
      user: currentUser,
      text: outgoingText,
      time: Date.now(),
      reactions: {},
      seenBy: [currentUser],
      attachment: outgoingAttachment,
      pending: true
    });
    pendingOutgoingMessages.set(clientId, { scope: 'dm', peerUsername: activeDmUser });
    renderMessages();
    ws.send(JSON.stringify({
      type: 'dmMessage',
      username: currentUser,
      peerUsername: activeDmUser,
      text: outgoingText,
      attachment: outgoingAttachment,
      clientId
    }));
    messageInput.value = '';
    pendingAttachment = null;
    updateComposerPlaceholder();
    return;
  }

  if (!channel) {
    return;
  }

  if (channel.kind === 'voice') {
    alert('Sesli odalara yazi mesaji yerine join/leave mantigi uygulanir.');
    return;
  }

  const clientId = createClientMessageId();
  const outgoingText = text || (pendingAttachment?.name || 'Ek paylasildi');
  const outgoingAttachment = pendingAttachment;
  appState.messages[currentChannelId] = appState.messages[currentChannelId] || [];
  appState.messages[currentChannelId].push({
    id: clientId,
    clientId,
    user: currentUser,
    text: outgoingText,
    time: Date.now(),
    reactions: {},
    attachment: outgoingAttachment,
    pending: true
  });
  pendingOutgoingMessages.set(clientId, { scope: 'channel', channelId: currentChannelId });
  renderMessages();

  ws.send(JSON.stringify({
    type: 'message',
    serverId: currentServerId,
    channelId: currentChannelId,
    username: currentUser,
    text: outgoingText,
    attachment: outgoingAttachment,
    clientId
  }));
  messageInput.value = '';
  pendingAttachment = null;
  updateComposerPlaceholder();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'typing',
      scope: activeSidebarTab === 'dm' && activeDmUser ? 'dm' : 'channel',
      username: currentUser,
      peerUsername: activeDmUser,
      channelId: currentChannelId,
      isTyping: false
    }));
  }
}

function updateComposerPlaceholder() {
  if (pendingAttachment?.name) {
    messageInput.placeholder = `Ek hazir: ${pendingAttachment.name}`;
    return;
  }
  messageInput.placeholder = 'Mesaj gonder';
}

async function createServer() {
  showModal(`
    <h2>Sunucu Olustur</h2>
    <input id="serverName" class="modal-input" placeholder="Sunucu adi" />
    <button id="submitServer" class="modal-btn primary">Olustur</button>
  `);

  document.getElementById('submitServer').onclick = async () => {
    try {
      const name = document.getElementById('serverName').value.trim();
      const data = await request(API.createServer, {
        method: 'POST',
        body: JSON.stringify({ name, creator: currentUser })
      });
      const existingIndex = appState.servers.findIndex((server) => server.id === data.server.id);
      if (existingIndex >= 0) {
        appState.servers[existingIndex] = data.server;
      } else {
        appState.servers.push(data.server);
      }
      hideModal();
      switchServer(data.server.id);
      renderAll();
    } catch (error) {
      alert(error.message);
    }
  };
}

async function deleteServer() {
  const server = getCurrentServer();
  if (!server) {
    return;
  }

  const confirmed = confirm(`"${server.name}" sunucusunu silmek istiyor musun? Bu islem geri alinmaz.`);
  if (!confirmed) {
    return;
  }

  try {
    await request(API.deleteServer, {
      method: 'POST',
      body: JSON.stringify({
        serverId: currentServerId,
        actor: currentUser
      })
    });

    appState.servers = appState.servers.filter((item) => item.id !== currentServerId);
    currentServerId = appState.servers[0]?.id || null;
    currentChannelId = appState.servers[0]?.categories?.[0]?.channels?.[0]?.id || null;
    renderAll();
    showToast('Sunucu silindi.');
  } catch (error) {
    alert(error.message);
  }
}

async function showInviteCode() {
  try {
    const data = await request(API.serverInvite, {
      method: 'POST',
      body: JSON.stringify({
        serverId: currentServerId,
        actor: currentUser
      })
    });

    showModal(`
      <h2>Davet Kodu</h2>
      <div class="report-card">
        <div><strong>${escapeHtml(getCurrentServer()?.name || 'Sunucu')}</strong></div>
        <div class="report-meta">Bu kodu paylasan kullanicilar sunucuya katilabilir.</div>
        <div style="margin-top:8px; font-size:22px; font-weight:800; letter-spacing:0.12em;">${escapeHtml(data.inviteCode)}</div>
      </div>
      <button id="copyInviteBtn" class="modal-btn primary">Kodu Kopyala</button>
    `);

    document.getElementById('copyInviteBtn').onclick = async () => {
      try {
        await navigator.clipboard.writeText(data.inviteCode);
        showToast('Davet kodu kopyalandi.');
        addNotification('davet', 'Davet kodu kopyalandi', `${getCurrentServer()?.name || 'Sunucu'} icin kod paylasima hazir.`);
      } catch {
        showToast(`Davet kodu: ${data.inviteCode}`);
        addNotification('davet', 'Davet kodu olusturuldu', `${data.inviteCode} kodunu paylasabilirsin.`);
      }
    };
  } catch (error) {
    alert(error.message);
  }
}

function joinServerByCode() {
  showModal(`
    <h2>Kodla Katil</h2>
    <input id="joinServerCode" class="modal-input" placeholder="Davet kodu" />
    <button id="submitJoinServer" class="modal-btn primary">Sunucuya Katil</button>
  `);

  document.getElementById('submitJoinServer').onclick = async () => {
    try {
      const inviteCode = document.getElementById('joinServerCode').value.trim().toUpperCase();
      const data = await request(API.joinServer, {
        method: 'POST',
        body: JSON.stringify({
          username: currentUser,
          inviteCode
        })
      });

      const existingIndex = appState.servers.findIndex((server) => server.id === data.server.id);
      if (existingIndex >= 0) {
        appState.servers[existingIndex] = data.server;
      } else {
        appState.servers.push(data.server);
      }
      hideModal();
      switchServer(data.server.id);
      addNotification('davet', 'Sunucuya katildin', `${data.server.name} sunucusuna davet koduyla girdin.`);
      showToast(`${data.server.name} sunucusuna katildin.`);
    } catch (error) {
      alert(error.message);
    }
  };
}

function createChannel() {
  const server = getCurrentServer();
  if (!server) {
    return;
  }

  showModal(`
    <h2>Kanal Ekle</h2>
    <input id="channelName" class="modal-input" placeholder="Kanal adi" />
    <select id="channelKind" class="modal-input">
      <option value="text">Text</option>
      <option value="voice">Voice</option>
    </select>
    <select id="channelCategory" class="modal-input">
      ${server.categories.map((category) => `<option value="${category.id}">${category.name}</option>`).join('')}
    </select>
    <label class="checkbox-row"><input id="roleMember" type="checkbox" checked /> uye</label>
    <label class="checkbox-row"><input id="roleMod" type="checkbox" checked /> moderatör</label>
    <label class="checkbox-row"><input id="roleAdmin" type="checkbox" checked /> yonetici</label>
    <button id="submitChannel" class="modal-btn primary">Kaydet</button>
  `);

  document.getElementById('submitChannel').onclick = async () => {
    try {
      const allowedRoles = ['member', 'mod', 'admin'].filter((role) => {
        const id = `role${role.charAt(0).toUpperCase()}${role.slice(1)}`;
        return document.getElementById(id).checked;
      });
      await request(API.createChannel, {
        method: 'POST',
        body: JSON.stringify({
          serverId: currentServerId,
          categoryId: document.getElementById('channelCategory').value,
          name: document.getElementById('channelName').value.trim(),
          kind: document.getElementById('channelKind').value,
          allowedRoles,
          actor: currentUser
        })
      });
      hideModal();
    } catch (error) {
      alert(error.message);
    }
  };
}

function createCategory() {
  showModal(`
    <h2>Kategori Ekle</h2>
    <input id="categoryName" class="modal-input" placeholder="Kategori adi" />
    <button id="submitCategory" class="modal-btn primary">Kaydet</button>
  `);

  document.getElementById('submitCategory').onclick = async () => {
    try {
      await request(API.createCategory, {
        method: 'POST',
        body: JSON.stringify({
          serverId: currentServerId,
          name: document.getElementById('categoryName').value.trim(),
          actor: currentUser
        })
      });
      hideModal();
    } catch (error) {
      alert(error.message);
    }
  };
}

function assignRole() {
  const server = getCurrentServer();
  showModal(`
    <h2>Rol Ata</h2>
    <select id="roleUser" class="modal-input">
      ${server.members.map((member) => `<option value="${member.username}">${member.username}</option>`).join('')}
    </select>
    <select id="roleValue" class="modal-input">
      <option value="member">uye</option>
      <option value="mod">moderatör</option>
      <option value="admin">yonetici</option>
    </select>
    <button id="submitRole" class="modal-btn primary">Guncelle</button>
  `);

  document.getElementById('submitRole').onclick = async () => {
    try {
      await request(API.changeRole, {
        method: 'POST',
        body: JSON.stringify({
          serverId: currentServerId,
          targetUser: document.getElementById('roleUser').value,
          role: document.getElementById('roleValue').value,
          actor: currentUser
        })
      });
      hideModal();
    } catch (error) {
      alert(error.message);
    }
  };
}

function moderateUser() {
  const server = getCurrentServer();
  showModal(`
    <h2>Moderasyon</h2>
    <select id="modUser" class="modal-input">
      ${server.members.filter((member) => member.username !== currentUser).map((member) => `<option value="${member.username}">${member.username}</option>`).join('')}
    </select>
    <select id="modAction" class="modal-input">
      <option value="mute">mute</option>
      <option value="unmute">unmute</option>
      <option value="ban">ban</option>
    </select>
    <input id="modReason" class="modal-input" placeholder="Sebep" />
    <button id="submitMod" class="modal-btn primary">Uygula</button>
  `);

  document.getElementById('submitMod').onclick = async () => {
    try {
      await request(API.moderation, {
        method: 'POST',
        body: JSON.stringify({
          serverId: currentServerId,
          targetUser: document.getElementById('modUser').value,
          action: document.getElementById('modAction').value,
          reason: document.getElementById('modReason').value.trim(),
          actor: currentUser
        })
      });
      hideModal();
    } catch (error) {
      alert(error.message);
    }
  };
}

function reportUser() {
  const server = getCurrentServer();
  showModal(`
    <h2>Mesaj Raporla</h2>
    <select id="reportUser" class="modal-input">
      ${server.members.filter((member) => member.username !== currentUser).map((member) => `<option value="${member.username}">${member.username}</option>`).join('')}
    </select>
    <input id="reportReason" class="modal-input" placeholder="Rapor nedeni" />
    <button id="submitReport" class="modal-btn primary">Gonder</button>
  `);

  document.getElementById('submitReport').onclick = async () => {
    try {
      await request(API.report, {
        method: 'POST',
        body: JSON.stringify({
          serverId: currentServerId,
          reporter: currentUser,
          targetUser: document.getElementById('reportUser').value,
          channelId: currentChannelId,
          reason: document.getElementById('reportReason').value.trim()
        })
      });
      hideModal();
    } catch (error) {
      alert(error.message);
    }
  };
}

function toggleVoice() {
  const channel = getCurrentChannel();
  const server = getCurrentServer();
  if (!server) {
    return;
  }

  if (currentVoiceChannelId) {
    ws.send(JSON.stringify({
      type: 'leaveVoice',
      username: currentUser,
      serverId: currentServerId
    }));
    currentVoiceChannelId = null;
    renderVoicePanel();
    renderHeader();
    return;
  }

  if (!channel || channel.kind !== 'voice') {
    alert('Bir sesli kanala gec ve sonra Katil butonunu kullan.');
    return;
  }

  currentVoiceChannelId = channel.id;
  ws.send(JSON.stringify({
    type: 'joinVoice',
    username: currentUser,
    serverId: currentServerId,
    channelId: channel.id
  }));
  renderVoicePanel();
  renderHeader();
}

function joinVoice() {
  if (!currentVoiceChannelId) {
    toggleVoice();
  }
}

function joinVoiceFromCallPanel() {
  if (currentVoiceChannelId) {
    showToast('Zaten bir sesli odadasin.');
    return;
  }

  const currentChannel = getCurrentChannel();
  if (currentChannel?.kind === 'voice') {
    toggleVoice();
    return;
  }

  const server = getCurrentServer();
  const firstVoiceChannel = server?.categories
    .flatMap((category) => category.channels)
    .find((channel) => channel.kind === 'voice');

  if (!firstVoiceChannel) {
    alert('Bu sunucuda sesli oda yok.');
    return;
  }

  currentChannelId = firstVoiceChannel.id;
  toggleVoice();
  renderAll();
}

function leaveVoice() {
  if (currentVoiceChannelId) {
    toggleVoice();
  }
}

async function startVideoCall() {
  const channel = getCurrentChannel();
  const callChannelId = channel?.kind === 'voice' ? currentChannelId : currentVoiceChannelId;
  if (!callChannelId) {
    alert('Goruntulu konusma icin once bir sesli odaya katil.');
    return;
  }

  try {
    await ensureLocalMedia();
    activeCallChannelId = callChannelId;
    ws.send(JSON.stringify({
      type: 'joinCall',
      username: currentUser,
      serverId: currentServerId,
      channelId: callChannelId
    }));
    showToast('Goruntulu konusma baslatildi.');
    openCallPanel();
    renderVideoPanel();
  } catch (error) {
    const message = error instanceof Error ? error.message : explainMediaError(error);
    lastCallCapabilityMessage = message;
    renderVideoPanel();
    alert(message);
  }
}

function stopLocalMedia() {
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  stopSpeakingMonitor(currentUser);
}

function endVideoCall() {
  if (!activeCallChannelId && !localStream) {
    return;
  }

  ws.send(JSON.stringify({
    type: 'leaveCall',
    username: currentUser,
    channelId: activeCallChannelId || currentChannelId
  }));
  stopLocalMedia();
  activeCallChannelId = null;
  cleanupCallUi();
  closeCallPanel();
  showToast('Goruntulu konusma sonlandirildi.');
}

function toggleMic() {
  if (!localStream) {
    showToast('Once goruntulu konusma baslat.');
    return;
  }
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = micEnabled;
  });
  renderVideoPanel();
  showToast(micEnabled ? 'Mikrofon acildi.' : 'Mikrofon kapatildi.');
}

function toggleCamera() {
  if (!localStream) {
    showToast('Once goruntulu konusma baslat.');
    return;
  }
  cameraEnabled = !cameraEnabled;
  localStream.getVideoTracks().forEach((track) => {
    track.enabled = cameraEnabled;
  });
  renderVideoPanel();
  showToast(cameraEnabled ? 'Kamera acildi.' : 'Kamera kapatildi.');
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}

function messageMentionsUser(messageText, username) {
  const normalizedText = normalizeSearchText(messageText).replace(/[^a-z0-9_@]+/g, ' ');
  const normalizedUsername = normalizeSearchText(username).replace(/[^a-z0-9_]+/g, '');
  return normalizedUsername ? normalizedText.includes(`@${normalizedUsername}`) : false;
}

function showSearchModal() {
  const list = (appState.messages[currentChannelId] || []).slice(-20);
  const users = appState.users.filter((user) => user.username !== currentUser);
  showModal(`
    <h2>Ara</h2>
    <input id="searchInput" class="modal-input" placeholder="Mesaj veya kullanici adi yaz" />
    <div class="report-card" style="margin-top:12px;">
      <div><strong>Kullanici Arama</strong></div>
      <div id="userSearchResults" class="panel-subtitle">Kullanici adina gore arayip arkadas ekleyebilirsin.</div>
    </div>
    <div class="report-card" style="margin-top:12px;">
      <div><strong>Kanal Mesajlari</strong></div>
      <div id="searchResults" class="panel-subtitle">Son 20 mesaj aranacak.</div>
    </div>
  `);

  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  const userResults = document.getElementById('userSearchResults');

  const renderUsers = (q) => {
    const normalizedQuery = normalizeSearchText(q);
    const matches = normalizedQuery
      ? users.filter((user) => normalizeSearchText(user.username).includes(normalizedQuery))
      : users.slice(0, 12);

    if (!matches.length) {
      userResults.innerHTML = 'Kullanici bulunamadi.';
      return;
    }

    userResults.innerHTML = matches.map((user) => {
      const friend = isFriend(user.username);
      const blocked = isBlockedUser(user.username);
      const incomingRequest = hasIncomingRequest(user.username);
      const outgoingRequest = hasOutgoingRequest(user.username);
      const blockedByTarget = Array.isArray(user.blocked) && user.blocked.includes(currentUser);
      const disabled = blocked || blockedByTarget;
      const label = blocked
        ? 'Engelli'
        : blockedByTarget
          ? 'Engelledi'
          : friend
            ? 'Arkadas'
            : incomingRequest
              ? 'Kabul Et'
              : outgoingRequest
                ? 'Istek Gonderildi'
                : 'Istek Gonder';

      return `
        <div class="member-row" style="margin-top:8px;">
          <div style="display:flex; gap:10px; align-items:center;">
            ${avatarMarkup(user.username, 'member-avatar')}
            <div>
              <div class="member-name">${escapeHtml(user.username)}</div>
              <div class="member-role">${escapeHtml(turkceDurum(appState.presence[user.username]?.status || 'offline'))}</div>
            </div>
          </div>
          <div class="member-actions">
            <button class="mini-action-btn search-profile-btn" data-username="${user.username}">Profil</button>
            <button class="mini-action-btn search-add-btn" data-username="${user.username}" ${disabled || outgoingRequest || friend ? 'disabled' : ''}>${label}</button>
          </div>
        </div>
      `;
    }).join('');

    userResults.querySelectorAll('.search-profile-btn').forEach((button) => {
      button.onclick = () => showUserProfile(button.dataset.username);
    });

    userResults.querySelectorAll('.search-add-btn').forEach((button) => {
      button.onclick = async () => {
        try {
          const targetUser = button.dataset.username;
          const incomingForTarget = hasIncomingRequest(targetUser);
          const data = await request(API.social, {
            method: 'POST',
            body: JSON.stringify({
              actor: currentUser,
              targetUser,
              action: incomingForTarget ? 'accept-request' : 'send-request'
            })
          });
          syncSocialState(data.social);
          showToast(incomingForTarget ? `${targetUser} ile arkadas oldun.` : `${targetUser} kullanicisina istek gonderildi.`);
          renderUsers(q);
        } catch (error) {
          alert(error.message);
        }
      };
    });
  };

  input.oninput = () => {
    const q = input.value.trim();
    const normalizedQuery = normalizeSearchText(q);
    const matches = list.filter((message) => normalizeSearchText(message.text).includes(normalizedQuery));
    renderUsers(q);
    results.innerHTML = q
      ? (matches.length
          ? matches.map((message) => `<div class="report-card"><strong>${escapeHtml(message.user)}</strong><div>${escapeHtml(message.text)}</div></div>`).join('')
          : 'Mesaj bulunamadi.')
      : 'Son 20 mesaj aranacak.';
  };

  renderUsers('');
}

function showFriendRequestsModal() {
  const incoming = mySocial().incomingRequests;
  showModal(`
    <h2>Arkadaslik Istekleri</h2>
    <div id="friendRequestsModalList">${incoming.length ? '' : '<div class="panel-subtitle">Bekleyen istek yok.</div>'}</div>
  `);

  const container = document.getElementById('friendRequestsModalList');
  if (!incoming.length) {
    return;
  }

  container.innerHTML = incoming.map((username) => `
    <div class="member-row" style="margin-top:8px;">
      <div style="display:flex; gap:10px; align-items:center;">
        ${avatarMarkup(username, 'member-avatar')}
        <div>
          <div class="member-name">${escapeHtml(username)}</div>
          <div class="member-role">bekleyen istek</div>
        </div>
      </div>
      <div class="member-actions">
        <button class="mini-action-btn request-accept-btn" data-username="${username}">Kabul</button>
        <button class="mini-action-btn request-reject-btn" data-username="${username}">Reddet</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.request-accept-btn').forEach((button) => {
    button.onclick = async () => {
      try {
        const data = await request(API.social, {
          method: 'POST',
          body: JSON.stringify({
            actor: currentUser,
            targetUser: button.dataset.username,
            action: 'accept-request'
          })
        });
        syncSocialState(data.social);
        showFriendRequestsModal();
        renderAll();
        showToast('Arkadaslik istegi kabul edildi.');
      } catch (error) {
        alert(error.message);
      }
    };
  });

  container.querySelectorAll('.request-reject-btn').forEach((button) => {
    button.onclick = async () => {
      try {
        const data = await request(API.social, {
          method: 'POST',
          body: JSON.stringify({
            actor: currentUser,
            targetUser: button.dataset.username,
            action: 'reject-request'
          })
        });
        syncSocialState(data.social);
        showFriendRequestsModal();
        renderAll();
        showToast('Arkadaslik istegi reddedildi.');
      } catch (error) {
        alert(error.message);
      }
    };
  });
}

function showPinnedInfo() {
  const server = getCurrentServer();
  const channel = getCurrentChannel();
  showModal(`
    <h2>Kanal Bilgisi</h2>
    <div class="report-card"><strong>Sunucu</strong><div>${escapeHtml(server?.name || '-')}</div></div>
    <div class="report-card"><strong>Kanal</strong><div>${escapeHtml(channel?.name || '-')}</div></div>
    <div class="report-card"><strong>Rolun</strong><div>${escapeHtml(myRole())}</div></div>
  `);
}

function openQuickActions() {
  showModal(`
    <h2>Hizli Islemler</h2>
    <button id="quickCreateChannel" class="modal-btn primary">Kanal Ekle</button>
    <button id="quickCreateCategory" class="modal-btn secondary">Kategori Ekle</button>
    <button id="quickAttach" class="modal-btn secondary">Dosya / Resim Ekle</button>
    <button id="quickReport" class="modal-btn secondary">Rapor Olustur</button>
  `);

  document.getElementById('quickCreateChannel').onclick = () => {
    hideModal();
    createChannel();
  };
  document.getElementById('quickCreateCategory').onclick = () => {
    hideModal();
    createCategory();
  };
  document.getElementById('quickAttach').onclick = () => {
    hideModal();
    attachmentInput.click();
  };
  document.getElementById('quickReport').onclick = () => {
    hideModal();
    reportUser();
  };
}

function toggleMembersPanel() {
  if (isMobileLayout()) {
    const willOpen = !sidebar.classList.contains('mobile-open');
    channelsPanel.classList.remove('mobile-open');
    sidebar.classList.toggle('mobile-open', willOpen);
    updateMobileBackdrop();
    return;
  }

  sidebar.classList.toggle('hidden-panel');
}

function handleNavInfo(section) {
  if (isMobileLayout()) {
    if (section === 'home') {
      openMobilePanel('channels');
      return;
    }
    if (section === 'chat') {
      closeMobilePanels();
      return;
    }
    if (section === 'apps') {
      openQuickActions();
      return;
    }
  }

  const texts = {
    home: 'Sunucu genel panelindesin.',
    chat: 'Sohbet moduna geri donuldu.',
    game: 'Oyunlar ikonu simdilik demo bilgilendirme aciyor.',
    apps: 'Araclar ikonu kanal yonetimini temsil ediyor.'
  };
  showToast(texts[section]);
}

window.onload = () => {
  applyTheme(currentTheme);
  handleResponsiveLayout();
  appShell.classList.add('hidden');
  showLogin();
  document.body.addEventListener('click', () => {
    ensureNotificationsEnabled();
    if (audioContext?.state === 'suspended') {
      audioContext.resume();
    }
  }, { once: true });

  sendBtn.onclick = sendMessage;
  messageInput.onkeydown = (event) => {
    if (event.key === 'Enter') {
      sendMessage();
    }
  };
  messageInput.oninput = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(JSON.stringify({
      type: 'typing',
      scope: activeSidebarTab === 'dm' && activeDmUser ? 'dm' : 'channel',
      username: currentUser,
      peerUsername: activeDmUser,
      channelId: currentChannelId,
      isTyping: Boolean(messageInput.value.trim())
    }));

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'typing',
          scope: activeSidebarTab === 'dm' && activeDmUser ? 'dm' : 'channel',
          username: currentUser,
          peerUsername: activeDmUser,
          channelId: currentChannelId,
          isTyping: false
        }));
      }
    }, 1200);
  };
  modalOverlay.onclick = (event) => {
    if (event.target === modalOverlay) {
      hideModal();
    }
  };
  callOverlay.onclick = (event) => {
    if (event.target === callOverlay) {
      closeCallPanel();
    }
  };
  mobileBackdrop.onclick = closeMobilePanels;
  createServerBtn.onclick = createServer;
  createCategoryBtn.onclick = createCategory;
  createChannelBtn.onclick = createChannel;
  inviteServerBtn.onclick = showInviteCode;
  joinServerBtn.onclick = joinServerByCode;
  assignRoleBtn.onclick = assignRole;
  moderateBtn.onclick = moderateUser;
  reportBtn.onclick = reportUser;
  deleteServerBtn.onclick = deleteServer;
  friendRequestsBtn.onclick = showFriendRequestsModal;
  joinVoiceBtn.onclick = joinVoice;
  leaveVoiceBtn.onclick = leaveVoice;
  logoutBtn.onclick = () => location.reload();
  themeToggleBtn.onclick = () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
  };
  startVideoBtn.onclick = startVideoCall;
  endVideoBtn.onclick = endVideoCall;
  toggleMicBtn.onclick = toggleMic;
  toggleCameraBtn.onclick = toggleCamera;
  videoBtn.onclick = openCallPanel;
  minimizeCallBtn.onclick = closeCallPanel;
  closeCallBtn.onclick = closeCallPanel;
  joinVoiceFromCallBtn.onclick = joinVoiceFromCallPanel;
  searchBtn.onclick = showSearchModal;
  notificationCenterBtn.onclick = showNotificationCenter;
  pinBtn.onclick = showPinnedInfo;
  membersToggleBtn.onclick = toggleMembersPanel;
  membersTabBtn.onclick = () => {
    activeSidebarTab = 'members';
    activeDmUser = null;
    renderAll();
  };
  dmTabBtn.onclick = () => {
    activeSidebarTab = 'dm';
    if (!activeDmUser) {
      activeDmUser = appState.users.find((user) => user.username !== currentUser)?.username || null;
    }
    if (activeDmUser) {
      openDm(activeDmUser);
    } else {
      renderAll();
    }
  };
  composerAddBtn.onclick = openQuickActions;
  attachmentInput.onchange = () => {
    const file = attachmentInput.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingAttachment = {
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result
      };
      updateComposerPlaceholder();
      showToast(`${file.name} eklendi. Mesaji gonderince paylasilacak.`);
      attachmentInput.value = '';
    };
    reader.readAsDataURL(file);
  };
  navHomeBtn.onclick = () => handleNavInfo('home');
  navChatBtn.onclick = () => handleNavInfo('chat');
  navGameBtn.onclick = () => handleNavInfo('game');
  navAppsBtn.onclick = () => handleNavInfo('apps');
  window.addEventListener('resize', handleResponsiveLayout);

  presenceSelect.onchange = async () => {
    try {
      await request(API.presence, {
        method: 'POST',
        body: JSON.stringify({ username: currentUser, status: presenceSelect.value })
      });
      appState.presence[currentUser] = appState.presence[currentUser] || {};
      appState.presence[currentUser].status = presenceSelect.value;
      renderMembers();
    } catch (error) {
      alert(error.message);
    }
  };
};
