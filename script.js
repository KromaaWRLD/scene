const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';
let currentUser = JSON.parse(localStorage.getItem('scene_user'));
let currentTargetId = null;
let activeServer = null;
let messageInterval = null;
let replyingToId = null;
let pendingInviteCode = null;

// Convert Image File to Base64 String
function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// Check for invites in the URL
window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('invite')) {
        pendingInviteCode = params.get('invite');
        window.history.replaceState({}, document.title, "/"); // Clean URL
    }
    if (currentUser) {
        showApp();
        if (pendingInviteCode) showModal('invite-prompt-modal');
    }
};

// --- AUTH LOGIC ---
function toggleAuth() {
    document.getElementById('login-box').classList.toggle('hidden');
    document.getElementById('register-box').classList.toggle('hidden');
}
async function login() {
    const res = await fetch(`${API_URL}/login`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: document.getElementById('login-username').value, password: document.getElementById('login-password').value }) });
    const data = await res.json();
    if(data.error) return document.getElementById('login-error').innerText = data.error;
    loginSuccess(data);
}
async function register() {
    const res = await fetch(`${API_URL}/register`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ username: document.getElementById('reg-username').value, password: document.getElementById('reg-password').value }) });
    const data = await res.json();
    if(data.error) return document.getElementById('reg-error').innerText = data.error;
    loginSuccess(data);
}
function loginSuccess(user) {
    currentUser = user; localStorage.setItem('scene_user', JSON.stringify(user));
    showApp();
    if (pendingInviteCode) showModal('invite-prompt-modal');
}
function logout() { localStorage.removeItem('scene_user'); location.reload(); }

function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    updateUserPanel();
    loadServers();
    goHome();
}

// --- SETTINGS (Discord Style) ---
function openUserSettings() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = "USER SETTINGS";
    document.getElementById('settings-user-panel').classList.remove('hidden');
    document.getElementById('settings-server-panel').classList.add('hidden');
    
    document.getElementById('set-preview-name').innerText = `${currentUser.username}#${currentUser.discriminator}`;
    document.getElementById('set-preview-pfp').src = currentUser.pfp;
    document.getElementById('set-bio').value = currentUser.bio;
    document.getElementById('set-status').value = currentUser.status;
    
    if(currentUser.banner.startsWith('data:') || currentUser.banner.startsWith('http')) {
        document.getElementById('set-preview-banner').style.backgroundImage = `url(${currentUser.banner})`;
    } else {
        document.getElementById('set-preview-banner').style.backgroundColor = currentUser.banner;
    }
}

function openServerSettings() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = `${activeServer.name.toUpperCase()} SETTINGS`;
    document.getElementById('settings-server-panel').classList.remove('hidden');
    document.getElementById('settings-user-panel').classList.add('hidden');
    
    document.getElementById('edit-server-name').value = activeServer.name;
    document.getElementById('server-invite-link').value = `${window.location.origin}/?invite=${activeServer.inviteCode}`;
}

function closeSettings() { document.getElementById('settings-screen').classList.add('hidden'); }

async function saveProfile() {
    const pfpFile = document.getElementById('upload-pfp').files[0];
    const bannerFile = document.getElementById('upload-banner').files[0];
    
    let pfpData = currentUser.pfp;
    let bannerData = currentUser.banner;
    
    if (pfpFile) pfpData = await toBase64(pfpFile);
    if (bannerFile) bannerData = await toBase64(bannerFile);

    const updates = {
        pfp: pfpData, banner: bannerData,
        bio: document.getElementById('set-bio').value,
        status: document.getElementById('set-status').value
    };
    
    const res = await fetch(`${API_URL}/users/${currentUser._id}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(updates)
    });
    currentUser = await res.json();
    localStorage.setItem('scene_user', JSON.stringify(currentUser));
    updateUserPanel();
    closeSettings();
}

function updateUserPanel() {
    document.getElementById('my-username').innerText = currentUser.username;
    document.getElementById('my-status').innerText = currentUser.status;
    document.getElementById('my-pfp').src = currentUser.pfp;
}

window.showUserProfile = function(userStr) {
    const user = JSON.parse(decodeURIComponent(userStr));
    document.getElementById('view-username').innerText = user.username;
    document.getElementById('view-disc').innerText = `#${user.discriminator}`;
    document.getElementById('view-pfp').src = user.pfp;
    document.getElementById('view-status').innerText = user.status;
    document.getElementById('view-bio').innerText = user.bio;
    
    const badgeContainer = document.getElementById('view-badges');
    badgeContainer.innerHTML = '';
    if(user.badges) {
        user.badges.forEach(b => {
            const span = document.createElement('span');
            span.className = 'badge'; span.innerText = b;
            badgeContainer.appendChild(span);
        });
    }

    const bannerEl = document.getElementById('view-banner');
    if(user.banner.startsWith('data:') || user.banner.startsWith('http')) {
        bannerEl.style.backgroundImage = `url(${user.banner})`; bannerEl.style.backgroundColor = 'transparent';
    } else {
        bannerEl.style.backgroundImage = 'none'; bannerEl.style.backgroundColor = user.banner;
    }
    showModal('view-profile-modal');
}

// --- SERVERS, CHANNELS, & MEMBERS ---
async function goHome() {
    activeServer = null;
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    document.querySelector('.home-icon').classList.add('active');
    document.getElementById('sidebar-title').innerText = "Direct Messages";
    document.getElementById('add-friend-btn').classList.remove('hidden');
    document.getElementById('add-channel-btn').classList.add('hidden');
    document.getElementById('server-settings-btn').classList.add('hidden');
    document.getElementById('member-list').classList.add('hidden'); // Hide member list in DMs
    
    const res = await fetch(`${API_URL}/users/${currentUser._id}/friends`);
    const data = await res.json();
    const list = document.getElementById('sidebar-list'); list.innerHTML = '';
    
    data.friends.forEach(f => {
        const dm = data.dms.find(d => d.participants.includes(f._id));
        const div = document.createElement('div'); div.className = 'list-item';
        div.innerHTML = `<img src="${f.pfp}" class="avatar" style="width:24px;height:24px;"> ${f.username}`;
        div.onclick = (e) => {
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectChat(dm._id, `@${f.username}`);
        };
        list.appendChild(div);
    });
}

async function loadServers() {
    const res = await fetch(`${API_URL}/servers/user/${currentUser._id}`);
    const servers = await res.json();
    const container = document.getElementById('servers-container'); container.innerHTML = '';
    servers.forEach(s => {
        const div = document.createElement('div'); div.className = 'server-icon';
        if (s.icon) div.style.backgroundImage = `url(${s.icon})`; else div.innerText = s.name.charAt(0).toUpperCase();
        div.onclick = (e) => {
            document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
            e.target.classList.add('active'); selectServer(s);
        };
        container.appendChild(div);
    });
}

async function selectServer(server) {
    activeServer = server;
    document.getElementById('sidebar-title').innerText = server.name;
    document.getElementById('add-friend-btn').classList.add('hidden');
    const isOwner = server.ownerId === currentUser._id;
    document.getElementById('add-channel-btn').classList.toggle('hidden', !isOwner);
    document.getElementById('server-settings-btn').classList.toggle('hidden', !isOwner);
    document.getElementById('member-list').classList.remove('hidden'); // Show members
    
    loadChannels(server._id);
    loadMembers(server._id);
}

async function loadChannels(serverId) {
    const res = await fetch(`${API_URL}/servers/${serverId}/channels`);
    const channels = await res.json();
    const list = document.getElementById('sidebar-list'); list.innerHTML = '';
    channels.forEach((c, index) => {
        const div = document.createElement('div'); div.className = 'list-item';
        div.innerText = `# ${c.name}`;
        div.onclick = (e) => {
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active'); selectChat(c._id, `# ${c.name}`);
        };
        list.appendChild(div);
        if(index === 0) { div.classList.add('active'); selectChat(c._id, `# ${c.name}`); } // Auto select first
    });
}

async function loadMembers(serverId) {
    const res = await fetch(`${API_URL}/servers/${serverId}/members`);
    const members = await res.json();
    const container = document.getElementById('members-container'); container.innerHTML = '';
    members.forEach(m => {
        const userStr = encodeURIComponent(JSON.stringify(m));
        const div = document.createElement('div'); div.className = 'member-item';
        div.innerHTML = `<img src="${m.pfp}" class="avatar"> <span class="username">${m.username}</span>`;
        div.onclick = () => showUserProfile(userStr);
        container.appendChild(div);
    });
}

// Invites
function copyInvite() {
    const input = document.getElementById('server-invite-link');
    input.select(); document.execCommand('copy'); alert('Invite copied!');
}
async function acceptInvite() {
    const res = await fetch(`${API_URL}/servers/join/${pendingInviteCode}`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: currentUser._id })
    });
    pendingInviteCode = null;
    hideModal('invite-prompt-modal');
    loadServers();
}

// --- MESSAGING ---
function selectChat(targetId, chatName) {
    currentTargetId = targetId;
    document.getElementById('current-chat-name').innerText = chatName;
    document.getElementById('message-input').disabled = false;
    cancelReply();
    loadMessages(true); // true means scroll to bottom instantly
    if (messageInterval) clearInterval(messageInterval);
    messageInterval = setInterval(() => loadMessages(false), 2000);
}

function initReply(msgId, username) {
    replyingToId = msgId;
    document.getElementById('reply-banner').classList.remove('hidden');
    document.getElementById('reply-user').innerText = `@${username}`;
    document.getElementById('message-input').focus();
}
function cancelReply() {
    replyingToId = null;
    document.getElementById('reply-banner').classList.add('hidden');
}

async function deleteMsg(id) {
    await fetch(`${API_URL}/messages/${id}`, { method: 'DELETE' });
    loadMessages(false);
}

async function editMsg(id) {
    const newContent = prompt("Edit message:");
    if(newContent) {
        await fetch(`${API_URL}/messages/edit/${id}`, {
            method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ content: newContent })
        });
        loadMessages(false);
    }
}

async function loadMessages(forceScroll = false) {
    if (!currentTargetId) return;
    const res = await fetch(`${API_URL}/messages/${currentTargetId}`);
    const messages = await res.json();
    const container = document.getElementById('messages-container');
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    
    container.innerHTML = '';
    messages.forEach(msg => {
        const userStr = encodeURIComponent(JSON.stringify(msg.authorId));
        const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        const div = document.createElement('div'); div.className = 'message-wrapper';
        
        let replyHtml = '';
        if (msg.replyTo) {
            replyHtml = `<div class="reply-context">
                <img src="${msg.replyTo.authorId.pfp || ''}" style="width:12px;height:12px;border-radius:50%;">
                <span class="rep-user">@${msg.replyTo.authorId.username}</span> ${msg.replyTo.content.substring(0, 40)}...
            </div>`;
        }

        let actionHtml = `<div class="message-actions">
            <button onclick="initReply('${msg._id}', '${msg.authorId.username}')">Reply</button>`;
        if(msg.authorId._id === currentUser._id) {
            actionHtml += `<button onclick="editMsg('${msg._id}')">Edit</button>
                           <button class="del" onclick="deleteMsg('${msg._id}')">Delete</button>`;
        }
        actionHtml += `</div>`;

        div.innerHTML = `
            ${replyHtml}
            <div class="message">
                <img src="${msg.authorId.pfp}" class="avatar" onclick="showUserProfile('${userStr}')">
                <div style="flex:1;">
                    <div class="message-header">
                        <span class="username" onclick="showUserProfile('${userStr}')">${msg.authorId.username}</span>
                        <span class="timestamp">${time}</span>
                    </div>
                    <div class="text">${msg.content} ${msg.isEdited ? '<span class="is-edited">(edited)</span>' : ''}</div>
                </div>
                ${actionHtml}
            </div>
        `;
        container.appendChild(div);
    });
    
    if(isAtBottom || forceScroll) container.scrollTop = container.scrollHeight;
}

document.getElementById('message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    if (!input.value.trim() || !currentTargetId) return;
    
    const content = input.value;
    input.value = ''; // Clear instantly for responsiveness
    
    await fetch(`${API_URL}/messages/${currentTargetId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content, userId: currentUser._id, replyTo: replyingToId })
    });
    
    cancelReply();
    loadMessages(true); // Force fetch and scroll immediately
});

// Modals
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
async function addFriend() {
    await fetch(`${API_URL}/friends/add`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentUserId: currentUser._id, friendTag: document.getElementById('friend-tag').value }) });
    hideModal('friend-modal'); goHome();
}
async function createServer() {
    await fetch(`${API_URL}/servers`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: document.getElementById('new-server-name').value, userId: currentUser._id }) });
    hideModal('server-modal'); loadServers();
}
async function createChannel() {
    await fetch(`${API_URL}/servers/${activeServer._id}/channels`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: document.getElementById('new-channel-name').value }) });
    hideModal('channel-modal'); loadChannels(activeServer._id);
}
