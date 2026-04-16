const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend', 'public');
const DATABASE_URL = process.env.DATABASE_URL || '';
const pgPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL.includes('localhost') || DATABASE_URL.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false }
    })
  : null;

app.use(express.json({ limit: '10mb' }));

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function inviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function now() {
  return Date.now();
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function fetchMeteredIceServers() {
  const baseUrl = process.env.METERED_TURN_BASE_URL;
  const apiKey = process.env.METERED_API_KEY;
  if (!baseUrl || !apiKey) {
    return [];
  }

  const ttl = Number(process.env.METERED_TURN_TTL || 86400);
  const requestUrl = new URL('/api/v1/turn/credentials', baseUrl);
  requestUrl.searchParams.set('apiKey', apiKey);
  requestUrl.searchParams.set('ttl', String(Number.isFinite(ttl) && ttl > 0 ? ttl : 86400));

  try {
    const response = await fetch(requestUrl, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    if (!Array.isArray(data)) {
      return [];
    }
    return data
      .filter((item) => item && item.urls)
      .map((item) => ({
        urls: item.urls,
        username: item.username,
        credential: item.credential
      }));
  } catch {
    return [];
  }
}

function resetCodeHash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function defaultState() {
  const generalServerId = 'srv_campus';
  const generalTextId = 'chn_general';
  const announcementsId = 'chn_announcements';
  const modRoomId = 'chn_mod_room';
  const voiceLobbyId = 'chn_voice_lounge';
  const studyVoiceId = 'chn_study_hall';

  return {
    users: [
      { username: 'admin', password: '123', banned: false, mutedUntil: null, status: 'online', friends: [], blocked: [], incomingRequests: [], outgoingRequests: [] },
      { username: 'moderator', password: '123', banned: false, mutedUntil: null, status: 'away', friends: [], blocked: [], incomingRequests: [], outgoingRequests: [] },
      { username: 'student', password: '123', banned: false, mutedUntil: null, status: 'online', friends: [], blocked: [], incomingRequests: [], outgoingRequests: [] }
    ],
    directMessages: {},
    servers: [
      {
        id: generalServerId,
        name: 'Ostim Community',
        creator: 'admin',
        members: [
          { username: 'admin', role: 'admin' },
          { username: 'moderator', role: 'mod' },
          { username: 'student', role: 'member' }
        ],
        categories: [
          {
            id: 'cat_info',
            name: 'Bilgilendirme',
            channels: [
              { id: announcementsId, name: 'announcements', kind: 'text', allowedRoles: ['admin', 'mod', 'member'] },
              { id: generalTextId, name: 'general', kind: 'text', allowedRoles: ['admin', 'mod', 'member'] },
              { id: modRoomId, name: 'mod-only', kind: 'text', allowedRoles: ['admin', 'mod'] }
            ]
          },
          {
            id: 'cat_voice',
            name: 'Sesli Odalar',
            channels: [
              { id: voiceLobbyId, name: 'voice-lounge', kind: 'voice', allowedRoles: ['admin', 'mod', 'member'] },
              { id: studyVoiceId, name: 'study-hall', kind: 'voice', allowedRoles: ['admin', 'mod', 'member'] }
            ]
          }
        ],
        reports: [],
        polls: [],
        pinnedMessageIds: [],
        moderationLogs: [],
        inviteCode: null
      }
    ],
    messages: {
      [announcementsId]: [
        { id: uid('msg'), user: 'admin', text: 'Sunucuya hos geldiniz. /help ile komutlari gorebilirsiniz.', time: now(), reactions: {} }
      ],
      [generalTextId]: [
        { id: uid('msg'), user: 'student', text: 'Merhaba millet.', time: now() - 60_000, reactions: {} },
        { id: uid('msg'), user: 'moderator', text: 'Kurallara dikkat edelim.', time: now() - 30_000, reactions: {} }
      ],
      [modRoomId]: [
        { id: uid('msg'), user: 'moderator', text: 'Raporlari buradan takip edelim.', time: now() - 15_000, reactions: {} }
      ]
    },
    voicePresence: {
      [voiceLobbyId]: ['student'],
      [studyVoiceId]: []
    },
    presence: {
      admin: { status: 'online', currentServerId: generalServerId, currentChannelId: announcementsId, voiceChannelId: null },
      moderator: { status: 'away', currentServerId: generalServerId, currentChannelId: modRoomId, voiceChannelId: null },
      student: { status: 'online', currentServerId: generalServerId, currentChannelId: generalTextId, voiceChannelId: voiceLobbyId }
    },
    passwordResetTokens: []
  };
}

function loadState() {
  ensureDataDir();
  if (!fs.existsSync(STATE_FILE)) {
    const initial = defaultState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    const initial = defaultState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

function normalizeState(loadedState) {
  const nextState = loadedState || {};

  nextState.users = Array.isArray(nextState.users) ? nextState.users : [];
  nextState.servers = Array.isArray(nextState.servers) ? nextState.servers : [];
  nextState.messages = nextState.messages && typeof nextState.messages === 'object' ? nextState.messages : {};
  nextState.directMessages = nextState.directMessages && typeof nextState.directMessages === 'object' ? nextState.directMessages : {};
  nextState.voicePresence = nextState.voicePresence && typeof nextState.voicePresence === 'object' ? nextState.voicePresence : {};
  nextState.presence = nextState.presence && typeof nextState.presence === 'object' ? nextState.presence : {};
  nextState.passwordResetTokens = Array.isArray(nextState.passwordResetTokens) ? nextState.passwordResetTokens : [];

  nextState.users.forEach((user) => {
    user.email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
    user.friends = Array.isArray(user.friends) ? [...new Set(user.friends)] : [];
    user.blocked = Array.isArray(user.blocked) ? [...new Set(user.blocked)] : [];
    user.incomingRequests = Array.isArray(user.incomingRequests) ? [...new Set(user.incomingRequests)] : [];
    user.outgoingRequests = Array.isArray(user.outgoingRequests) ? [...new Set(user.outgoingRequests)] : [];
    if (!nextState.presence[user.username]) {
      nextState.presence[user.username] = {
        status: user.status || 'offline',
        currentServerId: nextState.servers[0]?.id || null,
        currentChannelId: nextState.servers[0]?.categories?.[0]?.channels?.[0]?.id || null,
        voiceChannelId: null
      };
    }
  });

  nextState.servers.forEach((server) => {
    server.reports = Array.isArray(server.reports) ? server.reports : [];
    server.polls = Array.isArray(server.polls) ? server.polls : [];
    server.pinnedMessageIds = Array.isArray(server.pinnedMessageIds) ? server.pinnedMessageIds : [];
    server.moderationLogs = Array.isArray(server.moderationLogs) ? server.moderationLogs : [];
    server.inviteCode = typeof server.inviteCode === 'string' ? server.inviteCode : inviteCode();
    if (typeof server.creator !== 'string' || !server.creator) {
      const adminMember = Array.isArray(server.members)
        ? server.members.find((member) => member.role === 'admin')
        : null;
      server.creator = adminMember?.username || server.members?.[0]?.username || null;
    }
    if (Array.isArray(server.members) && server.members.length && !server.members.some((member) => member.role === 'admin')) {
      server.members[0].role = 'admin';
    }
  });

  Object.keys(nextState.messages).forEach((channelId) => {
    nextState.messages[channelId] = (nextState.messages[channelId] || []).map((message) => ({
      reactions: {},
      attachment: null,
      ...message
    }));
  });

  Object.keys(nextState.directMessages).forEach((dmKey) => {
    nextState.directMessages[dmKey] = (nextState.directMessages[dmKey] || []).map((message) => ({
      reactions: {},
      seenBy: Array.isArray(message.seenBy) ? message.seenBy : [message.user],
      ...message
    }));
  });

  return nextState;
}

let persistenceMode = pgPool ? 'postgres' : 'file';
let state = normalizeState(defaultState());
const callPresence = {};
const onlineUsers = new Set();
const typingState = {};
let saveChain = Promise.resolve();

function saveState() {
  const snapshot = JSON.parse(JSON.stringify(state));
  saveChain = saveChain
    .then(() => persistState(snapshot))
    .catch((error) => {
      console.error('State persistence failed:', error);
    });
  return saveChain;
}

async function persistState(snapshot) {
  if (pgPool) {
    await pgPool.query(
      `
        INSERT INTO app_state (id, state_json, updated_at)
        VALUES (1, $1::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()
      `,
      [JSON.stringify(snapshot)]
    );
    return;
  }

  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(snapshot, null, 2));
}

async function initializePersistence() {
  if (!pgPool) {
    state = normalizeState(loadState());
    return;
  }

  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY,
        state_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const existing = await pgPool.query('SELECT state_json FROM app_state WHERE id = 1');
    if (existing.rows[0]?.state_json) {
      state = normalizeState(existing.rows[0].state_json);
      persistenceMode = 'postgres';
      return;
    }

    const seededState = normalizeState(loadState());
    state = seededState;
    await persistState(seededState);
    persistenceMode = 'postgres';
  } catch (error) {
    console.error('PostgreSQL unavailable, file persistence fallback enabled:', error.message);
    persistenceMode = 'file';
    state = normalizeState(loadState());
  }
}

function sanitizeUser(user) {
  return {
    username: user.username,
    banned: Boolean(user.banned),
    mutedUntil: user.mutedUntil,
    avatar: user.avatar || null,
    friends: Array.isArray(user.friends) ? user.friends : [],
    blocked: Array.isArray(user.blocked) ? user.blocked : [],
    incomingRequests: Array.isArray(user.incomingRequests) ? user.incomingRequests : [],
    outgoingRequests: Array.isArray(user.outgoingRequests) ? user.outgoingRequests : [],
    status: onlineUsers.has(user.username)
      ? (state.presence[user.username]?.status || user.status || 'online')
      : 'offline'
  };
}

function buildEffectivePresence() {
  const effectivePresence = {};

  state.users.forEach((user) => {
    const storedPresence = state.presence[user.username] || {};
    effectivePresence[user.username] = {
      ...storedPresence,
      status: onlineUsers.has(user.username)
        ? (storedPresence.status || user.status || 'online')
        : 'offline'
    };
  });

  return effectivePresence;
}

function removeUserFromVoice(username) {
  let changed = false;
  Object.keys(state.voicePresence).forEach((channelId) => {
    const previousLength = (state.voicePresence[channelId] || []).length;
    state.voicePresence[channelId] = (state.voicePresence[channelId] || []).filter((user) => user !== username);
    if (state.voicePresence[channelId].length !== previousLength) {
      changed = true;
    }
  });

  if (state.presence[username]?.voiceChannelId) {
    state.presence[username].voiceChannelId = null;
    changed = true;
  }

  return changed;
}

function cleanupOfflineVoicePresence() {
  let changed = false;
  const validUsers = new Set(state.users.map((user) => user.username));

  Object.keys(state.voicePresence).forEach((channelId) => {
    const filtered = (state.voicePresence[channelId] || []).filter((username, index, list) => (
      validUsers.has(username)
      && onlineUsers.has(username)
      && list.indexOf(username) === index
    ));
    if (filtered.length !== (state.voicePresence[channelId] || []).length) {
      changed = true;
    }
    state.voicePresence[channelId] = filtered;
  });

  state.users.forEach((user) => {
    if (!onlineUsers.has(user.username) && state.presence[user.username]?.voiceChannelId) {
      state.presence[user.username].voiceChannelId = null;
      changed = true;
    }
  });

  return changed;
}

function publicBaseUrl(req) {
  const configured = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (configured) {
    return configured.replace(/\/$/, '');
  }
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  return `${proto}://${req.get('host')}`;
}

async function sendPasswordResetEmail(email, resetUrl, username, resetCode) {
  if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
    return { sent: false, reason: 'missing_config' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Topluluk Sunucusu sifre sifirlama',
      html: `
        <p>Merhaba ${username},</p>
        <p>Sifreni yenilemek icin asagidaki kodu kullanabilir veya baglantiya tiklayabilirsin.</p>
        <p><strong style="font-size: 24px; letter-spacing: 4px;">${resetCode}</strong></p>
        <p><a href="${resetUrl}">Sifremi sifirla</a></p>
        <p>Bu kod ve baglanti 30 dakika gecerlidir.</p>
        <p>Bu istegi sen yapmadiysan bu e-postayi yok sayabilirsin.</p>
      `
    })
  });

  if (response.ok) {
    return { sent: true };
  }

  const details = await response.text().catch(() => '');
  console.error('Resend rejected password reset email:', response.status, details);
  return { sent: false, reason: 'resend_rejected', status: response.status };
}

function getDmKey(userA, userB) {
  return [userA, userB].sort().join('__');
}

function getDmMessages(userA, userB) {
  return state.directMessages[getDmKey(userA, userB)] || [];
}

function markDmSeen(viewer, peerUsername) {
  const messages = getDmMessages(viewer, peerUsername);
  let changed = false;

  messages.forEach((message) => {
    if (message.user !== viewer) {
      message.seenBy = Array.isArray(message.seenBy) ? message.seenBy : [];
      if (!message.seenBy.includes(viewer)) {
        message.seenBy.push(viewer);
        changed = true;
      }
    }
  });

  return changed;
}

function buildVisibleDms(username) {
  const result = {};
  state.users.forEach((user) => {
    if (user.username !== username) {
      result[user.username] = getDmMessages(username, user.username);
    }
  });
  return result;
}

function getUser(username) {
  return state.users.find((user) => user.username === username);
}

function getServer(serverId) {
  return state.servers.find((srv) => srv.id === serverId);
}

function getServerMember(server, username) {
  return server.members.find((member) => member.username === username);
}

function areUsersBlocked(userA, userB) {
  const left = getUser(userA);
  const right = getUser(userB);
  if (!left || !right) {
    return false;
  }
  return left.blocked.includes(userB) || right.blocked.includes(userA);
}

function buildSocialState(username) {
  const user = getUser(username);
  return {
    friends: Array.isArray(user?.friends) ? user.friends : [],
    blocked: Array.isArray(user?.blocked) ? user.blocked : [],
    incomingRequests: Array.isArray(user?.incomingRequests) ? user.incomingRequests : [],
    outgoingRequests: Array.isArray(user?.outgoingRequests) ? user.outgoingRequests : []
  };
}

function getChannelById(server, channelId) {
  for (const category of server.categories) {
    for (const channel of category.channels) {
      if (channel.id === channelId) {
        return { category, channel };
      }
    }
  }
  return null;
}

function canAccessChannel(server, username, channelId) {
  const member = getServerMember(server, username);
  if (!member) {
    return false;
  }

  const channelInfo = getChannelById(server, channelId);
  if (!channelInfo) {
    return false;
  }

  return channelInfo.channel.allowedRoles.includes(member.role);
}

function serializeServer(server, username) {
  const member = getServerMember(server, username);
  const effectivePresence = buildEffectivePresence();
  const visibleCategories = server.categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      channels: category.channels
        .filter((channel) => !username || canAccessChannel(server, username, channel.id))
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          kind: channel.kind,
          allowedRoles: channel.allowedRoles
        }))
    }))
    .filter((category) => category.channels.length > 0);

  return {
    id: server.id,
    name: server.name,
    creator: server.creator || null,
    isCreator: server.creator === username,
    myRole: member?.role || null,
    members: server.members.map((serverMember) => ({
      username: serverMember.username,
      role: serverMember.role,
      status: effectivePresence[serverMember.username]?.status || 'offline'
    })),
    categories: visibleCategories,
    reports: server.reports,
    polls: server.polls,
    pinnedMessageIds: server.pinnedMessageIds,
    moderationLogs: server.moderationLogs,
    inviteCode: member && ['admin', 'mod'].includes(member.role) ? server.inviteCode : null
  };
}

function buildVisibleMessagesForUser(username) {
  const visibleMessages = {};

  state.servers.forEach((serverItem) => {
    serverItem.categories.forEach((category) => {
      category.channels.forEach((channel) => {
        if (canAccessChannel(serverItem, username, channel.id)) {
          visibleMessages[channel.id] = state.messages[channel.id] || [];
        }
      });
    });
  });

  return visibleMessages;
}

function buildBootstrap(username) {
  const effectivePresence = buildEffectivePresence();
  return {
    currentUser: sanitizeUser(getUser(username)),
    social: buildSocialState(username),
    users: state.users.map(sanitizeUser),
    servers: state.servers
      .filter((serverItem) => getServerMember(serverItem, username))
      .map((serverItem) => serializeServer(serverItem, username)),
    messages: buildVisibleMessagesForUser(username),
    directMessages: buildVisibleDms(username),
    voicePresence: state.voicePresence,
    presence: effectivePresence,
    callPresence,
    typingState
  };
}

function ensureDefaultMembership(username) {
  const defaultServer = state.servers[0];
  if (!defaultServer) {
    return;
  }
  const alreadyMember = getServerMember(defaultServer, username);
  if (!alreadyMember) {
    defaultServer.members.push({ username, role: 'member' });
  }
}

function getStatsForServer(server, username) {
  const visibleTextChannels = [];
  const visibleVoiceChannels = [];

  server.categories.forEach((category) => {
    category.channels.forEach((channel) => {
      if (!canAccessChannel(server, username, channel.id)) {
        return;
      }

      if (channel.kind === 'voice') {
        visibleVoiceChannels.push(channel);
      } else {
        visibleTextChannels.push(channel);
      }
    });
  });

  return {
    memberCount: server.members.length,
    visibleTextChannels: visibleTextChannels.length,
    visibleVoiceChannels: visibleVoiceChannels.length,
    reportCount: server.reports.filter((report) => report.status === 'open').length
  };
}

function broadcastState() {
  const effectivePresence = buildEffectivePresence();
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }

    const info = wsClients.get(client);
    if (!info?.username) {
      return;
    }

    client.send(JSON.stringify({
      type: 'stateUpdated',
      users: state.users.map(sanitizeUser),
      social: buildSocialState(info.username),
      presence: effectivePresence,
      voicePresence: state.voicePresence,
      callPresence,
      typingState
    }));
  });
}

function broadcast(type, payload) {
  const message = JSON.stringify({ type, ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastServer(serverId) {
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return;
  }
  const effectivePresence = buildEffectivePresence();

  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) {
      return;
    }

    const info = wsClients.get(client);
    if (!info?.username) {
      return;
    }

    const member = getServerMember(serverItem, info.username);
    if (!member) {
      return;
    }

    client.send(JSON.stringify({
      type: 'serverUpdated',
      server: serializeServer(serverItem, info.username),
      messages: buildVisibleMessagesForUser(info.username),
      directMessages: buildVisibleDms(info.username),
      voicePresence: state.voicePresence,
      presence: effectivePresence,
      callPresence,
      typingState
    }));
  });
}

function setTyping(scopeKey, username, isTyping) {
  typingState[scopeKey] = typingState[scopeKey] || [];
  typingState[scopeKey] = typingState[scopeKey].filter((item) => item !== username);
  if (isTyping) {
    typingState[scopeKey].push(username);
  }
  if (!typingState[scopeKey].length) {
    delete typingState[scopeKey];
  }
}

function postSystemMessage(channelId, text) {
  if (!state.messages[channelId]) {
    state.messages[channelId] = [];
  }

  const message = { id: uid('msg'), user: 'system', text, time: now(), reactions: {}, attachment: null };
  state.messages[channelId].push(message);
  return message;
}

function ensureMessageShape(message) {
  if (!message.reactions || typeof message.reactions !== 'object') {
    message.reactions = {};
  }
  return message;
}

function getMessage(channelId, messageId) {
  const messages = state.messages[channelId] || [];
  return messages.find((message) => message.id === messageId) || null;
}

function canModerateMessage(serverId, username) {
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return false;
  }
  const member = getServerMember(serverItem, username);
  return Boolean(member && ['admin', 'mod'].includes(member.role));
}

function appendModerationLog(serverItem, entry) {
  serverItem.moderationLogs = Array.isArray(serverItem.moderationLogs) ? serverItem.moderationLogs : [];
  serverItem.moderationLogs.unshift({
    id: uid('log'),
    time: now(),
    ...entry
  });
  serverItem.moderationLogs = serverItem.moderationLogs.slice(0, 30);
}

function sendChannelMessages(ws, channelId) {
  ws.send(JSON.stringify({
    type: 'messages',
    channelId,
    messages: state.messages[channelId] || []
  }));
}

function sendDmMessages(ws, username, peerUsername) {
  ws.send(JSON.stringify({
    type: 'dmMessages',
    peerUsername,
    messages: getDmMessages(username, peerUsername)
  }));
}

function handleCommand({ serverId, channelId, username, commandText }) {
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return { error: 'Sunucu bulunamadi.' };
  }

  const [command, ...rest] = commandText.slice(1).split(' ');
  const args = rest.join(' ').trim();

  if (command === 'help') {
    return {
      systemText: 'Komutlar: /help, /stats, /poll soru | secenek1 | secenek2'
    };
  }

  if (command === 'stats') {
    const stats = getStatsForServer(serverItem, username);
    return {
      systemText: `Uyeler: ${stats.memberCount}, yazi kanali: ${stats.visibleTextChannels}, sesli oda: ${stats.visibleVoiceChannels}, acik rapor: ${stats.reportCount}`
    };
  }

  if (command === 'poll') {
    const pieces = args.split('|').map((piece) => piece.trim()).filter(Boolean);
    if (pieces.length < 3) {
      return { error: 'Ornek kullanim: /poll Soru | Secenek A | Secenek B' };
    }

    const [question, ...options] = pieces;
    const poll = {
      id: uid('poll'),
      question,
      options: options.map((option) => ({ label: option, votes: 0 })),
      createdBy: username,
      time: now(),
      channelId
    };

    serverItem.polls.unshift(poll);
    const pollText = `Anket: ${question} | ${options.join(' / ')}`;
    const message = { id: uid('msg'), user: 'bot', text: pollText, time: now(), reactions: {} };
    if (!state.messages[channelId]) {
      state.messages[channelId] = [];
    }
    state.messages[channelId].push(message);
    saveState();
    broadcastServer(serverId);
    return { postedMessage: message };
  }

  return { error: 'Bilinmeyen komut. /help yazabilirsin.' };
}

app.use('/', express.static(FRONTEND_DIR));

app.get('/api/bootstrap', (req, res) => {
  const username = req.query.username;
  const user = getUser(username);

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'User is banned.' });
  }

  res.json(buildBootstrap(username));
});

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    timestamp: now(),
    users: state.users.length,
    servers: state.servers.length,
    persistence: persistenceMode
  });
});

app.get('/api/rtc-config', async (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  const meteredIceServers = await fetchMeteredIceServers();
  if (meteredIceServers.length) {
    return res.json({ iceServers: [...iceServers, ...meteredIceServers] });
  }

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.json({ iceServers });
});

app.post('/api/register', (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password;
  const email = normalizeEmail(req.body.email);
  const avatar = req.body.avatar;

  if (!username || !password || !email) {
    return res.status(400).json({ error: 'Kullanici adi, e-posta ve sifre gerekli.' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Gecerli bir e-posta adresi gir.' });
  }

  if (avatar && (typeof avatar !== 'string' || !avatar.startsWith('data:image/'))) {
    return res.status(400).json({ error: 'Invalid avatar format.' });
  }

  if (getUser(username)) {
    return res.status(400).json({ error: 'Username already exists.' });
  }

  if (state.users.some((user) => normalizeEmail(user.email) === email)) {
    return res.status(400).json({ error: 'Bu e-posta ile zaten bir hesap var.' });
  }

  const user = {
    username,
    email,
    password,
    banned: false,
    mutedUntil: null,
    status: 'online',
    avatar: avatar || null,
    friends: [],
    blocked: [],
    incomingRequests: [],
    outgoingRequests: []
  };

  state.users.push(user);
  state.presence[username] = {
    status: 'online',
    currentServerId: state.servers[0]?.id || null,
    currentChannelId: state.servers[0]?.categories[0]?.channels[0]?.id || null,
    voiceChannelId: null
  };
  ensureDefaultMembership(username);
  saveState();
  broadcastState();
  state.servers.forEach((serverItem) => broadcastServer(serverItem.id));
  res.json({ success: true });
});

app.post('/api/password-reset/request', async (req, res) => {
  const username = req.body.username?.trim();
  const email = normalizeEmail(req.body.email);

  if (!username || !email) {
    return res.status(400).json({ error: 'Kullanici adi ve e-posta gerekli.' });
  }

  const user = getUser(username);
  const genericResponse = {
    success: true,
    message: 'Bilgiler eslesiyorsa sifre sifirlama baglantisi e-postana gonderildi.'
  };

  if (!user || normalizeEmail(user.email) !== email) {
    return res.json(genericResponse);
  }

  const token = crypto.randomBytes(32).toString('hex');
  const resetCode = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = now() + 30 * 60 * 1000;
  state.passwordResetTokens = (state.passwordResetTokens || [])
    .filter((item) => item.username !== username && item.expiresAt > now());
  state.passwordResetTokens.push({
    token,
    codeHash: resetCodeHash(resetCode),
    username,
    expiresAt,
    used: false,
    createdAt: now()
  });

  const resetUrl = `${publicBaseUrl(req)}?resetToken=${encodeURIComponent(token)}`;
  const mailResult = await sendPasswordResetEmail(email, resetUrl, username, resetCode).catch((error) => {
    console.error('Password reset email failed:', error.message);
    return { sent: false, reason: 'network_error' };
  });

  saveState();
  if (!mailResult.sent && mailResult.reason === 'missing_config') {
    return res.status(503).json({
      error: 'Mail servisi henuz ayarli degil. Render ortam degiskenlerine RESEND_API_KEY ve MAIL_FROM eklenmeli.'
    });
  }

  if (!mailResult.sent) {
    return res.status(503).json({
      error: 'Resend mail gonderimini reddetti. RESEND_API_KEY dogru mu ve MAIL_FROM adresi Resend tarafinda kullanilabilir mi kontrol et.'
    });
  }

  return res.json({ ...genericResponse, mailSent: true });
});

app.post('/api/password-reset/confirm', (req, res) => {
  const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
  const username = req.body.username?.trim();
  const email = normalizeEmail(req.body.email);
  const code = typeof req.body.code === 'string' ? req.body.code.trim() : '';
  const password = req.body.password;

  if ((!token && (!username || !email || !code)) || !password) {
    return res.status(400).json({ error: 'Sifirlama baglantisi veya kodu ve yeni sifre gerekli.' });
  }

  if (password.length < 3) {
    return res.status(400).json({ error: 'Sifre en az 3 karakter olmali.' });
  }

  const resetItem = (state.passwordResetTokens || []).find((item) => {
    if (item.used || item.expiresAt < now()) {
      return false;
    }
    if (token) {
      return item.token === token;
    }
    const user = getUser(item.username);
    return item.username === username
      && normalizeEmail(user?.email) === email
      && item.codeHash === resetCodeHash(code);
  });
  if (!resetItem || resetItem.expiresAt < now()) {
    return res.status(400).json({ error: 'Sifirlama baglantisi/kodu gecersiz veya suresi dolmus.' });
  }

  const user = getUser(resetItem.username);
  if (!user) {
    return res.status(400).json({ error: 'Kullanici bulunamadi.' });
  }

  user.password = password;
  resetItem.used = true;
  state.passwordResetTokens = (state.passwordResetTokens || [])
    .filter((item) => !item.used && item.expiresAt > now());
  saveState();
  res.json({ success: true });
});

app.post('/api/login', (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password;
  const user = getUser(username);

  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  if (user.banned) {
    return res.status(403).json({ error: 'This user is banned.' });
  }

  if (!state.presence[username]) {
    state.presence[username] = {
      status: 'online',
      currentServerId: state.servers[0]?.id || null,
      currentChannelId: state.servers[0]?.categories[0]?.channels[0]?.id || null,
      voiceChannelId: null
    };
  }

  state.presence[username].status = 'online';
  saveState();
  broadcastState();
  res.json({ success: true });
});

app.post('/api/server', (req, res) => {
  const { name, creator } = req.body;
  if (!name || !creator) {
    return res.status(400).json({ error: 'Name and creator required.' });
  }

  if (!getUser(creator)) {
    return res.status(400).json({ error: 'Creator not found.' });
  }

  const serverItem = {
    id: uid('srv'),
    name: name.trim(),
    creator,
    members: [{ username: creator, role: 'admin' }],
    categories: [
      {
        id: uid('cat'),
        name: 'Genel',
        channels: [
          { id: uid('chn'), name: 'general', kind: 'text', allowedRoles: ['admin', 'mod', 'member'] },
          { id: uid('chn'), name: 'voice-room', kind: 'voice', allowedRoles: ['admin', 'mod', 'member'] }
        ]
      }
    ],
    reports: [],
    polls: [],
    pinnedMessageIds: [],
    moderationLogs: [],
    inviteCode: inviteCode()
  };

  state.servers.push(serverItem);
  const generalChannel = serverItem.categories[0].channels[0];
  state.messages[generalChannel.id] = [
    { id: uid('msg'), user: 'system', text: `${creator} sunucuyu olusturdu.`, time: now() }
  ];
  state.voicePresence[serverItem.categories[0].channels[1].id] = [];
  state.presence[creator] = state.presence[creator] || {};
  state.presence[creator].currentServerId = serverItem.id;
  state.presence[creator].currentChannelId = generalChannel.id;
  saveState();
  broadcastServer(serverItem.id);
  res.json({ server: serializeServer(serverItem, creator) });
});

app.post('/api/server/invite', (req, res) => {
  const { serverId, actor, regenerate } = req.body;
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  const actorMember = getServerMember(serverItem, actor);
  if (!actorMember || !['admin', 'mod'].includes(actorMember.role)) {
    return res.status(403).json({ error: 'Davet kodunu sadece admin/mod gorebilir.' });
  }

  if (!serverItem.inviteCode || regenerate) {
    serverItem.inviteCode = inviteCode();
    saveState();
    broadcastServer(serverId);
  }

  res.json({ inviteCode: serverItem.inviteCode });
});

app.post('/api/server/join', (req, res) => {
  const { username, inviteCode: submittedCode } = req.body;
  const user = getUser(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const normalizedCode = submittedCode?.trim().toUpperCase();
  const serverItem = state.servers.find((item) => item.inviteCode === normalizedCode);
  if (!serverItem) {
    return res.status(404).json({ error: 'Gecersiz davet kodu.' });
  }

  if (!getServerMember(serverItem, username)) {
    serverItem.members.push({ username, role: 'member' });
  }

  state.presence[username] = state.presence[username] || {};
  state.presence[username].currentServerId = serverItem.id;
  state.presence[username].currentChannelId = serverItem.categories?.[0]?.channels?.[0]?.id || null;
  saveState();
  broadcastServer(serverItem.id);
  res.json({ server: serializeServer(serverItem, username) });
});

app.post('/api/server/delete', (req, res) => {
  const { serverId, actor } = req.body;
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  if (serverItem.creator !== actor) {
    return res.status(403).json({ error: 'Bu sunucuyu sadece kuran kisi silebilir.' });
  }

  const channelIds = serverItem.categories.flatMap((category) => category.channels.map((channel) => channel.id));
  state.servers = state.servers.filter((item) => item.id !== serverId);
  channelIds.forEach((channelId) => {
    delete state.messages[channelId];
    delete state.voicePresence[channelId];
    delete callPresence[channelId];
  });

  Object.keys(state.presence).forEach((username) => {
    const presence = state.presence[username];
    if (presence?.currentServerId === serverId) {
      presence.currentServerId = state.servers[0]?.id || null;
      presence.currentChannelId = state.servers[0]?.categories?.[0]?.channels?.[0]?.id || null;
      presence.voiceChannelId = null;
    }
  });

  saveState();
  broadcastState();
  state.servers.forEach((item) => broadcastServer(item.id));
  res.json({ success: true });
});

app.post('/api/social', (req, res) => {
  const { actor, targetUser, action } = req.body;
  const actorUser = getUser(actor);
  const target = getUser(targetUser);

  if (!actorUser || !target) {
    return res.status(404).json({ error: 'Kullanici bulunamadi.' });
  }

  if (actor === targetUser) {
    return res.status(400).json({ error: 'Kendine bu islemi uygulayamazsin.' });
  }

  actorUser.friends = Array.isArray(actorUser.friends) ? actorUser.friends : [];
  actorUser.blocked = Array.isArray(actorUser.blocked) ? actorUser.blocked : [];
  target.friends = Array.isArray(target.friends) ? target.friends : [];
  target.blocked = Array.isArray(target.blocked) ? target.blocked : [];

  actorUser.incomingRequests = Array.isArray(actorUser.incomingRequests) ? actorUser.incomingRequests : [];
  actorUser.outgoingRequests = Array.isArray(actorUser.outgoingRequests) ? actorUser.outgoingRequests : [];
  target.incomingRequests = Array.isArray(target.incomingRequests) ? target.incomingRequests : [];
  target.outgoingRequests = Array.isArray(target.outgoingRequests) ? target.outgoingRequests : [];

  if (action === 'send-request') {
    if (areUsersBlocked(actor, targetUser)) {
      return res.status(400).json({ error: 'Engelli kullanicilara istek gonderilemez.' });
    }
    if (actorUser.friends.includes(targetUser)) {
      return res.status(400).json({ error: 'Bu kullanici zaten arkadas listende.' });
    }
    if (actorUser.outgoingRequests.includes(targetUser)) {
      return res.status(400).json({ error: 'Bu kullaniciya zaten istek gonderildi.' });
    }
    if (actorUser.incomingRequests.includes(targetUser)) {
      return res.status(400).json({ error: 'Bu kullanicidan gelen bir istek var. Kabul edebilirsin.' });
    }
    actorUser.outgoingRequests = [...new Set([...actorUser.outgoingRequests, targetUser])];
    target.incomingRequests = [...new Set([...target.incomingRequests, actor])];
  } else if (action === 'cancel-request') {
    actorUser.outgoingRequests = actorUser.outgoingRequests.filter((username) => username !== targetUser);
    target.incomingRequests = target.incomingRequests.filter((username) => username !== actor);
  } else if (action === 'accept-request') {
    if (!actorUser.incomingRequests.includes(targetUser)) {
      return res.status(400).json({ error: 'Bekleyen istek bulunamadi.' });
    }
    actorUser.incomingRequests = actorUser.incomingRequests.filter((username) => username !== targetUser);
    target.outgoingRequests = target.outgoingRequests.filter((username) => username !== actor);
    actorUser.friends = [...new Set([...actorUser.friends, targetUser])];
    target.friends = [...new Set([...target.friends, actor])];
  } else if (action === 'reject-request') {
    actorUser.incomingRequests = actorUser.incomingRequests.filter((username) => username !== targetUser);
    target.outgoingRequests = target.outgoingRequests.filter((username) => username !== actor);
  } else if (action === 'remove-friend') {
    actorUser.friends = actorUser.friends.filter((username) => username !== targetUser);
    target.friends = target.friends.filter((username) => username !== actor);
  } else if (action === 'block') {
    actorUser.blocked = [...new Set([...actorUser.blocked, targetUser])];
    actorUser.friends = actorUser.friends.filter((username) => username !== targetUser);
    target.friends = target.friends.filter((username) => username !== actor);
    actorUser.incomingRequests = actorUser.incomingRequests.filter((username) => username !== targetUser);
    actorUser.outgoingRequests = actorUser.outgoingRequests.filter((username) => username !== targetUser);
    target.incomingRequests = target.incomingRequests.filter((username) => username !== actor);
    target.outgoingRequests = target.outgoingRequests.filter((username) => username !== actor);
  } else if (action === 'unblock') {
    actorUser.blocked = actorUser.blocked.filter((username) => username !== targetUser);
  } else {
    return res.status(400).json({ error: 'Gecersiz sosyal islem.' });
  }

  saveState();
  broadcastState();
  res.json({ social: buildSocialState(actor) });
});

app.post('/api/channel', (req, res) => {
  const { serverId, categoryId, name, kind, allowedRoles, actor } = req.body;
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  const member = getServerMember(serverItem, actor);
  if (!member || !['admin', 'mod'].includes(member.role)) {
    return res.status(403).json({ error: 'Yetki yok.' });
  }

  const category = serverItem.categories.find((item) => item.id === categoryId);
  if (!category) {
    return res.status(404).json({ error: 'Category not found.' });
  }

  const channel = {
    id: uid('chn'),
    name: name.trim(),
    kind: kind === 'voice' ? 'voice' : 'text',
    allowedRoles: Array.isArray(allowedRoles) && allowedRoles.length ? allowedRoles : ['admin', 'mod', 'member']
  };

  category.channels.push(channel);
  if (channel.kind === 'voice') {
    state.voicePresence[channel.id] = [];
  } else {
    state.messages[channel.id] = [];
  }
  saveState();
  broadcastServer(serverId);
  res.json({ channel });
});

app.post('/api/category', (req, res) => {
  const { serverId, name, actor } = req.body;
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  const member = getServerMember(serverItem, actor);
  if (!member || !['admin', 'mod'].includes(member.role)) {
    return res.status(403).json({ error: 'Yetki yok.' });
  }

  const categoryName = name?.trim();
  if (!categoryName) {
    return res.status(400).json({ error: 'Category name required.' });
  }

  const category = {
    id: uid('cat'),
    name: categoryName,
    channels: []
  };

  serverItem.categories.push(category);
  saveState();
  broadcastServer(serverId);
  res.json({ category });
});

app.post('/api/role', (req, res) => {
  const { serverId, targetUser, role, actor } = req.body;
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  const actorMember = getServerMember(serverItem, actor);
  if (!actorMember || actorMember.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can change roles.' });
  }

  const targetMember = getServerMember(serverItem, targetUser);
  if (!targetMember) {
    return res.status(404).json({ error: 'Target user not found.' });
  }

  if (!['admin', 'mod', 'member'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role.' });
  }

  const adminCount = serverItem.members.filter((member) => member.role === 'admin').length;
  if (targetMember.role === 'admin' && role !== 'admin' && adminCount <= 1) {
    return res.status(400).json({ error: 'Sunucuda en az bir admin kalmali.' });
  }

  targetMember.role = role;
  saveState();
  broadcastServer(serverId);
  res.json({ success: true });
});

app.post('/api/moderation', (req, res) => {
  const { action, actor, targetUser, serverId, reason } = req.body;
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  const actorMember = getServerMember(serverItem, actor);
  if (!actorMember || !['admin', 'mod'].includes(actorMember.role)) {
    return res.status(403).json({ error: 'Yetki yok.' });
  }

  const target = getUser(targetUser);
  if (!target) {
    return res.status(404).json({ error: 'Target not found.' });
  }

  if (action === 'ban') {
    target.banned = true;
  } else if (action === 'mute') {
    target.mutedUntil = now() + 10 * 60 * 1000;
  } else if (action === 'unmute') {
    target.mutedUntil = null;
  } else {
    return res.status(400).json({ error: 'Invalid action.' });
  }

  const reportLine = `${actor} ${targetUser} kullanicisi icin ${action} islemi yapti. Sebep: ${reason || 'Belirtilmedi'}`;
  appendModerationLog(serverItem, {
    actor,
    targetUser,
    action,
    reason: reason || 'Belirtilmedi'
  });
  const modOnlyChannel = serverItem.categories.flatMap((category) => category.channels).find((channel) => channel.name === 'mod-only');
  if (modOnlyChannel) {
    postSystemMessage(modOnlyChannel.id, reportLine);
  }
  saveState();
  broadcastState();
  broadcastServer(serverId);
  res.json({ success: true });
});

app.post('/api/report', (req, res) => {
  const { serverId, reporter, targetUser, channelId, reason } = req.body;
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return res.status(404).json({ error: 'Server not found.' });
  }

  serverItem.reports.unshift({
    id: uid('rpt'),
    reporter,
    targetUser,
    channelId,
    reason,
    status: 'open',
    time: now()
  });
  appendModerationLog(serverItem, {
    actor: reporter,
    targetUser,
    action: 'report',
    reason: reason || 'Belirtilmedi'
  });
  saveState();
  broadcastServer(serverId);
  res.json({ success: true });
});

app.post('/api/presence', (req, res) => {
  const { username, status } = req.body;
  if (!state.presence[username]) {
    return res.status(404).json({ error: 'User not found.' });
  }

  state.presence[username].status = status || 'online';
  saveState();
  broadcastState();
  res.json({ success: true });
});

app.post('/api/avatar', (req, res) => {
  const { username, avatar } = req.body;
  const user = getUser(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (avatar && (typeof avatar !== 'string' || !avatar.startsWith('data:image/'))) {
    return res.status(400).json({ error: 'Invalid avatar format.' });
  }

  user.avatar = avatar || null;
  saveState();
  broadcastState();
  state.servers.forEach((serverItem) => broadcastServer(serverItem.id));
  res.json({ success: true, avatar: user.avatar || null });
});

const wsClients = new Map();

function getWsByUsername(username) {
  for (const [client, info] of wsClients.entries()) {
    if (info?.username === username && client.readyState === WebSocket.OPEN) {
      return client;
    }
  }
  return null;
}

function removeUserFromCalls(username) {
  const removedChannelIds = [];
  Object.keys(callPresence).forEach((channelId) => {
    const hadUser = (callPresence[channelId] || []).includes(username);
    callPresence[channelId] = (callPresence[channelId] || []).filter((item) => item !== username);
    if (hadUser) {
      removedChannelIds.push(channelId);
    }
    if (!callPresence[channelId].length) {
      delete callPresence[channelId];
    }
  });
  return removedChannelIds;
}

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();

  for (const networkName of Object.keys(interfaces)) {
    for (const network of interfaces[networkName] || []) {
      if (network.family === 'IPv4' && !network.internal) {
        return network.address;
      }
    }
  }

  return null;
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    if (data.type === 'identify') {
      wsClients.set(ws, { username: data.username, currentCallChannelId: null });
      onlineUsers.add(data.username);
      if (cleanupOfflineVoicePresence()) {
        saveState();
      }
      broadcastState();
      return;
    }

    if (data.type === 'switchChannel') {
      const serverItem = getServer(data.serverId);
      if (!serverItem || !canAccessChannel(serverItem, data.username, data.channelId)) {
        return;
      }

      state.presence[data.username] = state.presence[data.username] || {};
      state.presence[data.username].currentServerId = data.serverId;
      state.presence[data.username].currentChannelId = data.channelId;
      saveState();
      sendChannelMessages(ws, data.channelId);
      broadcastState();
      return;
    }

    if (data.type === 'openDm') {
      if (!getUser(data.username) || !getUser(data.peerUsername)) {
        return;
      }
      if (markDmSeen(data.username, data.peerUsername)) {
        saveState();
      }
      sendDmMessages(ws, data.username, data.peerUsername);
      const peerWs = getWsByUsername(data.peerUsername);
      if (peerWs) {
        sendDmMessages(peerWs, data.peerUsername, data.username);
      }
      return;
    }

    if (data.type === 'typing') {
      if (data.scope === 'dm') {
        const scopeKey = `dm:${getDmKey(data.username, data.peerUsername)}`;
        setTyping(scopeKey, data.username, Boolean(data.isTyping));
        broadcast('typingState', {
          scope: 'dm',
          scopeKey,
          users: typingState[scopeKey] || []
        });
        return;
      }

      if (data.scope === 'channel') {
        const scopeKey = `channel:${data.channelId}`;
        setTyping(scopeKey, data.username, Boolean(data.isTyping));
        broadcast('typingState', {
          scope: 'channel',
          scopeKey,
          users: typingState[scopeKey] || []
        });
      }
      return;
    }

    if (data.type === 'joinVoice') {
      const serverItem = getServer(data.serverId);
      if (!serverItem || !canAccessChannel(serverItem, data.username, data.channelId)) {
        return;
      }

      removeUserFromVoice(data.username);
      state.voicePresence[data.channelId] = state.voicePresence[data.channelId] || [];
      if (!state.voicePresence[data.channelId].includes(data.username)) {
        state.voicePresence[data.channelId].push(data.username);
      }

      state.presence[data.username] = state.presence[data.username] || {};
      state.presence[data.username].voiceChannelId = data.channelId;
      saveState();
      broadcastServer(data.serverId);
      broadcastState();
      return;
    }

    if (data.type === 'leaveVoice') {
      removeUserFromVoice(data.username);
      const info = wsClients.get(ws) || { username: data.username };
      const removedCallChannelIds = removeUserFromCalls(data.username);
      if (removedCallChannelIds.length) {
        info.currentCallChannelId = null;
        wsClients.set(ws, info);
        removedCallChannelIds.forEach((channelId) => {
          broadcast('callLeft', {
            username: data.username,
            channelId
          });
        });
      }
      saveState();
      if (data.serverId) {
        broadcastServer(data.serverId);
      }
      broadcastState();
      return;
    }

    if (data.type === 'joinCall') {
      const serverItem = getServer(data.serverId);
      if (!serverItem || !canAccessChannel(serverItem, data.username, data.channelId)) {
        return;
      }

      const wasAlreadyInCall = (callPresence[data.channelId] || []).includes(data.username);
      const startedAt = now();
      removeUserFromCalls(data.username);
      callPresence[data.channelId] = callPresence[data.channelId] || [];
      if (!callPresence[data.channelId].includes(data.username)) {
        callPresence[data.channelId].push(data.username);
      }

      const info = wsClients.get(ws) || { username: data.username };
      info.currentCallChannelId = data.channelId;
      wsClients.set(ws, info);

      broadcast('callState', {
        serverId: data.serverId,
        channelId: data.channelId,
        participants: callPresence[data.channelId],
        startedBy: data.username,
        startedAt,
        isNewJoin: !wasAlreadyInCall
      });
      return;
    }

    if (data.type === 'leaveCall') {
      removeUserFromCalls(data.username);
      const info = wsClients.get(ws) || { username: data.username };
      info.currentCallChannelId = null;
      wsClients.set(ws, info);
      broadcast('callLeft', {
        username: data.username,
        channelId: data.channelId
      });
      broadcastState();
      return;
    }

    if (data.type === 'webrtcSignal') {
      const targetClient = getWsByUsername(data.target);
      if (!targetClient) {
        return;
      }
      const sourceInfo = wsClients.get(ws);
      const targetInfo = wsClients.get(targetClient);
      if (
        data.channelId &&
        sourceInfo?.currentCallChannelId &&
        targetInfo?.currentCallChannelId &&
        (sourceInfo.currentCallChannelId !== data.channelId || targetInfo.currentCallChannelId !== data.channelId)
      ) {
        return;
      }

      targetClient.send(JSON.stringify({
        type: 'webrtcSignal',
        from: data.username,
        signal: data.signal,
        channelId: data.channelId
      }));
      return;
    }

    if (data.type === 'message') {
      const serverItem = getServer(data.serverId);
      const user = getUser(data.username);
      if (!serverItem || !user || !canAccessChannel(serverItem, data.username, data.channelId)) {
        return;
      }

      if (user.banned) {
        ws.send(JSON.stringify({ type: 'error', message: 'Banned user cannot send messages.', clientId: data.clientId }));
        return;
      }

      if (user.mutedUntil && user.mutedUntil > now()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Bu kullanici su anda mute durumunda.', clientId: data.clientId }));
        return;
      }

      if (typeof data.text === 'string' && data.text.startsWith('/')) {
        const result = handleCommand({
          serverId: data.serverId,
          channelId: data.channelId,
          username: data.username,
          commandText: data.text.trim()
        });

        if (result.error) {
          ws.send(JSON.stringify({ type: 'error', message: result.error }));
        } else if (result.systemText) {
          ws.send(JSON.stringify({ type: 'system', text: result.systemText }));
        }
        return;
      }

      const message = {
        id: uid('msg'),
        user: data.username,
        text: data.text,
        time: now(),
        reactions: {},
        attachment: data.attachment || null,
        clientId: data.clientId || null
      };

      if (!state.messages[data.channelId]) {
        state.messages[data.channelId] = [];
      }

      state.messages[data.channelId].push(message);
      saveState();
      broadcast('message', {
        serverId: data.serverId,
        channelId: data.channelId,
        message
      });
      return;
    }

    if (data.type === 'dmMessage') {
      if (!getUser(data.username) || !getUser(data.peerUsername) || !data.text?.trim()) {
        return;
      }

      if (areUsersBlocked(data.username, data.peerUsername)) {
        ws.send(JSON.stringify({ type: 'error', message: 'Bu kullanici ile direkt mesajlasma engellendi.', clientId: data.clientId }));
        return;
      }

      const dmKey = getDmKey(data.username, data.peerUsername);
      const message = {
        id: uid('dm'),
        user: data.username,
        text: data.text.trim(),
        time: now(),
        reactions: {},
        seenBy: [data.username],
        attachment: data.attachment || null,
        clientId: data.clientId || null
      };

      state.directMessages[dmKey] = state.directMessages[dmKey] || [];
      state.directMessages[dmKey].push(message);
      setTyping(`dm:${dmKey}`, data.username, false);
      saveState();

      const senderWs = getWsByUsername(data.username);
      const targetWs = getWsByUsername(data.peerUsername);
      if (senderWs) {
        sendDmMessages(senderWs, data.username, data.peerUsername);
      }
      if (targetWs) {
        sendDmMessages(targetWs, data.peerUsername, data.username);
      }
      return;
    }

    if (data.type === 'react') {
      const serverItem = getServer(data.serverId);
      if (!serverItem || !canAccessChannel(serverItem, data.username, data.channelId)) {
        return;
      }

      const message = getMessage(data.channelId, data.messageId);
      if (!message) {
        return;
      }

      ensureMessageShape(message);
      const emoji = data.emoji;
      if (!emoji) {
        return;
      }

      const currentUsers = Array.isArray(message.reactions[emoji]) ? message.reactions[emoji] : [];
      if (currentUsers.includes(data.username)) {
        message.reactions[emoji] = currentUsers.filter((user) => user !== data.username);
        if (!message.reactions[emoji].length) {
          delete message.reactions[emoji];
        }
      } else {
        message.reactions[emoji] = [...currentUsers, data.username];
      }

      saveState();
      broadcast('messageUpdated', {
        serverId: data.serverId,
        channelId: data.channelId,
        message
      });
      return;
    }

    if (data.type === 'pinMessage') {
      const serverItem = getServer(data.serverId);
      if (!serverItem || !canModerateMessage(data.serverId, data.username)) {
        return;
      }

      const message = getMessage(data.channelId, data.messageId);
      if (!message) {
        return;
      }

      serverItem.pinnedMessageIds = Array.isArray(serverItem.pinnedMessageIds) ? serverItem.pinnedMessageIds : [];
      if (serverItem.pinnedMessageIds.includes(data.messageId)) {
        serverItem.pinnedMessageIds = serverItem.pinnedMessageIds.filter((id) => id !== data.messageId);
        appendModerationLog(serverItem, {
          actor: data.username,
          targetUser: message.user,
          action: 'unpin',
          reason: `Mesaj sabitlemesi kaldirildi: ${message.text.slice(0, 60)}`
        });
      } else {
        serverItem.pinnedMessageIds.unshift(data.messageId);
        serverItem.pinnedMessageIds = [...new Set(serverItem.pinnedMessageIds)].slice(0, 10);
        appendModerationLog(serverItem, {
          actor: data.username,
          targetUser: message.user,
          action: 'pin',
          reason: `Mesaj sabitlendi: ${message.text.slice(0, 60)}`
        });
      }

      saveState();
      broadcastServer(data.serverId);
      return;
    }

    if (data.type === 'editMessage') {
      const serverItem = getServer(data.serverId);
      if (!serverItem || !canAccessChannel(serverItem, data.username, data.channelId)) {
        return;
      }

      const message = getMessage(data.channelId, data.messageId);
      if (!message) {
        return;
      }

      const canEdit = message.user === data.username || canModerateMessage(data.serverId, data.username);
      if (!canEdit || !data.text?.trim()) {
        return;
      }

      message.text = data.text.trim();
      message.editedAt = now();
      ensureMessageShape(message);
      saveState();
      broadcast('messageUpdated', {
        serverId: data.serverId,
        channelId: data.channelId,
        message
      });
      return;
    }

    if (data.type === 'deleteMessage') {
      const serverItem = getServer(data.serverId);
      if (!serverItem || !canAccessChannel(serverItem, data.username, data.channelId)) {
        return;
      }

      const messages = state.messages[data.channelId] || [];
      const index = messages.findIndex((message) => message.id === data.messageId);
      if (index < 0) {
        return;
      }

      const message = messages[index];
      const canDelete = message.user === data.username || canModerateMessage(data.serverId, data.username);
      if (!canDelete) {
        return;
      }

      messages.splice(index, 1);
      saveState();
      broadcast('messageDeleted', {
        serverId: data.serverId,
        channelId: data.channelId,
        messageId: data.messageId
      });
      return;
    }
  });

  ws.on('close', () => {
    const info = wsClients.get(ws);
    if (info?.username) {
      onlineUsers.delete(info.username);
      removeUserFromCalls(info.username);
      const voiceChanged = removeUserFromVoice(info.username);
      Object.keys(typingState).forEach((scopeKey) => {
        setTyping(scopeKey, info.username, false);
      });
      broadcast('callLeft', {
        username: info.username,
        channelId: info.currentCallChannelId
      });
      if (voiceChanged) {
        saveState();
      }
      broadcastState();
      state.servers.forEach((serverItem) => broadcastServer(serverItem.id));
    }
    wsClients.delete(ws);
  });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    next();
    return;
  }

  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

initializePersistence()
  .then(() => {
    server.listen(PORT, HOST, () => {
      const localIp = getLocalIpAddress();
      console.log(`Server running at http://localhost:${PORT}`);
      console.log(`Persistence mode: ${persistenceMode}`);
      if (localIp) {
        console.log(`LAN access: http://${localIp}:${PORT}`);
      }
    });
  })
  .catch((error) => {
    console.error('Server startup failed:', error);
    process.exit(1);
  });
