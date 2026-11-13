const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';
let currentUser = JSON.parse(localStorage.getItem('scene_user'));
let currentTargetId = null;
let messageInterval = null;

if (currentUser) showApp();

// --- AUTH LOGIC ---
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
    goHome();
}

// --- PROFILE LOGIC ---
function updateUserPanel() {
    document.getElementById('my-username').innerText = currentUser.username;
    document.getElementById('my-status').innerText = currentUser.status || 'Online';
    document.getElementById('my-pfp').src = currentUser.pfp;
    
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
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates)
    });
    currentUser = await res.json();
    localStorage.setItem('scene_user', JSON.stringify(currentUser));
    updateUserPanel();
    hideModal('my-settings-modal');
}

// View other user's profile
window.showUserProfile = function(userStr) {
    const user = JSON.parse(decodeURIComponent(userStr));
    document.getElementById('view-username').innerText = user.username;
    document.getElementById('view-disc').innerText = `#${user.discriminator}`;
    document.getElementById('view-pfp').src = user.pfp;
    document.getElementById('view-status').innerText = user.status;
    document.getElementById('view-bio').innerText = user.bio;
    
    const bannerEl = document.getElementById('view-banner');
    if(user.banner.startsWith('http')) {
        bannerEl.style.backgroundImage = `url(${user.banner})`;
        bannerEl.style.backgroundColor = 'transparent';
    } else {
        bannerEl.style.backgroundImage = 'none';
        bannerEl.style.backgroundColor = user.banner;
    }
    showModal('view-profile-modal');
}

// --- NAVIGATION & FRIENDS ---
async function goHome() {
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    document.querySelector('.home-icon').classList.add('active');
    
    document.getElementById('sidebar-title').innerText = "Direct Messages";
    document.getElementById('add-friend-btn').classList.remove('hidden');
    document.getElementById('add-channel-btn').classList.add('hidden');
    document.getElementById('server-settings-btn').classList.add('hidden');
    
    const res = await fetch(`${API_URL}/users/${currentUser._id}/friends`);
    const data = await res.json();
    const list = document.getElementById('sidebar-list');
    list.innerHTML = '';
    
    data.friends.forEach(friend => {
        const dm = data.dms.find(d => d.participants.includes(friend._id));
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `<img src="${friend.pfp}" class="avatar" style="width:24px;height:24px;"> ${friend.username}`;
        div.onclick = (e) => {
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectChat(dm._id, `@${friend.username}`);
        };
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
    // Only fetch servers you are a member of!
    const res = await fetch(`${API_URL}/servers/user/${currentUser._id}`);
    const servers = await res.json();
    const container = document.getElementById('servers-container');
    container.innerHTML = '';
    
    servers.forEach(server => {
        const div = document.createElement('div');
        div.className = 'server-icon';
        if (server.icon) { div.style.backgroundImage = `url(${server.icon})`; } 
        else { div.innerText = server.name.charAt(0).toUpperCase(); }
        
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

async function joinServer() {
    const serverId = document.getElementById('join-server-id').value;
    const res = await fetch(`${API_URL}/servers/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, userId: currentUser._id })
    });
    const data = await res.json();
    if(data.error) alert(data.error);
    hideModal('join-server-modal');
    loadServers();
}

let activeServer = null;
async function selectServer(server) {
    activeServer = server;
    document.getElementById('sidebar-title').innerText = server.name;
    document.getElementById('add-friend-btn').classList.add('hidden');
    
    const isOwner = server.ownerId === currentUser._id;
    document.getElementById('add-channel-btn').classList.toggle('hidden', !isOwner);
    document.getElementById('server-settings-btn').classList.toggle('hidden', !isOwner);
    
    document.getElementById('server-id-display').innerText = server._id; // Show ID for invites
    document.getElementById('edit-server-name').value = server.name;
    
    await loadChannels(server._id);
}

async function updateServer() {
    const newName = document.getElementById('edit-server-name').value;
    await fetch(`${API_URL}/servers/${activeServer._id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName })
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
    
    channels.forEach((channel, index) => {
        const div = document.createElement('div');
        div.className = 'list-item';
        div.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> ${channel.name}`;
        div.onclick = (e) => {
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectChat(channel._id, `# ${channel.name}`);
        };
        list.appendChild(div);
        
        // AUTO-SELECT FIRST CHANNEL
        if(index === 0) {
            div.classList.add('active');
            selectChat(channel._id, `# ${channel.name}`);
        }
    });
}

async function createChannel() {
    const name = document.getElementById('new-channel-name').value;
    await fetch(`${API_URL}/servers/${activeServer._id}/channels`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
    });
    hideModal('channel-modal');
    loadChannels(activeServer._id);
}

// --- MESSAGES ---
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
    
    // Check if scrolled to bottom before appending to keep position
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    
    container.innerHTML = '';
    messages.forEach(msg => {
        const userStr = encodeURIComponent(JSON.stringify(msg.authorId));
        const div = document.createElement('div');
        div.className = 'message';
        div.innerHTML = `
            <img src="${msg.authorId.pfp}" class="avatar" onclick="showUserProfile('${userStr}')">
            <div>
                <div class="message-header">
                    <span class="username" onclick="showUserProfile('${userStr}')">${msg.authorId.username}</span>
                    <span class="disc">#${msg.authorId.discriminator}</span>
                </div>
                <div class="text">${msg.content}</div>
            </div>
        `;
        container.appendChild(div);
    });
    
    if(isAtBottom) container.scrollTop = container.scrollHeight;
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
    document.getElementById('messages-container').scrollTop = document.getElementById('messages-container').scrollHeight;
});

function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
