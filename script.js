const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';
let currentUser = JSON.parse(localStorage.getItem('scene_user'));
let currentServerId = null;
let currentChannelId = null;
let messageInterval = null;

// Initialization
if (currentUser) showApp();

// --- AUTHENTICATION ---
async function register() {
    const user = document.getElementById('auth-username').value;
    const pass = document.getElementById('auth-password').value;
    const res = await fetch(`${API_URL}/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (data.error) return document.getElementById('auth-error').innerText = data.error;
    loginSuccess(data);
}

async function login() {
    const user = document.getElementById('auth-username').value;
    const pass = document.getElementById('auth-password').value;
    const res = await fetch(`${API_URL}/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
    });
    const data = await res.json();
    if (data.error) return document.getElementById('auth-error').innerText = data.error;
    loginSuccess(data);
}

function loginSuccess(user) {
    currentUser = user;
    localStorage.setItem('scene_user', JSON.stringify(user));
    showApp();
}

function logout() {
    localStorage.removeItem('scene_user');
    currentUser = null;
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-screen').classList.add('hidden');
    clearInterval(messageInterval);
}

function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('my-username').innerText = currentUser.username;
    document.getElementById('my-discriminator').innerText = `#${currentUser.discriminator}`;
    loadServers();
}

// --- SERVERS ---
async function loadServers() {
    const res = await fetch(`${API_URL}/servers`);
    const servers = await res.json();
    const container = document.getElementById('servers-container');
    container.innerHTML = '';
    servers.forEach(server => {
        const div = document.createElement('div');
        div.className = 'server-icon';
        div.innerText = server.name.charAt(0).toUpperCase();
        div.onclick = () => selectServer(server);
        container.appendChild(div);
    });
}

async function createServer() {
    const name = document.getElementById('new-server-name').value;
    await fetch(`${API_URL}/servers`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, userId: currentUser._id })
    });
    hideModal('server-modal');
    loadServers();
}

function selectServer(server) {
    currentServerId = server._id;
    document.getElementById('current-server-name').innerText = server.name;
    
    // Permission check: Only show Add Channel if owner
    const addBtn = document.getElementById('add-channel-btn');
    if (server.ownerId === currentUser._id) {
        addBtn.classList.remove('hidden');
    } else {
        addBtn.classList.add('hidden');
    }

    loadChannels();
}

// --- CHANNELS ---
async function loadChannels() {
    if (!currentServerId) return;
    const res = await fetch(`${API_URL}/servers/${currentServerId}/channels`);
    const channels = await res.json();
    const container = document.getElementById('channels-container');
    container.innerHTML = '';
    channels.forEach(channel => {
        const div = document.createElement('div');
        div.className = 'channel';
        div.innerText = `# ${channel.name}`;
        div.onclick = () => selectChannel(channel);
        container.appendChild(div);
    });
}

async function createChannel() {
    const name = document.getElementById('new-channel-name').value;
    const res = await fetch(`${API_URL}/servers/${currentServerId}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, userId: currentUser._id })
    });
    const data = await res.json();
    if(data.error) alert(data.error);
    hideModal('channel-modal');
    loadChannels();
}

function selectChannel(channel) {
    currentChannelId = channel._id;
    document.getElementById('current-channel-name').innerText = `# ${channel.name}`;
    document.getElementById('message-input').disabled = false;
    
    if (messageInterval) clearInterval(messageInterval);
    loadMessages();
    messageInterval = setInterval(loadMessages, 3000);
}

// --- MESSAGES ---
async function loadMessages() {
    if (!currentChannelId) return;
    const res = await fetch(`${API_URL}/channels/${currentChannelId}/messages`);
    const messages = await res.json();
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'message';
        div.innerHTML = `
            <div class="avatar">${msg.authorId.username.charAt(0)}</div>
            <div>
                <div class="message-header">
                    <span class="username">${msg.authorId.username}</span>
                    <span class="disc">#${msg.authorId.discriminator}</span>
                </div>
                <div class="text">${msg.content}</div>
            </div>
        `;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

document.getElementById('message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    if (!input.value.trim() || !currentChannelId) return;
    
    await fetch(`${API_URL}/channels/${currentChannelId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input.value, userId: currentUser._id })
    });
    
    input.value = '';
    loadMessages();
});

// Utilities
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
