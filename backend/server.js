const express = require('express');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend', 'public');

app.use(express.json({ limit: '10mb' }));

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function now() {
  return Date.now();
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
      { username: 'admin', password: '123', banned: false, mutedUntil: null, status: 'online' },
      { username: 'moderator', password: '123', banned: false, mutedUntil: null, status: 'away' },
      { username: 'student', password: '123', banned: false, mutedUntil: null, status: 'online' }
    ],
    directMessages: {},
    servers: [
      {
        id: generalServerId,
        name: 'Ostim Community',
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
        polls: []
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
    }
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

  nextState.users.forEach((user) => {
    if (!nextState.presence[user.username]) {
      nextState.presence[user.username] = {
        status: user.status || 'offline',
        currentServerId: nextState.servers[0]?.id || null,
        currentChannelId: nextState.servers[0]?.categories?.[0]?.channels?.[0]?.id || null,
        voiceChannelId: null
      };
    }
  });

  Object.keys(nextState.messages).forEach((channelId) => {
    nextState.messages[channelId] = (nextState.messages[channelId] || []).map((message) => ({
      reactions: {},
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

let state = normalizeState(loadState());
const callPresence = {};
const onlineUsers = new Set();
const typingState = {};

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function sanitizeUser(user) {
  return {
    username: user.username,
    banned: Boolean(user.banned),
    mutedUntil: user.mutedUntil,
    avatar: user.avatar || null,
    status: onlineUsers.has(user.username)
      ? (state.presence[user.username]?.status || user.status || 'online')
      : 'offline'
  };
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
    myRole: member?.role || null,
    members: server.members.map((serverMember) => ({
      username: serverMember.username,
      role: serverMember.role,
      status: state.presence[serverMember.username]?.status || 'offline'
    })),
    categories: visibleCategories,
    reports: server.reports,
    polls: server.polls
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
  return {
    currentUser: sanitizeUser(getUser(username)),
    users: state.users.map(sanitizeUser),
    servers: state.servers
      .filter((serverItem) => getServerMember(serverItem, username))
      .map((serverItem) => serializeServer(serverItem, username)),
    messages: buildVisibleMessagesForUser(username),
    directMessages: buildVisibleDms(username),
    voicePresence: state.voicePresence,
    presence: state.presence,
    callPresence,
    typingState
  };
}

function ensureMemberships(username) {
  state.servers.forEach((serverItem) => {
    const alreadyMember = getServerMember(serverItem, username);
    if (!alreadyMember) {
      serverItem.members.push({ username, role: 'member' });
    }
  });
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

function broadcast(type, payload) {
  const message = JSON.stringify({ type, ...payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastState() {
  broadcast('stateUpdated', {
    users: state.users.map(sanitizeUser),
    presence: state.presence,
    voicePresence: state.voicePresence,
    callPresence,
    typingState
  });
}

function broadcastServer(serverId) {
  const serverItem = getServer(serverId);
  if (!serverItem) {
    return;
  }

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
      presence: state.presence,
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

  const message = { id: uid('msg'), user: 'system', text, time: now(), reactions: {} };
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
    servers: state.servers.length
  });
});

app.post('/api/register', (req, res) => {
  const username = req.body.username?.trim();
  const password = req.body.password;
  const avatar = req.body.avatar;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  if (avatar && (typeof avatar !== 'string' || !avatar.startsWith('data:image/'))) {
    return res.status(400).json({ error: 'Invalid avatar format.' });
  }

  if (getUser(username)) {
    return res.status(400).json({ error: 'Username already exists.' });
  }

  const user = {
    username,
    password,
    banned: false,
    mutedUntil: null,
    status: 'online',
    avatar: avatar || null
  };

  state.users.push(user);
  state.presence[username] = {
    status: 'online',
    currentServerId: state.servers[0]?.id || null,
    currentChannelId: state.servers[0]?.categories[0]?.channels[0]?.id || null,
    voiceChannelId: null
  };
  ensureMemberships(username);
  saveState();
  broadcastState();
  state.servers.forEach((serverItem) => broadcastServer(serverItem.id));
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
    polls: []
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
  Object.keys(callPresence).forEach((channelId) => {
    callPresence[channelId] = (callPresence[channelId] || []).filter((item) => item !== username);
    if (!callPresence[channelId].length) {
      delete callPresence[channelId];
    }
  });
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

      Object.keys(state.voicePresence).forEach((channelId) => {
        state.voicePresence[channelId] = (state.voicePresence[channelId] || []).filter((user) => user !== data.username);
      });
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
      Object.keys(state.voicePresence).forEach((channelId) => {
        state.voicePresence[channelId] = (state.voicePresence[channelId] || []).filter((user) => user !== data.username);
      });

      state.presence[data.username] = state.presence[data.username] || {};
      state.presence[data.username].voiceChannelId = null;
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

      removeUserFromCalls(data.username);
      callPresence[data.channelId] = callPresence[data.channelId] || [];
      if (!callPresence[data.channelId].includes(data.username)) {
        callPresence[data.channelId].push(data.username);
      }

      const info = wsClients.get(ws) || { username: data.username };
      info.currentCallChannelId = data.channelId;
      wsClients.set(ws, info);

      broadcast('callState', {
        channelId: data.channelId,
        participants: callPresence[data.channelId]
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
        ws.send(JSON.stringify({ type: 'error', message: 'Banned user cannot send messages.' }));
        return;
      }

      if (user.mutedUntil && user.mutedUntil > now()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Bu kullanici su anda mute durumunda.' }));
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
        reactions: {}
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

      const dmKey = getDmKey(data.username, data.peerUsername);
      const message = {
        id: uid('dm'),
        user: data.username,
        text: data.text.trim(),
        time: now(),
        reactions: {},
        seenBy: [data.username]
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
      Object.keys(typingState).forEach((scopeKey) => {
        setTyping(scopeKey, info.username, false);
      });
      broadcast('callLeft', {
        username: info.username,
        channelId: info.currentCallChannelId
      });
      broadcastState();
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

server.listen(PORT, HOST, () => {
  const localIp = getLocalIpAddress();
  console.log(`Server running at http://localhost:${PORT}`);
  if (localIp) {
    console.log(`LAN access: http://${localIp}:${PORT}`);
  }
});
