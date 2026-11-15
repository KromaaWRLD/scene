const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';
let currentUser = JSON.parse(localStorage.getItem('scene_user'));
let currentTargetId = null;
let activeServer = null;
let messageInterval = null;
let replyingToId = null;

window.userCache = {}; 
window.currentServerMembers = [];

function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

window.onload = () => {
    const params = new URLSearchParams(window.location.search);
    const invite = params.get('invite');
    if (invite) {
        localStorage.setItem('pending_invite', invite);
        window.history.replaceState({}, document.title, "/");
    }
    if (currentUser) showApp();
};

function checkInvite() {
    const inv = localStorage.getItem('pending_invite');
    if (inv) showModal('invite-prompt-modal');
}
async function acceptInvite() {
    const inv = localStorage.getItem('pending_invite');
    const res = await fetch(`${API_URL}/servers/join/${inv}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: currentUser._id }) });
    localStorage.removeItem('pending_invite');
    hideModal('invite-prompt-modal');
    loadServers();
}
function cancelInvite() { localStorage.removeItem('pending_invite'); hideModal('invite-prompt-modal'); }

async function joinServerViaCode() {
    const code = document.getElementById('join-invite-code').value;
    if(!code) return;
    await fetch(`${API_URL}/servers/join/${code}`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ userId: currentUser._id }) });
    hideModal('server-modal');
    loadServers();
}

// --- AUTH ---
function toggleAuth() { document.getElementById('login-box').classList.toggle('hidden'); document.getElementById('register-box').classList.toggle('hidden'); }
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
function loginSuccess(user) { currentUser = user; localStorage.setItem('scene_user', JSON.stringify(user)); showApp(); }
function logout() { localStorage.removeItem('scene_user'); location.reload(); }

function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    updateUserPanel();
    loadServers();
    goHome();
    checkInvite();
}

// --- PROFILE SETTINGS & ADMIN ---
function updateUserPanel() {
    document.getElementById('my-username').innerText = currentUser.username;
    document.getElementById('my-custom-status').innerText = currentUser.customStatus || 'Online';
    document.getElementById('my-pfp').src = currentUser.pfp;
    const dot = document.getElementById('my-activity-dot');
    dot.className = `status-dot ${currentUser.activity || 'online'}`;
    
    // FIX: Show Admin Panel Tab if user is Admin
    if(currentUser.isAdmin === true) {
        document.getElementById('tab-admin').style.display = 'block';
    }
}

function showSettingsPane(id) {
    document.querySelectorAll('.settings-pane').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.settings-tab').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.remove('hidden');
    event.target.classList.add('active');
    
    if(id === 'settings-admin-panel') loadAdminPanel();
}

function openUserSettings() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = "USER SETTINGS";
    
    // Ensure Server tab is hidden when viewing User settings
    document.getElementById('tab-server').style.display = 'none';
    
    showSettingsPane('settings-user-panel');
    document.getElementById('set-preview-name').innerText = `${currentUser.username}#${currentUser.discriminator}`;
    document.getElementById('set-preview-pfp').src = currentUser.pfp;
    document.getElementById('set-bio').value = currentUser.bio;
    document.getElementById('set-activity').value = currentUser.activity || 'online';
    document.getElementById('set-custom-status').value = currentUser.customStatus || '';
    const bannerEl = document.getElementById('set-preview-banner');
    if(currentUser.banner.startsWith('data:') || currentUser.banner.startsWith('http')) {
        bannerEl.style.backgroundImage = `url(${currentUser.banner})`; bannerEl.style.backgroundColor = 'transparent';
    } else {
        bannerEl.style.backgroundImage = 'none'; bannerEl.style.backgroundColor = currentUser.banner;
    }
}

async function saveProfile() {
    const pfpFile = document.getElementById('upload-pfp').files[0];
    const bannerFile = document.getElementById('upload-banner').files[0];
    let pfpData = currentUser.pfp;
    let bannerData = currentUser.banner;
    if (pfpFile) pfpData = await toBase64(pfpFile);
    if (bannerFile) bannerData = await toBase64(bannerFile);
    const updates = { pfp: pfpData, banner: bannerData, bio: document.getElementById('set-bio').value, activity: document.getElementById('set-activity').value, customStatus: document.getElementById('set-custom-status').value };
    const res = await fetch(`${API_URL}/users/${currentUser._id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(updates) });
    currentUser = await res.json();
    localStorage.setItem('scene_user', JSON.stringify(currentUser));
    updateUserPanel();
    closeSettings();
}

function openServerSettings() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = `${activeServer.name.toUpperCase()} SETTINGS`;
    document.getElementById('tab-server').style.display = 'block';
    showSettingsPane('settings-server-panel');
    document.getElementById('edit-server-name').value = activeServer.name;
    document.getElementById('server-invite-link').value = `${window.location.origin}/?invite=${activeServer.inviteCode}`;
}
async function saveServer() { await fetch(`${API_URL}/servers/${activeServer._id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: document.getElementById('edit-server-name').value }) }); closeSettings(); loadServers(); }
async function deleteServer() { if(!confirm("Are you sure? This cannot be undone.")) return; await fetch(`${API_URL}/servers/${activeServer._id}`, { method: 'DELETE' }); closeSettings(); goHome(); loadServers(); }
function copyInvite() { const input = document.getElementById('server-invite-link'); input.select(); document.execCommand('copy'); alert('Invite copied!'); }
function closeSettings() { document.getElementById('settings-screen').classList.add('hidden'); }

// --- ADMIN LOGIC ---
async function loadAdminPanel() {
    const uRes = await fetch(`${API_URL}/admin/users`);
    const users = await uRes.json();
    const uContainer = document.getElementById('admin-user-list'); uContainer.innerHTML = '';
    users.forEach(u => {
        uContainer.innerHTML += `<div class="admin-item"><div style="display:flex;align-items:center;gap:10px;"><img src="${u.pfp}" style="width:24px;height:24px;border-radius:50%;">${u.username}#${u.discriminator} ${u.isAdmin?'(Admin)':''}</div><button class="btn-del" onclick="adminDeleteUser('${u._id}')">Delete</button></div>`;
    });
    const sRes = await fetch(`${API_URL}/admin/servers`);
    const servers = await sRes.json();
    const sContainer = document.getElementById('admin-server-list'); sContainer.innerHTML = '';
    servers.forEach(s => {
        sContainer.innerHTML += `<div class="admin-item"><div>${s.name} ${s.isVerified?'(Verified)':''}</div><div style="display:flex;gap:5px;"><button class="btn-verify" onclick="adminToggleVerify('${s._id}', ${!s.isVerified})">${s.isVerified?'Unverify':'Verify'}</button><button class="btn-del" onclick="adminDeleteServer('${s._id}')">Delete</button></div></div>`;
    });
}
async function adminDeleteUser(id) { await fetch(`${API_URL}/admin/users/${id}`, { method: 'DELETE' }); loadAdminPanel(); }
async function adminDeleteServer(id) { await fetch(`${API_URL}/servers/${id}`, { method: 'DELETE' }); loadAdminPanel(); loadServers(); }
async function adminToggleVerify(id, status) { await fetch(`${API_URL}/admin/servers/verify/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ isVerified: status }) }); loadAdminPanel(); loadServers(); }

// --- PROFILES ---
window.showUserProfile = function(event, userId) {
    // FIX: Stop propagation so the global click listener doesn't immediately close it
    event.stopPropagation();
    
    const user = window.userCache[userId];
    if(!user) return;
    
    document.getElementById('view-username').innerText = user.username;
    document.getElementById('view-disc').innerText = `#${user.discriminator}`;
    document.getElementById('view-pfp').src = user.pfp;
    
    let statusText = user.customStatus || user.activity.charAt(0).toUpperCase() + user.activity.slice(1);
    document.getElementById('view-status').innerText = statusText;
    document.getElementById('view-activity-dot').className = `status-dot large ${user.activity}`;
    document.getElementById('view-bio').innerText = user.bio;
    
    const badgeContainer = document.getElementById('view-badges');
    badgeContainer.innerHTML = '';
    if(user.badges) user.badges.forEach(b => { badgeContainer.innerHTML += `<span class="badge">${b}</span>`; });

    const bannerEl = document.getElementById('view-banner');
    if(user.banner.startsWith('data:') || user.banner.startsWith('http')) {
        bannerEl.style.backgroundImage = `url(${user.banner})`; bannerEl.style.backgroundColor = 'transparent';
    } else {
        bannerEl.style.backgroundImage = 'none'; bannerEl.style.backgroundColor = user.banner;
    }
    
    const modal = document.getElementById('view-profile-modal');
    modal.classList.remove('hidden');
    
    let x = event.clientX + 10;
    let y = event.clientY + 10;
    if (x + 300 > window.innerWidth) x = window.innerWidth - 320;
    if (y + 400 > window.innerHeight) y = window.innerHeight - 420;
    
    modal.style.left = x + 'px';
    modal.style.top = y + 'px';
}

// Global click closer for menus/popups (FIXED to not instantly close modals)
document.addEventListener('click', (e) => {
    if(!e.target.closest('#view-profile-modal') && !e.target.closest('.avatar') && !e.target.closest('.username')) {
        document.getElementById('view-profile-modal').classList.add('hidden');
    }
    if(!e.target.closest('#context-menu')) {
        document.getElementById('context-menu').classList.add('hidden');
    }
    if(!e.target.closest('emoji-picker') && e.target.id !== 'emoji-btn') {
        document.getElementById('emoji-picker').classList.add('hidden');
    }
    if(!e.target.closest('#mention-suggestions')) {
        document.getElementById('mention-suggestions').classList.add('hidden');
    }
});


// --- NAVIGATION ---
async function goHome() {
    activeServer = null;
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    document.querySelector('.home-icon').classList.add('active');
    document.getElementById('sidebar-title').innerText = "Direct Messages";
    
    // FIX: Completely hide server-specific UI
    document.getElementById('add-friend-btn').classList.remove('hidden');
    document.getElementById('add-channel-btn').classList.add('hidden');
    document.getElementById('server-settings-btn').classList.add('hidden');
    document.getElementById('member-list').classList.add('hidden');
    document.getElementById('current-chat-topic').innerText = ""; 
    document.getElementById('messages-container').innerHTML = '';
    
    const res = await fetch(`${API_URL}/users/${currentUser._id}/friends`);
    const data = await res.json();
    const list = document.getElementById('sidebar-list'); list.innerHTML = '';
    
    let firstFriendDiv = null;

    data.friends.forEach(f => {
        window.userCache[f._id] = f; 
        const dm = data.dms.find(d => d.participants.includes(f._id));
        const div = document.createElement('div'); div.className = 'list-item';
        div.innerHTML = `<div class="avatar-wrapper"><img src="${f.pfp}" class="avatar" style="width:24px;height:24px;"><div class="status-dot ${f.activity}" style="width:8px;height:8px;bottom:0;right:0;"></div></div> ${f.username}`;
        div.onclick = (e) => {
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active'); selectChat(dm._id, `@${f.username}`);
        };
        list.appendChild(div);
        
        if(!firstFriendDiv) firstFriendDiv = div;
    });

    if(firstFriendDiv) {
        firstFriendDiv.click();
    } else {
        document.getElementById('current-chat-name').innerText = "No Friends Yet";
        currentTargetId = null;
    }
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

const verifiedSVG = `<svg class="verified-badge verified-svg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="currentColor"/><path d="M10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

async function selectServer(server) {
    activeServer = server;
    document.getElementById('sidebar-title').innerHTML = `${server.name} ${server.isVerified ? verifiedSVG : ''}`;
    document.getElementById('add-friend-btn').classList.add('hidden');
    const isOwner = server.ownerId === currentUser._id;
    const isSysAdmin = currentUser.isAdmin === true;
    document.getElementById('add-channel-btn').classList.toggle('hidden', !isOwner && !isSysAdmin);
    document.getElementById('server-settings-btn').classList.toggle('hidden', !isOwner && !isSysAdmin);
    document.getElementById('member-list').classList.remove('hidden');
    document.getElementById('messages-container').innerHTML = ''; 
    
    loadChannels(server._id);
    loadMembers(server._id);
}

// RIGHT CLICK CONTEXT MENU
let contextTargetId = null;
function showContextMenu(e, id, type) {
    e.preventDefault();
    e.stopPropagation(); // FIX: Prevent immediate closing
    if (activeServer && (activeServer.ownerId === currentUser._id || currentUser.isAdmin)) {
        const menu = document.getElementById('context-menu');
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.classList.remove('hidden');
        contextTargetId = id;
    }
}
async function deleteChannelCtx() {
    if(!contextTargetId) return;
    await fetch(`${API_URL}/channels/${contextTargetId}`, { method: 'DELETE' });
    document.getElementById('context-menu').classList.add('hidden');
    loadChannels(activeServer._id);
}

async function loadChannels(serverId) {
    const res = await fetch(`${API_URL}/servers/${serverId}/channels`);
    const channels = await res.json();
    const list = document.getElementById('sidebar-list'); list.innerHTML = '';
    
    let firstAllowedChannel = null;

    channels.forEach((c) => {
        const isAllowed = !c.isLocked || c.allowedMembers?.includes(currentUser._id) || activeServer.ownerId === currentUser._id || currentUser.isAdmin;
        const lockIcon = c.isLocked ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#72767d" stroke-width="2" style="margin-left:auto;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>` : '';
        
        const div = document.createElement('div'); div.className = 'list-item';
        div.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> ${c.name} ${lockIcon}`;
        
        div.addEventListener('contextmenu', (e) => showContextMenu(e, c._id, 'channel'));
        
        div.onclick = (e) => {
            if(!isAllowed) return alert("You don't have permission to view this locked channel.");
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active'); 
            selectChat(c._id, `# ${c.name}`, c.topic);
        };
        list.appendChild(div);
        
        if(isAllowed && !firstAllowedChannel) firstAllowedChannel = { c, div };
    });

    if (firstAllowedChannel) {
        firstAllowedChannel.div.classList.add('active');
        selectChat(firstAllowedChannel.c._id, `# ${firstAllowedChannel.c.name}`, firstAllowedChannel.c.topic);
    } else {
        document.getElementById('current-chat-name').innerText = "No Channels Available";
        document.getElementById('current-chat-topic').innerText = "";
        currentTargetId = null;
    }
}

async function loadMembers(serverId) {
    const res = await fetch(`${API_URL}/servers/${serverId}/members`);
    const members = await res.json();
    window.currentServerMembers = members; 
    const container = document.getElementById('members-container'); container.innerHTML = '';
    members.forEach(m => {
        window.userCache[m._id] = m; 
        const div = document.createElement('div'); div.className = 'member-item';
        div.innerHTML = `<div class="avatar-wrapper"><img src="${m.pfp}" class="avatar" style="width:28px;height:28px;"><div class="status-dot ${m.activity}" style="width:10px;height:10px;"></div></div> <span class="username">${m.username}</span>`;
        div.onclick = (e) => showUserProfile(e, m._id); 
        container.appendChild(div);
    });
}

// --- MESSAGES ---
function selectChat(targetId, chatName, topic = "") {
    currentTargetId = targetId;
    document.getElementById('current-chat-name').innerText = chatName;
    document.getElementById('current-chat-topic').innerText = topic;
    document.getElementById('message-input').disabled = false;
    cancelReply();
    loadMessages(true);
    if (messageInterval) clearInterval(messageInterval);
    messageInterval = setInterval(() => loadMessages(false), 2000);
}

function initReply(msgId, username) {
    replyingToId = msgId;
    document.getElementById('reply-banner').classList.remove('hidden');
    document.getElementById('reply-user').innerText = `@${username}`;
    document.getElementById('message-input').focus();
}
function cancelReply() { replyingToId = null; document.getElementById('reply-banner').classList.add('hidden'); }

async function deleteMsg(id) { await fetch(`${API_URL}/messages/${id}`, { method: 'DELETE' }); loadMessages(false); }
async function editMsg(id) {
    const newContent = prompt("Edit message:");
    if(newContent) {
        await fetch(`${API_URL}/messages/edit/${id}`, { method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ content: newContent }) });
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
        window.userCache[msg.authorId._id] = msg.authorId;
        const time = new Date(msg.timestamp).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute:'2-digit' });
        
        let safeContent = msg.content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        safeContent = safeContent.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

        const div = document.createElement('div'); div.className = 'message-wrapper';
        
        let replyHtml = '';
        if (msg.replyTo && msg.replyTo.authorId) {
            replyHtml = `<div class="reply-context"><img src="${msg.replyTo.authorId.pfp || ''}" style="width:16px;height:16px;border-radius:50%;"><span class="rep-user">@${msg.replyTo.authorId.username}</span> ${msg.replyTo.content.substring(0, 40)}...</div>`;
        }

        let actionHtml = `<div class="message-actions"><button onclick="initReply('${msg._id}', '${msg.authorId.username}')" title="Reply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg></button>`;
        
        if(msg.authorId._id.toString() === currentUser._id.toString() || currentUser.isAdmin) {
            actionHtml += `<button onclick="editMsg('${msg._id}')" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                           <button class="del" onclick="deleteMsg('${msg._id}')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
        }
        actionHtml += `</div>`;

        div.innerHTML = `
            ${replyHtml}
            <div class="message">
                <img src="${msg.authorId.pfp}" class="avatar" onclick="showUserProfile(event, '${msg.authorId._id}')">
                <div style="flex:1;">
                    <div class="message-header">
                        <span class="username" onclick="showUserProfile(event, '${msg.authorId._id}')">${msg.authorId.username}</span>
                        <span class="timestamp">${time}</span>
                    </div>
                    <div class="text">${safeContent} ${msg.isEdited ? '<span class="is-edited">(edited)</span>' : ''}</div>
                </div>
                ${actionHtml}
            </div>
        `;
        container.appendChild(div);
    });
    if(isAtBottom || forceScroll) container.scrollTop = container.scrollHeight;
}

// EMOJI & MENTION LOGIC
document.getElementById('emoji-btn').addEventListener('click', (e) => {
    e.stopPropagation(); // FIX: Prevent immediately closing
    document.getElementById('emoji-picker').classList.toggle('hidden');
});
document.querySelector('emoji-picker').addEventListener('emoji-click', event => {
    const input = document.getElementById('message-input');
    input.value += event.detail.unicode;
    document.getElementById('emoji-picker').classList.add('hidden');
    input.focus();
});

document.getElementById('message-input').addEventListener('input', (e) => {
    const val = e.target.value;
    const match = val.match(/@(\w*)$/);
    const popup = document.getElementById('mention-suggestions');
    
    if (match && activeServer) {
        const query = match[1].toLowerCase();
        const filtered = window.currentServerMembers.filter(m => m.username.toLowerCase().startsWith(query));
        
        if (filtered.length > 0) {
            popup.innerHTML = filtered.map(m => `<div class="mention-item" onclick="insertMention('${m.username}')"><img src="${m.pfp}">${m.username}</div>`).join('');
            popup.classList.remove('hidden');
        } else {
            popup.classList.add('hidden');
        }
    } else {
        popup.classList.add('hidden');
    }
});
window.insertMention = function(username) {
    const input = document.getElementById('message-input');
    input.value = input.value.replace(/@\w*$/, `@${username} `);
    document.getElementById('mention-suggestions').classList.add('hidden');
    input.focus();
}

document.getElementById('message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('message-input');
    if (!input.value.trim() || !currentTargetId) return;
    const content = input.value; input.value = '';
    await fetch(`${API_URL}/messages/${currentTargetId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content, userId: currentUser._id, replyTo: replyingToId }) });
    cancelReply(); loadMessages(true);
});

// Modals
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
async function addFriend() { await fetch(`${API_URL}/friends/add`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ currentUserId: currentUser._id, friendTag: document.getElementById('friend-tag').value }) }); hideModal('friend-modal'); goHome(); }
async function createServer() { await fetch(`${API_URL}/servers`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ name: document.getElementById('new-server-name').value, userId: currentUser._id }) }); hideModal('server-modal'); loadServers(); }

async function createChannel() { 
    const isLocked = document.getElementById('new-channel-locked').checked;
    await fetch(`${API_URL}/servers/${activeServer._id}/channels`, { 
        method: 'POST', 
        headers: {'Content-Type': 'application/json'}, 
        body: JSON.stringify({ 
            name: document.getElementById('new-channel-name').value,
            topic: document.getElementById('new-channel-topic').value,
            isLocked: isLocked,
            userId: currentUser._id
        }) 
    }); 
    hideModal('channel-modal'); 
    loadChannels(activeServer._id); 
}
