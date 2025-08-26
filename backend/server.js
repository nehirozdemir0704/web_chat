// server.js - Discord-like chat backend (serves static frontend too)
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CHANNELS_FILE = path.join(DATA_DIR, 'channels.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'chatuser',
  password: process.env.DB_PASSWORD || 'chatpass',
  database: process.env.DB_NAME || 'chatdb',
  port: 5432,
});

// Robust migration with retry logic
async function robustMigrate(retries = 20, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL,
        members TEXT[]
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        channel VARCHAR(100) NOT NULL,
        username VARCHAR(50) NOT NULL,
        text TEXT NOT NULL,
        time BIGINT NOT NULL
      )`);
      console.log('DB migrated');
      return;
    } catch (err) {
      console.log(`Migration attempt ${i + 1} failed: ${err.message}`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  console.error('Migration failed after multiple attempts. Exiting.');
  process.exit(1);
}

robustMigrate();

// --- Serve static frontend ---
app.use('/', express.static(path.join(__dirname, 'frontend/public')));

// Fallback: serve index.html for all non-API routes
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'frontend/public', 'index.html'));
  } else {
    next();
  }
});

// --- REST API ---
app.get('/api/channels', async (req, res) => {
  const { rows } = await pool.query('SELECT name, type, members FROM channels');
  res.json(rows);
});
app.get('/api/users', async (req, res) => {
  const { rows } = await pool.query('SELECT username FROM users');
  res.json(rows.map(u => u.username));
});
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  try {
    await pool.query('INSERT INTO users (username, password) VALUES ($1, $2)', [username, password]);
    res.json({ success: true });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Username already exists.' });
    res.status(500).json({ error: 'DB error' });
  }
});
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE username=$1 AND password=$2', [username, password]);
  if (!rows.length) return res.status(401).json({ error: 'Invalid credentials.' });
  res.json({ success: true });
});
app.post('/api/channel', async (req, res) => {
  const { name, type, creator } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type required.' });
  try {
    let members = type === 'private' ? [creator] : [];
    await pool.query('INSERT INTO channels (name, type, members) VALUES ($1, $2, $3)', [name, type, members]);
    res.json({ name, type, members });
    broadcastChannelsUpdated();
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error: 'Channel already exists.' });
    res.status(500).json({ error: 'DB error' });
  }
});

// --- WebSocket ---
const wsClients = new Map(); // ws -> { username, joinedChannels: Set }

wss.on('connection', (ws) => {
  ws.on('message', async (msg) => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }
    // Handle join
    if (data.type === 'join') {
      let info = wsClients.get(ws);
      if (!info) {
        info = { username: data.user, joinedChannels: new Set() };
        wsClients.set(ws, info);
      }
      info.joinedChannels.add(data.channel);
      ws.send(JSON.stringify({ type: 'system', text: `Joined #${data.channel}` }));
      return;
    }
    // Handle leave
    if (data.type === 'leave') {
      let info = wsClients.get(ws);
      if (info) info.joinedChannels.delete(data.channel);
      ws.send(JSON.stringify({ type: 'system', text: `Left #${data.channel}` }));
      return;
    }
    // Handle invite (private)
    if (data.type === 'invite') {
      const { channel, invitee } = data;
      const { rows } = await pool.query('SELECT * FROM channels WHERE name=$1 AND type=$2', [channel, 'private']);
      if (rows.length && !rows[0].members.includes(invitee)) {
        let members = [...rows[0].members, invitee];
        await pool.query('UPDATE channels SET members=$1 WHERE name=$2', [members, channel]);
        ws.send(JSON.stringify({ type: 'system', text: `Invited ${invitee} to #${channel}` }));
        broadcastChannelsUpdated();
      }
      return;
    }
    // Handle message
    if (data.type === 'message') {
      await pool.query('INSERT INTO messages (channel, username, text, time) VALUES ($1, $2, $3, $4)', [data.channel, data.user, data.msg, Date.now()]);
      // Broadcast to all users in this channel
      wss.clients.forEach(async client => {
        const info = wsClients.get(client);
        if (info && info.joinedChannels && info.joinedChannels.has(data.channel)) {
          client.send(JSON.stringify({
            type: 'message',
            channel: data.channel,
            user: data.user,
            text: data.msg,
            time: Date.now()
          }));
        }
      });
      return;
    }
    // Handle fetch messages
    if (data.type === 'fetchMessages') {
      const { rows } = await pool.query('SELECT username as user, text, time FROM messages WHERE channel=$1 ORDER BY time ASC', [data.channel]);
      ws.send(JSON.stringify({
        type: 'messages',
        channel: data.channel,
        messages: rows
      }));
      return;
    }
  });
  ws.on('close', () => {
    wsClients.delete(ws);
  });
});

function broadcastChannelsUpdated() {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'channelsUpdated' }));
    }
  });
}

// --- Start Server ---
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
