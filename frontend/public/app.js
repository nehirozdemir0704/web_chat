// frontend/public/app.js - Discord-like SPA chat logic
const API = {
  channels: '/api/channels',
  users: '/api/users',
  register: '/api/register',
  login: '/api/login',
  createChannel: '/api/channel',
};

let ws;
let currentUser = null;
let currentChannel = 'general';
let channels = [];
let users = [];

// --- DOM Elements ---
const channelList = document.getElementById('channelList');
const chatArea = document.getElementById('chatArea');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const currentChannelSpan = document.getElementById('currentChannel');
const createChannelBtn = document.getElementById('createChannelBtn');
const inviteBtn = document.getElementById('inviteBtn');
const logoutBtn = document.getElementById('logoutBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modal = document.getElementById('modal');

// --- State ---
let joinedChannels = new Set(['general']);
let messages = { general: [] };

// --- UI Functions ---
function showModal(html) {
  modal.innerHTML = html;
  modalOverlay.classList.remove('hidden');
}
function hideModal() {
  modalOverlay.classList.add('hidden');
}
function renderChannels() {
  channelList.innerHTML = '';
  channels.forEach(ch => {
    // Private channel: only show if user is a member
    if (ch.type === 'private' && !ch.members.includes(currentUser)) return;
    const li = document.createElement('li');
    li.className = `flex items-center px-2 py-1 rounded cursor-pointer ${currentChannel === ch.name ? 'bg-gray-700' : 'hover:bg-gray-700'}`;
    li.textContent = (ch.type === 'private' ? '🔒 ' : '#') + ch.name;
    li.onclick = () => switchChannel(ch.name);
    // Leave button (except general)
    if (ch.name !== 'general' && joinedChannels.has(ch.name)) {
      const leaveBtn = document.createElement('button');
      leaveBtn.textContent = 'Leave';
      leaveBtn.className = 'ml-auto text-xs bg-red-600 px-2 py-0.5 rounded hover:bg-red-700';
      leaveBtn.onclick = (e) => { e.stopPropagation(); leaveChannel(ch.name); };
      li.appendChild(leaveBtn);
    }
    channelList.appendChild(li);
  });
}
function renderMessages() {
  chatArea.innerHTML = '';
  (messages[currentChannel] || []).forEach(msg => {
    const div = document.createElement('div');
    div.className = 'flex items-baseline space-x-2';
    div.innerHTML = `<span class="font-bold">${msg.user}</span><span class="text-gray-400 text-xs">${new Date(msg.time).toLocaleTimeString()}</span><span>${msg.text}</span>`;
    chatArea.appendChild(div);
  });
  chatArea.scrollTop = chatArea.scrollHeight;
}
function updateInviteBtn() {
  const ch = channels.find(c => c.name === currentChannel);
  inviteBtn.classList.toggle('hidden', !(ch && ch.type === 'private' && ch.members.includes(currentUser)));
}

// --- Auth ---
function showLogin() {
  showModal(`
    <h2 class="text-xl mb-4">Login</h2>
    <input id="loginUser" class="w-full mb-2 px-2 py-1 rounded bg-gray-700" placeholder="Username" />
    <input id="loginPass" type="password" class="w-full mb-4 px-2 py-1 rounded bg-gray-700" placeholder="Password" />
    <button id="loginSubmit" class="w-full bg-blue-600 py-1 rounded hover:bg-blue-700 mb-2">Login</button>
    <button id="showRegister" class="w-full text-sm text-gray-300 hover:underline">Register</button>
  `);
  document.getElementById('loginSubmit').onclick = async () => {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    if (!username || !password) return alert('Please enter username and password.');
    const res = await fetch(API.login, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (res.ok) {
      currentUser = username;
      hideModal();
      initApp();
    } else {
      alert('Login failed.');
    }
  };
  document.getElementById('showRegister').onclick = showRegister;
}
function showRegister() {
  showModal(`
    <h2 class="text-xl mb-4">Register</h2>
    <input id="regUser" class="w-full mb-2 px-2 py-1 rounded bg-gray-700" placeholder="Username" />
    <input id="regPass" type="password" class="w-full mb-4 px-2 py-1 rounded bg-gray-700" placeholder="Password" />
    <button id="registerSubmit" class="w-full bg-green-600 py-1 rounded hover:bg-green-700 mb-2">Register</button>
    <button id="showLogin" class="w-full text-sm text-gray-300 hover:underline">Back to Login</button>
  `);
  document.getElementById('registerSubmit').onclick = async () => {
    const username = document.getElementById('regUser').value.trim();
    const password = document.getElementById('regPass').value;
    if (!username || !password) return alert('Please enter username and password.');
    const res = await fetch(API.register, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (res.ok) {
      alert('Registration successful! Please login.');
      showLogin();
    } else {
      alert('Registration failed.');
    }
  };
  document.getElementById('showLogin').onclick = showLogin;
}

// --- Channel Logic ---
async function fetchChannelsAndUsers() {
  const [chRes, uRes] = await Promise.all([
    fetch(API.channels),
    fetch(API.users)
  ]);
  channels = await chRes.json();
  users = await uRes.json();
  renderChannels();
  updateInviteBtn();
}
async function createChannel() {
  showModal(`
    <h2 class="text-xl mb-4">Create Channel</h2>
    <input id="channelName" class="w-full mb-2 px-2 py-1 rounded bg-gray-700" placeholder="Channel name" />
    <select id="channelType" class="w-full mb-4 px-2 py-1 rounded bg-gray-700">
      <option value="public">Public</option>
      <option value="private">Private</option>
    </select>
    <button id="createSubmit" class="w-full bg-blue-600 py-1 rounded hover:bg-blue-700">Create</button>
  `);
  document.getElementById('createSubmit').onclick = async () => {
    const name = document.getElementById('channelName').value.trim();
    const type = document.getElementById('channelType').value;
    if (!name) return alert('Enter channel name.');
    const res = await fetch(API.createChannel, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, type, creator: currentUser }) });
    if (res.ok) {
      hideModal();
      // Channel update will be handled by WebSocket broadcast
    } else {
      alert('Channel creation failed.');
    }
  };
}
function switchChannel(name) {
  if (!joinedChannels.has(name)) joinChannel(name);
  currentChannel = name;
  currentChannelSpan.textContent = (channels.find(c => c.name === name)?.type === 'private' ? '🔒 ' : '#') + name;
  updateInviteBtn();
  fetchMessages(name);
  renderChannels();
}
function joinChannel(name) {
  ws.send(JSON.stringify({ type: 'join', user: currentUser, channel: name }));
  joinedChannels.add(name);
}
function leaveChannel(name) {
  ws.send(JSON.stringify({ type: 'leave', user: currentUser, channel: name }));
  joinedChannels.delete(name);
  if (currentChannel === name) switchChannel('general');
  renderChannels();
}
function showInvite() {
  const ch = channels.find(c => c.name === currentChannel);
  if (!ch || ch.type !== 'private') return;
  showModal(`
    <h2 class="text-xl mb-4">Invite to #${currentChannel}</h2>
    <select id="inviteUser" class="w-full mb-4 px-2 py-1 rounded bg-gray-700">
      ${users.filter(u => u !== currentUser && !ch.members.includes(u)).map(u => `<option value="${u}">${u}</option>`).join('')}
    </select>
    <button id="inviteSubmit" class="w-full bg-green-600 py-1 rounded hover:bg-green-700">Invite</button>
  `);
  document.getElementById('inviteSubmit').onclick = () => {
    const invitee = document.getElementById('inviteUser').value;
    ws.send(JSON.stringify({ type: 'invite', channel: currentChannel, invitee }));
    hideModal();
  };
}

// --- Messaging ---
function sendMessage() {
  const msg = messageInput.value.trim();
  if (!msg) return;
  ws.send(JSON.stringify({ type: 'message', channel: currentChannel, user: currentUser, msg }));
  messageInput.value = '';
}
function fetchMessages(channel) {
  ws.send(JSON.stringify({ type: 'fetchMessages', channel }));
}

// --- WebSocket ---
function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => {
    joinedChannels.forEach(ch => ws.send(JSON.stringify({ type: 'join', user: currentUser, channel: ch })));
    fetchChannelsAndUsers();
    fetchMessages(currentChannel);
  };
  ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'message') {
      if (!messages[data.channel]) messages[data.channel] = [];
      messages[data.channel].push(data);
      if (data.channel === currentChannel) renderMessages();
    }
    if (data.type === 'messages') {
      messages[data.channel] = data.messages;
      if (data.channel === currentChannel) renderMessages();
    }
    if (data.type === 'channelsUpdated') {
      fetchChannelsAndUsers();
    }
    if (data.type === 'system') {
      // Optionally show system messages
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}

// --- App Init ---
function initApp() {
  document.getElementById('app').classList.remove('hidden');
  connectWS();
  // Event listeners
  sendBtn.onclick = sendMessage;
  messageInput.onkeydown = e => { if (e.key === 'Enter') sendMessage(); };
  createChannelBtn.onclick = createChannel;
  inviteBtn.onclick = showInvite;
  logoutBtn.onclick = () => location.reload();
  modalOverlay.onclick = e => { if (e.target === modalOverlay) hideModal(); };
}

// --- Start ---
window.onload = () => {
  document.getElementById('app').classList.add('hidden');
  showLogin();
}; 