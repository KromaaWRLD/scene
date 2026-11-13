const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';
let currentUser = JSON.parse(localStorage.getItem('scene_user'));
let currentTargetId = null; // Can be a Channel ID or DM ID
let messageInterval = null;
let serverList = [];
let dmsList = [];

if (currentUser) showApp();

// --- AUTH LOGIC (Less Confusing) ---
function toggleAuth() {
    document.getElementById('login-box').classList.toggle('hidden');
    document.getElementById('register-box').classList.toggle('hidden');
}

async function login() {
    const user = document.getElementById('login-username').value;
    const pass = document.getElementById('login-password').value;
    const res = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if (data.error) return document.getElementById('login-error').innerText = data.error;
    loginSuccess(data);
}

async function register() {
    const user = document.getElementById('reg-username').value;
    const pass = document.getElementById('reg-password').value;
    const res = await fetch(`${API_URL}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) });
    const data = await res.json();
    if (data.error) return document.getElementById('reg-error').innerText = data.error;
    loginSuccess(data);
}

function loginSuccess(user) {
    currentUser = user;
    localStorage.setItem('scene_user', JSON.stringify(user));
    showApp();
}

function logout() {
    localStorage.removeItem('scene_user');
    location.reload();
}

function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    updateUserPanel();
    loadServers();
    goHome(); // Load DMs by default
}

// --- PROFILE SETTINGS ---
function updateUserPanel() {
    document.getElementById('my-username').innerText = `${currentUser.username}#${currentUser.discriminator}`;
    document.getElementById('my-status').innerText = currentUser.status || 'Online';
    document.getElementById('my-pfp').src = currentUser.pfp;
    
    // Fill settings modal
    document.getElementById('set-pfp').value = currentUser.pfp;
    document.getElementById('set-banner').value = currentUser.banner;
    document.getElementById('set-bio').value = currentUser.bio;
    document.getElementById('set-status').value = currentUser.status;
}

async function saveProfile() {
    const updates = {
        pfp: document.getElementById('set-pfp').value,
        banner: document.getElementById('set-banner').value,
        bio: document.getElementById('set-bio').value,
        status: document.getElementById('set-status').value
    };
    const res = await fetch(`${API_URL}/users/${currentUser._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    currentUser = await res.json();
    localStorage.setItem('scene_user', JSON.stringify(currentUser));
    updateUserPanel();
    hideModal('profile-modal');
}

// --- NAVIGATION & HOME (DMs) ---
async function goHome() {
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    document.querySelector('.home-icon').classList.add('active');
    
    document.getElementById('sidebar-title').innerText = "Direct Messages";
    document.getElementById('add-friend-btn').classList.remove('hidden');
    document.getElementById('add-channel-btn').classList.add('hidden');
    document.getElementById('server-settings-btn').classList.add('hidden');
    
    // Fetch friends & DMs
    const res = await fetch(`${API_URL}/users/${currentUser._id}/friends`);
    const data = await res.json();
    
    const list = document.getElementById('sidebar-list');
    list.innerHTML = '';
    
    data.friends.forEach(friend => {
        // Find the DM id for this friend
        const dm = data.dms.find(d => d.participants.includes(friend._id));
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `<img src="${friend.pfp}" class="avatar" style="width:24px;height:24px;"> ${friend.username}`;
        div.onclick = () => selectChat(dm._id, `@${friend.username}`);
        list.appendChild(div);
    });
}

async function addFriend() {
    const tag = document.getElementById('friend-tag').value;
    const res = await fetch(`${API_URL}/friends/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentUserId: currentUser._id, friendTag: tag })
    });
    const data = await res.json();
    if(data.error) alert(data.error);
    hideModal('friend-modal');
    goHome();
}

// --- SERVERS & CHANNELS ---
async function loadServers() {
    const res = await fetch(`${API_URL}/servers`);
    serverList = await res.json();
    const container = document.getElementById('servers-container');
    container.innerHTML = '';
    serverList.forEach(server => {
        const div = document.createElement('div');
        div.className = 'server-icon';
        if (server.icon) {
            div.style.backgroundImage = `url(${server.icon})`;
        } else {
            div.innerText = server.name.charAt(0).toUpperCase();
        }
        div.onclick = (e) => {
            document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
            e.target.classList.add('active');
            selectServer(server);
        };
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

let activeServer = null;
function selectServer(server) {
    activeServer = server;
    document.getElementById('sidebar-title').innerText = server.name;
    document.getElementById('add-friend-btn').classList.add('hidden');
    
    const isOwner = server.ownerId === currentUser._id;
    document.getElementById('add-channel-btn').classList.toggle('hidden', !isOwner);
    document.getElementById('server-settings-btn').classList.toggle('hidden', !isOwner);
    
    document.getElementById('edit-server-name').value = server.name;
    loadChannels(server._id);
}

async function updateServer() {
    const newName = document.getElementById('edit-server-name').value;
    await fetch(`${API_URL}/servers/${activeServer._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
    });
    hideModal('server-settings-modal');
    loadServers();
    document.getElementById('sidebar-title').innerText = newName;
}

async function loadChannels(serverId) {
    const res = await fetch(`${API_URL}/servers/${serverId}/channels`);
    const channels = await res.json();
    const list = document.getElementById('sidebar-list');
    list.innerHTML = '';
    channels.forEach(channel => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerText = `# ${channel.name}`;
        div.onclick = () => selectChat(channel._id, `# ${channel.name}`);
        list.appendChild(div);
    });
}

async function createChannel() {
    const name = document.getElementById('new-channel-name').value;
    await fetch(`${API_URL}/servers/${activeServer._id}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    });
    hideModal('channel-modal');
    loadChannels(activeServer._id);
}

// --- MESSAGING ---
function selectChat(targetId, chatName) {
    currentTargetId = targetId;
    document.getElementById('current-chat-name').innerText = chatName;
    document.getElementById('message-input').disabled = false;
    
    if (messageInterval) clearInterval(messageInterval);
    loadMessages();
    messageInterval = setInterval(loadMessages, 3000);
}

async function loadMessages() {
    if (!currentTargetId) return;
    const res = await fetch(`${API_URL}/messages/${currentTargetId}`);
    const messages = await res.json();
    const container = document.getElementById('messages-container');
    container.innerHTML = '';
    
    messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'message';
        div.innerHTML = `
            <img src="${msg.authorId.pfp}" class="avatar">
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
    if (!input.value.trim() || !currentTargetId) return;
    
    await fetch(`${API_URL}/messages/${currentTargetId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: input.value, userId: currentUser._id })
    });
    
    input.value = '';
    loadMessages();
});

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
