const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';
let currentUser = JSON.parse(localStorage.getItem('scene_user'));
let realAdminUser = null; // Stores original admin when impersonating
let currentTargetId = null;
let activeServer = null;
let messageInterval = null;
let heartbeatInterval = null;
let replyingToId = null;
let lastRenderedHash = "";
let globalConfig = {};

window.userCache = {};
window.currentServerMembers = [];
window.adminUsersList = [];
window.adminServersList = [];
let selectedAdminUser = null;
let selectedAdminServer = null;

const verifiedSVG = `<svg class="verified-badge verified-svg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" fill="currentColor"/><path d="M10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

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
    await fetch(`${API_URL}/servers/join/${inv}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser._id }) });
    localStorage.removeItem('pending_invite');
    hideModal('invite-prompt-modal');
    loadServers();
}
function cancelInvite() { localStorage.removeItem('pending_invite'); hideModal('invite-prompt-modal'); }

async function joinServerViaCode() {
    const code = document.getElementById('join-invite-code').value;
    if (!code) return;
    await fetch(`${API_URL}/servers/join/${code}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: currentUser._id }) });
    hideModal('server-modal');
    loadServers();
}

// --- AUTH ---
function toggleAuth() { document.getElementById('login-box').classList.toggle('hidden'); document.getElementById('register-box').classList.toggle('hidden'); }
async function login() {
    const res = await fetch(`${API_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('login-username').value, password: document.getElementById('login-password').value }) });
    const data = await res.json();
    if (data.error) return document.getElementById('login-error').innerText = data.error;
    loginSuccess(data);
}
async function register() {
    const res = await fetch(`${API_URL}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: document.getElementById('reg-username').value, password: document.getElementById('reg-password').value }) });
    const data = await res.json();
    if (data.error) return document.getElementById('reg-error').innerText = data.error;
    loginSuccess(data);
}
function loginSuccess(user) { currentUser = user; localStorage.setItem('scene_user', JSON.stringify(user)); showApp(); }
function logout() { localStorage.removeItem('scene_user'); location.reload(); }

async function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    updateUserPanel();
    loadServers();
    goHome();
    checkInvite();
    await runHeartbeat();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(runHeartbeat, 5000);
}

// --- HEARTBEAT (WARNINGS, MAINTENANCE, SUSPENSIONS, CHANGELOG) ---
async function runHeartbeat() {
    if (!currentUser) return;
    try {
        const res = await fetch(`${API_URL}/heartbeat/${currentUser._id}`, { method: 'POST' });
        if (!res.ok) return;
        const data = await res.json();
        globalConfig = data.config || {};

        // Kick out non-admins if Maintenance Mode was just turned on
        if (data.maintenanceMode && !currentUser.isAdmin && !realAdminUser) {
            alert("Scene has entered Maintenance Mode.");
            logout();
            return;
        }

        // Kick out if newly suspended
        if (data.user.suspendedUntil && new Date(data.user.suspendedUntil) > new Date() && !realAdminUser) {
            alert(`Your account was suspended until ${new Date(data.user.suspendedUntil).toLocaleString()}`);
            logout();
            return;
        }

        // Show live Admin Warning Popup
        if (data.warning) {
            document.getElementById('system-warning-text').innerText = data.warning;
            showModal('system-warning-modal');
        }

        // Show Changelog modal if version changed
        if (globalConfig.changelogVersion && localStorage.getItem('seen_changelog') !== globalConfig.changelogVersion) {
            document.getElementById('changelog-modal-title').innerText = `What's New (${globalConfig.changelogVersion})`;
            document.getElementById('changelog-modal-body').innerText = globalConfig.changelogText;
            showModal('changelog-modal');
        }

        // Apply global emoji toggle to UI
        document.getElementById('emoji-btn').style.display = globalConfig.allowEmojis === false ? 'none' : 'inline-block';
    } catch (e) { /* ignore network blips */ }
}

function dismissChangelog() {
    if (globalConfig.changelogVersion) {
        localStorage.setItem('seen_changelog', globalConfig.changelogVersion);
    }
    hideModal('changelog-modal');
}

// --- PROFILE SETTINGS & ADMIN ---
function updateUserPanel() {
    document.getElementById('my-username').innerText = currentUser.username;
    document.getElementById('my-custom-status').innerText = currentUser.customStatus || 'Online';
    document.getElementById('my-pfp').src = currentUser.pfp;
    const dot = document.getElementById('my-activity-dot');
    dot.className = `status-dot ${currentUser.activity || 'online'}`;

    if (currentUser.isAdmin && !realAdminUser) {
        document.getElementById('tab-admin').style.display = 'block';
        document.getElementById('quick-admin-btn').classList.remove('hidden');
    } else {
        document.getElementById('tab-admin').style.display = 'none';
        document.getElementById('quick-admin-btn').classList.add('hidden');
    }
}

function showSettingsPane(id, tabEl = null) {
    document.querySelectorAll('.settings-pane').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.settings-tab').forEach(el => el.classList.remove('active'));
    document.getElementById(id).classList.remove('hidden');

    if (tabEl) {
        tabEl.classList.add('active');
    } else if (typeof event !== 'undefined' && event && event.target && event.target.classList) {
        event.target.classList.add('active');
    }
    if (id === 'settings-admin-panel') loadAdminPanel();
    if (id === 'settings-support-panel') loadUserSupportPane();
}

function openAdminSettingsQuickly() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = "USER SETTINGS";
    document.getElementById('tab-my-account').style.display = 'block';
    document.getElementById('tab-support').style.display = 'block';
    document.getElementById('tab-admin').style.display = 'block';
    document.getElementById('tab-server').style.display = 'none';
    showSettingsPane('settings-admin-panel', document.getElementById('tab-admin'));
}

function openUserSettings() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = "USER SETTINGS";

    document.getElementById('tab-my-account').style.display = 'block';
    document.getElementById('tab-support').style.display = 'block';
    if (currentUser.isAdmin && !realAdminUser) document.getElementById('tab-admin').style.display = 'block';
    document.getElementById('tab-server').style.display = 'none';

    showSettingsPane('settings-user-panel', document.getElementById('tab-my-account'));

    document.getElementById('set-preview-name').innerText = `${currentUser.username}#${currentUser.discriminator}`;
    document.getElementById('set-preview-pfp').src = currentUser.pfp;
    document.getElementById('set-bio').value = currentUser.bio || '';
    document.getElementById('set-activity').value = currentUser.activity || 'online';
    document.getElementById('set-custom-status').value = currentUser.customStatus || '';
    const bannerEl = document.getElementById('set-preview-banner');
    if (currentUser.banner && (currentUser.banner.startsWith('data:') || currentUser.banner.startsWith('http'))) {
        bannerEl.style.backgroundImage = `url(${currentUser.banner})`; bannerEl.style.backgroundColor = 'transparent';
    } else {
        bannerEl.style.backgroundImage = 'none'; bannerEl.style.backgroundColor = currentUser.banner || '#36393f';
    }
}

function openServerSettings() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = `${activeServer.name.toUpperCase()} SETTINGS`;

    document.getElementById('tab-my-account').style.display = 'none';
    document.getElementById('tab-support').style.display = 'none';
    document.getElementById('tab-admin').style.display = 'none';
    document.getElementById('tab-server').style.display = 'block';

    showSettingsPane('settings-server-panel', document.getElementById('tab-server'));

    document.getElementById('edit-server-name').value = activeServer.name;
    document.getElementById('server-invite-link').value = `${window.location.origin}/?invite=${activeServer.inviteCode}`;
}

async function saveProfile() {
    if (realAdminUser) return alert("Cannot save changes in Read-Only Impersonation Mode.");
    const pfpFile = document.getElementById('upload-pfp').files[0];
    const bannerFile = document.getElementById('upload-banner').files[0];
    let pfpData = currentUser.pfp;
    let bannerData = currentUser.banner;
    if (pfpFile) pfpData = await toBase64(pfpFile);
    if (bannerFile) bannerData = await toBase64(bannerFile);
    const updates = { pfp: pfpData, banner: bannerData, bio: document.getElementById('set-bio').value, activity: document.getElementById('set-activity').value, customStatus: document.getElementById('set-custom-status').value };
    const res = await fetch(`${API_URL}/users/${currentUser._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    currentUser = await res.json();
    localStorage.setItem('scene_user', JSON.stringify(currentUser));
    updateUserPanel();
    closeSettings();
}

async function saveServer() { await fetch(`${API_URL}/servers/${activeServer._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('edit-server-name').value }) }); closeSettings(); loadServers(); }
async function deleteServer() { if (!confirm("Are you sure? This cannot be undone.")) return; await fetch(`${API_URL}/servers/${activeServer._id}`, { method: 'DELETE' }); closeSettings(); goHome(); loadServers(); }
function copyInvite() { const input = document.getElementById('server-invite-link'); input.select(); document.execCommand('copy'); alert('Invite copied!'); }
function closeSettings() { document.getElementById('settings-screen').classList.add('hidden'); }

// --- USER SUPPORT & TOS ---
async function loadUserSupportPane() {
    const cfgRes = await fetch(`${API_URL}/config`);
    const cfg = await cfgRes.json();
    document.getElementById('user-tos-display').innerText = cfg.tosText || 'No rules set.';

    const tRes = await fetch(`${API_URL}/tickets/user/${currentUser._id}`);
    const tickets = await tRes.json();
    const list = document.getElementById('user-tickets-list');
    list.innerHTML = tickets.length ? '' : '<div style="color:#72767d; font-size:13px;">No tickets submitted yet.</div>';
    tickets.forEach(t => {
        list.innerHTML += `<div class="admin-item" style="flex-direction:column; align-items:flex-start;">
            <div style="display:flex; justify-content:space-between; width:100%;">
                <b>${t.subject}</b>
                <span class="badge" style="background:${t.status === 'Resolved' ? '#43b581' : '#faa61a'};">${t.status}</span>
            </div>
            <div style="font-size:13px; color:#b9bbbe;">${t.message}</div>
            ${t.reply ? `<div style="font-size:13px; color:#43b581; margin-top:4px;"><b>Support Reply:</b> ${t.reply}</div>` : ''}
        </div>`;
    });
}

async function submitTicket() {
    const subject = document.getElementById('ticket-subject').value.trim();
    const message = document.getElementById('ticket-message').value.trim();
    if (!subject || !message) return alert("Please enter both a subject and description.");
    await fetch(`${API_URL}/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser._id, subject, message })
    });
    document.getElementById('ticket-subject').value = '';
    document.getElementById('ticket-message').value = '';
    loadUserSupportPane();
}

// ==========================================
// --- EXPANDED ADMIN PANEL LOGIC ---
// ==========================================
function switchAdminSubtab(paneId, btnEl) {
    document.querySelectorAll('.admin-subpane').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.admin-subtab').forEach(el => el.classList.remove('active'));
    document.getElementById(paneId).classList.remove('hidden');
    btnEl.classList.add('active');
}

async function loadAdminPanel() {
    // 1. Load Users
    const uRes = await fetch(`${API_URL}/admin/users`);
    window.adminUsersList = await uRes.json();
    const uContainer = document.getElementById('admin-user-list');
    uContainer.innerHTML = '';
    window.adminUsersList.forEach(u => {
        const isSuspended = u.suspendedUntil && new Date(u.suspendedUntil) > new Date();
        uContainer.innerHTML += `<div class="admin-item">
            <div style="display:flex;align-items:center;gap:10px; overflow:hidden;">
                <img src="${u.pfp}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">
                <div>
                    <div style="display:flex;align-items:center;gap:4px;">
                        <b>${u.username}#${u.discriminator}</b>
                        ${u.isAdmin ? '<span class="badge" style="background:#faa61a;color:black;">Admin</span>' : ''}
                        ${u.isVerified ? verifiedSVG : ''}
                        ${isSuspended ? '<span class="badge" style="background:#ed4245;">Suspended</span>' : ''}
                    </div>
                    <div style="font-size:11px; color:#8e9297;">Joined: ${new Date(u.createdAt).toLocaleDateString()} | Last Active: ${new Date(u.lastActive).toLocaleTimeString()}</div>
                </div>
            </div>
            <div style="display:flex;gap:5px; flex-shrink:0;">
                <button class="btn-manage" onclick="openAdminUserModal('${u._id}')">Manage</button>
                <button class="btn-verify" onclick="adminToggleVerifyUser('${u._id}', ${!u.isVerified})">${u.isVerified ? 'Unverify' : 'Verify'}</button>
                <button class="btn-del" onclick="adminDeleteUser('${u._id}')">Delete</button>
            </div>
        </div>`;
    });

    // 2. Load Servers
    const sRes = await fetch(`${API_URL}/admin/servers`);
    window.adminServersList = await sRes.json();
    const sContainer = document.getElementById('admin-server-list');
    sContainer.innerHTML = '';
    window.adminServersList.forEach(s => {
        sContainer.innerHTML += `<div class="admin-item">
            <div>
                <div style="display:flex;align-items:center;gap:4px;">
                    <b>${s.name}</b> ${s.isVerified ? verifiedSVG : ''}
                    ${s.isQuarantined ? '<span class="badge" style="background:#ed4245;">Quarantined</span>' : ''}
                </div>
                <div style="font-size:11px; color:#8e9297;">Members: ${s.members.length} | Invite: <code>${s.inviteCode}</code> | Max Channels: ${s.maxChannels || 50}</div>
            </div>
            <div style="display:flex;gap:5px;">
                <button class="btn-manage" onclick="openAdminServerModal('${s._id}')">Manage</button>
                <button class="btn-verify" onclick="adminToggleVerify('${s._id}', ${!s.isVerified})">${s.isVerified ? 'Unverify' : 'Verify'}</button>
                <button class="btn-del" onclick="adminDeleteServer('${s._id}')">Delete</button>
            </div>
        </div>`;
    });

    // 3. Load System Config & Channels for System Message
    const cfgRes = await fetch(`${API_URL}/config`);
    const cfg = await cfgRes.json();
    globalConfig = cfg;
    document.getElementById('cfg-maintenance').checked = cfg.maintenanceMode || false;
    document.getElementById('cfg-emojis').checked = cfg.allowEmojis !== false;
    document.getElementById('cfg-mentions').checked = cfg.allowMentions !== false;
    document.getElementById('cfg-rate-count').value = cfg.rateLimitCount || 5;
    document.getElementById('cfg-rate-window').value = cfg.rateLimitWindowSec || 10;

    document.getElementById('cfg-welcome-enabled').checked = cfg.autoWelcomeEnabled !== false;
    document.getElementById('cfg-welcome-msg').value = cfg.autoWelcomeMsg || '';
    document.getElementById('cfg-changelog-ver').value = cfg.changelogVersion || '';
    document.getElementById('cfg-changelog-text').value = cfg.changelogText || '';
    document.getElementById('cfg-tos-text').value = cfg.tosText || '';

    // Badge Studio List
    const bList = document.getElementById('badge-studio-list');
    bList.innerHTML = '';
    (cfg.customBadges || []).forEach(b => {
        bList.innerHTML += `<span class="badge" style="background:${b.color}; font-size:12px; padding:4px 8px;">${b.icon} ${b.name}</span>`;
    });

    // All Channels Dropdown
    const chRes = await fetch(`${API_URL}/admin/all-channels`);
    const channels = await chRes.json();
    const chSelect = document.getElementById('sys-msg-channel');
    chSelect.innerHTML = '';
    channels.forEach(c => {
        const srvName = c.serverId ? c.serverId.name : 'Unknown Server';
        chSelect.innerHTML += `<option value="${c._id}">[${srvName}] #${c.name}</option>`;
    });

    // 4. Load Tickets
    const tRes = await fetch(`${API_URL}/admin/tickets`);
    const tickets = await tRes.json();
    const tContainer = document.getElementById('admin-tickets-list');
    tContainer.innerHTML = tickets.length ? '' : '<div style="color:#72767d;font-size:13px;">No support tickets.</div>';
    tickets.forEach(t => {
        const sender = t.userId ? `${t.userId.username}#${t.userId.discriminator}` : 'Unknown User';
        tContainer.innerHTML += `<div class="admin-item" style="flex-direction:column; align-items:flex-start;">
            <div style="display:flex; justify-content:space-between; width:100%;">
                <span><b>${t.subject}</b> <small style="color:#8e9297;">from ${sender}</small></span>
                <span class="badge" style="background:${t.status === 'Resolved' ? '#43b581' : '#faa61a'};">${t.status}</span>
            </div>
            <p style="font-size:13px; color:#dcddde;">${t.message}</p>
            <div style="display:flex; gap:6px; width:100%; margin-top:4px;">
                <input type="text" id="t-reply-${t._id}" value="${t.reply || ''}" placeholder="Write support reply..." style="flex:1; padding:6px; background:#18191c; border:none; color:white; border-radius:4px;">
                <button class="btn-manage" onclick="adminReplyTicket('${t._id}')">Reply & Resolve</button>
            </div>
        </div>`;
    });

    // 5. Load Audit Logs
    const aRes = await fetch(`${API_URL}/admin/audit-logs`);
    const logs = await aRes.json();
    const aContainer = document.getElementById('admin-audit-list');
    aContainer.innerHTML = '';
    logs.forEach(l => {
        aContainer.innerHTML += `<div class="admin-item" style="font-size:13px;">
            <span><b style="color:#faa61a;">${l.adminName}</b>: ${l.action} (<span style="color:#00aff4;">${l.target}</span>)</span>
            <span style="font-size:11px; color:#72767d;">${new Date(l.timestamp).toLocaleString()}</span>
        </div>`;
    });
}

// --- ADMIN USER MODAL ACTIONS ---
async function openAdminUserModal(userId) {
    selectedAdminUser = window.adminUsersList.find(u => u._id === userId);
    if (!selectedAdminUser) return;

    document.getElementById('adm-u-title').innerText = `Manage ${selectedAdminUser.username}#${selectedAdminUser.discriminator}`;
    document.getElementById('adm-u-dates').innerText = `Created: ${new Date(selectedAdminUser.createdAt).toLocaleString()} • Last Active: ${new Date(selectedAdminUser.lastActive).toLocaleString()}`;
    document.getElementById('adm-u-name').value = selectedAdminUser.username;
    document.getElementById('adm-u-disc').value = selectedAdminUser.discriminator;
    document.getElementById('adm-u-pass').value = '';
    document.getElementById('adm-u-warn').value = '';

    renderAdminUserBadges();

    // Populate Badge Dropdown
    const bSelect = document.getElementById('adm-u-badge-select');
    bSelect.innerHTML = '';
    (globalConfig.customBadges || []).forEach(b => {
        bSelect.innerHTML += `<option value="${b.name}">${b.icon} ${b.name}</option>`;
    });

    // Load User's Servers
    const sRes = await fetch(`${API_URL}/admin/users/${userId}/servers`);
    const servers = await sRes.json();
    const sList = document.getElementById('adm-u-servers');
    sList.innerHTML = servers.length ? '' : '<div style="font-size:12px;color:#72767d;">Not in any servers.</div>';
    servers.forEach(s => {
        sList.innerHTML += `<div class="admin-item" style="padding:4px 8px; font-size:12px;"><span>${s.name}</span><span>${s.members.length} members</span></div>`;
    });

    showModal('admin-user-modal');
}

function renderAdminUserBadges() {
    const container = document.getElementById('adm-u-badges');
    container.innerHTML = '';
    (selectedAdminUser.badges || []).forEach(b => {
        container.innerHTML += `<span class="badge">${b}</span>`;
    });
}

async function admSaveIdentity() {
    const username = document.getElementById('adm-u-name').value.trim();
    const discriminator = document.getElementById('adm-u-disc').value.trim();
    const res = await fetch(`${API_URL}/admin/users/${selectedAdminUser._id}/identity`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, discriminator, adminName: currentUser.username })
    });
    selectedAdminUser = await res.json();
    alert("Updated user username/tag!");
    loadAdminPanel();
}

async function admResetPassword() {
    const newPassword = document.getElementById('adm-u-pass').value.trim();
    if (!newPassword) return alert("Enter a new password.");
    await fetch(`${API_URL}/admin/users/${selectedAdminUser._id}/password`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword, adminName: currentUser.username })
    });
    document.getElementById('adm-u-pass').value = '';
    alert("Password forcefully reset!");
}

async function admSuspendUser() {
    const hours = Number(document.getElementById('adm-u-suspend-hours').value);
    const res = await fetch(`${API_URL}/admin/users/${selectedAdminUser._id}/suspend`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours, adminName: currentUser.username })
    });
    selectedAdminUser = await res.json();
    alert(hours > 0 ? `User suspended for ${hours} hours.` : "Suspension lifted.");
    loadAdminPanel();
}

async function admWarnUser() {
    const warning = document.getElementById('adm-u-warn').value.trim();
    if (!warning) return;
    await fetch(`${API_URL}/admin/users/${selectedAdminUser._id}/warn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warning, adminName: currentUser.username })
    });
    document.getElementById('adm-u-warn').value = '';
    alert("Warning queued! It will pop up on their screen immediately.");
}

async function admResetProfile(type) {
    const res = await fetch(`${API_URL}/admin/users/${selectedAdminUser._id}/reset-profile`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, adminName: currentUser.username })
    });
    selectedAdminUser = await res.json();
    alert(`Reset user's ${type}!`);
    loadAdminPanel();
}

async function admManageBadge(action) {
    const badge = document.getElementById('adm-u-badge-select').value;
    if (!badge) return;
    const res = await fetch(`${API_URL}/admin/users/${selectedAdminUser._id}/badges`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badge, action, adminName: currentUser.username })
    });
    selectedAdminUser = await res.json();
    renderAdminUserBadges();
    loadAdminPanel();
}

function admStartImpersonation() {
    realAdminUser = currentUser;
    currentUser = selectedAdminUser;
    hideModal('admin-user-modal');
    closeSettings();
    document.getElementById('impersonation-banner').classList.remove('hidden');
    document.getElementById('impersonating-name').innerText = `${currentUser.username}#${currentUser.discriminator}`;
    updateUserPanel();
    loadServers();
    goHome();
}

function stopImpersonation() {
    if (!realAdminUser) return;
    currentUser = realAdminUser;
    realAdminUser = null;
    document.getElementById('impersonation-banner').classList.add('hidden');
    updateUserPanel();
    loadServers();
    goHome();
}

// --- ADMIN SERVER MODAL ACTIONS ---
async function openAdminServerModal(serverId) {
    selectedAdminServer = window.adminServersList.find(s => s._id === serverId);
    if (!selectedAdminServer) return;

    document.getElementById('adm-s-title').innerText = `Manage Server: ${selectedAdminServer.name}`;
    document.getElementById('adm-s-name').value = selectedAdminServer.name;
    document.getElementById('adm-s-invite').value = selectedAdminServer.inviteCode;
    document.getElementById('adm-s-maxch').value = selectedAdminServer.maxChannels || 50;
    document.getElementById('adm-s-quarantine').checked = selectedAdminServer.isQuarantined || false;

    await loadAdminLockedChannels(serverId);
    showModal('admin-server-modal');
}

async function loadAdminLockedChannels(serverId) {
    const res = await fetch(`${API_URL}/admin/servers/${serverId}/locked-channels`);
    const channels = await res.json();
    const list = document.getElementById('adm-s-locked-list');
    list.innerHTML = channels.length ? '' : '<div style="font-size:12px;color:#72767d;">No locked channels in this server.</div>';
    channels.forEach(ch => {
        const membersStr = (ch.allowedMembers || []).map(m => `${m.username}#${m.discriminator}`).join(', ') || 'None';
        list.innerHTML += `<div class="admin-item" style="flex-direction:column; align-items:flex-start; font-size:12px;">
            <b>🔒 #${ch.name}</b>
            <div style="color:#b9bbbe;">Allowed: ${membersStr}</div>
            <div style="display:flex; gap:4px; width:100%; margin-top:4px;">
                <input type="text" id="allow-tag-${ch._id}" placeholder="User#0000" style="flex:1; padding:4px; font-size:12px;">
                <button class="btn-manage" onclick="admEditChannelAllowlist('${ch._id}', 'add')">Add</button>
                <button class="btn-del" onclick="admEditChannelAllowlist('${ch._id}', 'remove')">Remove</button>
            </div>
        </div>`;
    });
}

async function admEditChannelAllowlist(channelId, action) {
    const userTag = document.getElementById(`allow-tag-${channelId}`).value.trim();
    if (!userTag.includes('#')) return alert("Enter User#0000 format.");
    const res = await fetch(`${API_URL}/admin/channels/${channelId}/allowlist`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userTag, action, adminName: currentUser.username })
    });
    if (!res.ok) return alert("User not found!");
    loadAdminLockedChannels(selectedAdminServer._id);
}

async function admRegenInvite() {
    const res = await fetch(`${API_URL}/admin/servers/${selectedAdminServer._id}/manage`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenInvite: true, adminName: currentUser.username })
    });
    selectedAdminServer = await res.json();
    document.getElementById('adm-s-invite').value = selectedAdminServer.inviteCode;
    loadAdminPanel();
}

async function admSaveServer() {
    const name = document.getElementById('adm-s-name').value.trim();
    const inviteCode = document.getElementById('adm-s-invite').value.trim();
    const maxChannels = document.getElementById('adm-s-maxch').value;
    const isQuarantined = document.getElementById('adm-s-quarantine').checked;

    const res = await fetch(`${API_URL}/admin/servers/${selectedAdminServer._id}/manage`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, inviteCode, maxChannels, isQuarantined, adminName: currentUser.username })
    });
    selectedAdminServer = await res.json();
    alert("Server oversight settings saved!");
    loadAdminPanel();
    loadServers();
}

// --- SYSTEM CONTROLS, MESSAGES & COMMUNITY ACTIONS ---
async function saveSystemConfig() {
    const payload = {
        adminName: currentUser.username,
        maintenanceMode: document.getElementById('cfg-maintenance').checked,
        allowEmojis: document.getElementById('cfg-emojis').checked,
        allowMentions: document.getElementById('cfg-mentions').checked,
        rateLimitCount: Number(document.getElementById('cfg-rate-count').value),
        rateLimitWindowSec: Number(document.getElementById('cfg-rate-window').value)
    };
    await fetch(`${API_URL}/admin/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    alert("System & Security settings saved!");
    loadAdminPanel();
}

async function sendSystemMessage() {
    const targetId = document.getElementById('sys-msg-channel').value;
    const content = document.getElementById('sys-msg-content').value.trim();
    if (!targetId || !content) return alert("Select a channel and enter a message.");
    await fetch(`${API_URL}/admin/system-message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId, content, adminName: currentUser.username })
    });
    document.getElementById('sys-msg-content').value = '';
    alert("Official System message sent!");
    if (currentTargetId === targetId) loadMessages(true);
}

async function createCustomBadge() {
    const name = document.getElementById('new-badge-name').value.trim();
    const icon = document.getElementById('new-badge-icon').value.trim();
    const color = document.getElementById('new-badge-color').value;
    if (!name) return alert("Enter a badge name.");
    await fetch(`${API_URL}/admin/badges`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon, color, adminName: currentUser.username })
    });
    document.getElementById('new-badge-name').value = '';
    loadAdminPanel();
}

async function saveCommunityConfig() {
    const payload = {
        adminName: currentUser.username,
        autoWelcomeEnabled: document.getElementById('cfg-welcome-enabled').checked,
        autoWelcomeMsg: document.getElementById('cfg-welcome-msg').value,
        changelogVersion: document.getElementById('cfg-changelog-ver').value,
        changelogText: document.getElementById('cfg-changelog-text').value,
        tosText: document.getElementById('cfg-tos-text').value
    };
    await fetch(`${API_URL}/admin/config`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    alert("Community settings saved!");
    loadAdminPanel();
}

async function adminReplyTicket(ticketId) {
    const reply = document.getElementById(`t-reply-${ticketId}`).value.trim();
    await fetch(`${API_URL}/admin/tickets/${ticketId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply, status: 'Resolved', adminName: currentUser.username })
    });
    alert("Ticket replied & marked as Resolved!");
    loadAdminPanel();
}

async function adminDeleteUser(id) {
    if (!confirm("Permanently delete this user?")) return;
    await fetch(`${API_URL}/admin/users/${id}?adminName=${encodeURIComponent(currentUser.username)}`, { method: 'DELETE' });
    loadAdminPanel();
}
async function adminDeleteServer(id) {
    if (!confirm("Permanently delete this server?")) return;
    await fetch(`${API_URL}/servers/${id}`, { method: 'DELETE' });
    loadAdminPanel(); loadServers();
}
async function adminToggleVerify(id, status) {
    await fetch(`${API_URL}/admin/servers/verify/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isVerified: status, adminName: currentUser.username }) });
    loadAdminPanel(); loadServers();
}
async function adminToggleVerifyUser(id, status) {
    await fetch(`${API_URL}/admin/users/verify/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isVerified: status, adminName: currentUser.username }) });
    loadAdminPanel();
}

// --- PROFILES ---
window.showUserProfile = function(event, userId) {
    event.stopPropagation();
    const user = window.userCache[userId];
    if (!user) return;

    document.getElementById('view-username').innerHTML = `${user.username}<span id="view-disc">#${user.discriminator}</span> ${user.isVerified ? verifiedSVG : ''}`;
    document.getElementById('view-pfp').src = user.pfp;

    let statusText = user.customStatus || user.activity.charAt(0).toUpperCase() + user.activity.slice(1);
    document.getElementById('view-status').innerText = statusText;
    document.getElementById('view-activity-dot').className = `status-dot large ${user.activity}`;
    document.getElementById('view-bio').innerText = user.bio || '';

    const badgeContainer = document.getElementById('view-badges');
    badgeContainer.innerHTML = '';
    if (user.badges && user.badges.length > 0) {
        user.badges.forEach(b => {
            const custom = (globalConfig.customBadges || []).find(cb => cb.name === b);
            const bg = custom ? custom.color : '#5865F2';
            const icon = custom ? `${custom.icon} ` : '';
            badgeContainer.innerHTML += `<span class="badge" style="background:${bg};">${icon}${b}</span>`;
        });
    }

    const bannerEl = document.getElementById('view-banner');
    if (user.banner && (user.banner.startsWith('data:') || user.banner.startsWith('http'))) {
        bannerEl.style.backgroundImage = `url(${user.banner})`; bannerEl.style.backgroundColor = 'transparent';
    } else {
        bannerEl.style.backgroundImage = 'none'; bannerEl.style.backgroundColor = user.banner || '#36393f';
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

// Global Click Closer
document.addEventListener('click', (e) => {
    const profileModal = document.getElementById('view-profile-modal');
    if (profileModal && !profileModal.classList.contains('hidden') && !e.target.closest('#view-profile-modal')) {
        profileModal.classList.add('hidden');
    }
    if (!e.target.closest('#context-menu')) {
        document.getElementById('context-menu').classList.add('hidden');
    }
    if (!e.target.closest('emoji-picker') && e.target.id !== 'emoji-btn') {
        document.getElementById('emoji-picker').classList.add('hidden');
    }
    if (!e.target.closest('#mention-suggestions')) {
        document.getElementById('mention-suggestions').classList.add('hidden');
    }
});

// --- NAVIGATION ---
async function goHome() {
    activeServer = null;
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    document.querySelector('.home-icon').classList.add('active');
    document.getElementById('sidebar-title').innerText = "Direct Messages";

    document.getElementById('add-friend-btn').classList.remove('hidden');
    document.getElementById('add-channel-btn').classList.add('hidden');
    document.getElementById('server-settings-btn').classList.add('hidden');
    document.getElementById('member-list').classList.add('hidden');
    document.getElementById('current-chat-topic').innerText = "";

    const res = await fetch(`${API_URL}/users/${currentUser._id}/friends`);
    const data = await res.json();
    const list = document.getElementById('sidebar-list'); list.innerHTML = '';

    let firstFriendDiv = null;

    data.friends.forEach(f => {
        window.userCache[f._id] = f;
        const dm = data.dms.find(d => d.participants.includes(f._id));
        if (!dm) return;
        const div = document.createElement('div'); div.className = 'list-item';
        div.innerHTML = `<div class="avatar-wrapper"><img src="${f.pfp}" class="avatar" style="width:24px;height:24px;"><div class="status-dot ${f.activity}" style="width:8px;height:8px;bottom:0;right:0;"></div></div> ${f.username} ${f.isVerified ? verifiedSVG : ''}`;
        div.onclick = (e) => {
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active'); selectChat(dm._id, `@${f.username}`);
        };
        list.appendChild(div);

        if (!firstFriendDiv) firstFriendDiv = div;
    });

    if (firstFriendDiv) {
        firstFriendDiv.click();
    } else {
        document.getElementById('current-chat-name').innerText = "No Friends Yet";
        currentTargetId = null;
        lastRenderedHash = "";
        document.getElementById('messages-container').innerHTML = '';
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

async function selectServer(server) {
    activeServer = server;
    document.getElementById('sidebar-title').innerHTML = `${server.name} ${server.isVerified ? verifiedSVG : ''}`;
    document.getElementById('add-friend-btn').classList.add('hidden');
    const isOwner = server.ownerId === currentUser._id;
    const isSysAdmin = currentUser.isAdmin === true && !realAdminUser;
    document.getElementById('add-channel-btn').classList.toggle('hidden', !isOwner && !isSysAdmin);
    document.getElementById('server-settings-btn').classList.toggle('hidden', !isOwner && !isSysAdmin);
    document.getElementById('member-list').classList.remove('hidden');

    loadChannels(server._id);
    loadMembers(server._id);
}

// RIGHT CLICK CONTEXT MENU
let contextTargetId = null;
function showContextMenu(e, id, type) {
    e.preventDefault();
    e.stopPropagation();
    if (activeServer && (activeServer.ownerId === currentUser._id || (currentUser.isAdmin && !realAdminUser))) {
        const menu = document.getElementById('context-menu');
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
        menu.classList.remove('hidden');
        contextTargetId = id;
    }
}
async function deleteChannelCtx() {
    if (!contextTargetId) return;
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
        const isAllowed = !c.isLocked || c.allowedMembers?.includes(currentUser._id) || activeServer.ownerId === currentUser._id || (currentUser.isAdmin && !realAdminUser);
        const lockIcon = c.isLocked ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#72767d" stroke-width="2" style="margin-left:auto;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>` : '';

        const div = document.createElement('div'); div.className = 'list-item';
        div.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> ${c.name} ${lockIcon}`;

        div.addEventListener('contextmenu', (e) => showContextMenu(e, c._id, 'channel'));

        div.onclick = (e) => {
            if (!isAllowed) return alert("You don't have permission to view this locked channel.");
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectChat(c._id, `# ${c.name}`, c.topic);
        };
        list.appendChild(div);

        if (isAllowed && !firstAllowedChannel) firstAllowedChannel = { c, div };
    });

    if (firstAllowedChannel) {
        firstAllowedChannel.div.classList.add('active');
        selectChat(firstAllowedChannel.c._id, `# ${firstAllowedChannel.c.name}`, firstAllowedChannel.c.topic);
    } else {
        document.getElementById('current-chat-name').innerText = "No Channels Available";
        document.getElementById('current-chat-topic').innerText = "";
        currentTargetId = null;
        lastRenderedHash = "";
        document.getElementById('messages-container').innerHTML = '';
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
    if (currentTargetId === targetId) return;

    currentTargetId = targetId;
    lastRenderedHash = "";
    document.getElementById('current-chat-name').innerText = chatName;
    document.getElementById('current-chat-topic').innerText = topic;

    const msgInput = document.getElementById('message-input');
    if (realAdminUser) {
        msgInput.disabled = true;
        msgInput.placeholder = "Read-only impersonation mode...";
    } else {
        msgInput.disabled = false;
        msgInput.placeholder = "Send a message...";
    }
    cancelReply();

    document.getElementById('messages-container').innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#72767d;">Loading messages...</div>`;

    if (messageInterval) clearInterval(messageInterval);
    loadMessages(true);
    messageInterval = setInterval(() => loadMessages(false), 2000);
}

function initReply(msgId, username) {
    if (realAdminUser) return;
    replyingToId = msgId;
    document.getElementById('reply-banner').classList.remove('hidden');
    document.getElementById('reply-user').innerText = `@${username}`;
    document.getElementById('message-input').focus();
}
function cancelReply() { replyingToId = null; document.getElementById('reply-banner').classList.add('hidden'); }

async function deleteMsg(id) { await fetch(`${API_URL}/messages/${id}`, { method: 'DELETE' }); loadMessages(false); }
async function editMsg(id) {
    const newContent = prompt("Edit message:");
    if (newContent) {
        await fetch(`${API_URL}/messages/edit/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: newContent }) });
        loadMessages(false);
    }
}

async function loadMessages(forceScroll = false) {
    if (!currentTargetId) return;
    const requestedTargetId = currentTargetId;

    try {
        const res = await fetch(`${API_URL}/messages/${requestedTargetId}`);
        if (!res.ok) throw new Error("Failed to fetch messages");
        const messages = await res.json();

        if (currentTargetId !== requestedTargetId) return;

        const currentHash = `${requestedTargetId}:` + messages.map(m => `${m._id}-${m.content}-${m.isEdited}`).join('|');
        if (!forceScroll && currentHash === lastRenderedHash) return;
        lastRenderedHash = currentHash;

        const container = document.getElementById('messages-container');
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

        container.innerHTML = '';
        messages.forEach(msg => {
            if (!msg.authorId) return;
            window.userCache[msg.authorId._id] = msg.authorId;
            const time = new Date(msg.timestamp).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

            let safeContent = msg.content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            if (globalConfig.allowMentions !== false) {
                safeContent = safeContent.replace(/@(\w+)/g, '<span class="mention">@$1</span>');
            }

            const div = document.createElement('div'); div.className = 'message-wrapper';

            let replyHtml = '';
            if (msg.replyTo && msg.replyTo.authorId) {
                replyHtml = `<div class="reply-context"><img src="${msg.replyTo.authorId.pfp || ''}" style="width:16px;height:16px;border-radius:50%;"><span class="rep-user">@${msg.replyTo.authorId.username}</span> ${msg.replyTo.content.substring(0, 40)}...</div>`;
            }

            let actionHtml = '';
            if (!realAdminUser) {
                actionHtml = `<div class="message-actions"><button onclick="initReply('${msg._id}', '${msg.authorId.username}')" title="Reply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg></button>`;
                if (msg.authorId._id.toString() === currentUser._id.toString() || currentUser.isAdmin) {
                    actionHtml += `<button onclick="editMsg('${msg._id}')" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                                   <button class="del" onclick="deleteMsg('${msg._id}')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
                }
                actionHtml += `</div>`;
            }

            const sysBadge = msg.isSystem ? `<span class="system-tag">SYSTEM</span>` : '';

            div.innerHTML = `
                ${replyHtml}
                <div class="message ${msg.isSystem ? 'system-msg' : ''}">
                    <img src="${msg.authorId.pfp}" class="avatar" onclick="showUserProfile(event, '${msg.authorId._id}')">
                    <div style="flex:1;">
                        <div class="message-header">
                            <span class="username" onclick="showUserProfile(event, '${msg.authorId._id}')">${msg.authorId.username} ${msg.authorId.isVerified ? verifiedSVG : ''}</span>
                            ${sysBadge}
                            <span class="timestamp">${time}</span>
                        </div>
                        <div class="text">${safeContent} ${msg.isEdited ? '<span class="is-edited">(edited)</span>' : ''}</div>
                    </div>
                    ${actionHtml}
                </div>
            `;
            container.appendChild(div);
        });
        if (isAtBottom || forceScroll) container.scrollTop = container.scrollHeight;
    } catch (err) {
        console.error("Failed to load messages:", err);
        if (forceScroll && currentTargetId === requestedTargetId) {
            document.getElementById('messages-container').innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#ed4245;">Failed to load messages.</div>`;
        }
    }
}

// EMOJI & MENTION LOGIC
document.getElementById('emoji-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (globalConfig.allowEmojis === false) return;
    document.getElementById('emoji-picker').classList.toggle('hidden');
});
document.querySelector('emoji-picker').addEventListener('emoji-click', event => {
    const input = document.getElementById('message-input');
    input.value += event.detail.unicode;
    document.getElementById('emoji-picker').classList.add('hidden');
    input.focus();
});

document.getElementById('message-input').addEventListener('input', (e) => {
    if (globalConfig.allowMentions === false) return;
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
    if (realAdminUser) return;
    const input = document.getElementById('message-input');
    if (!input.value.trim() || !currentTargetId) return;
    const content = input.value; input.value = '';
    const res = await fetch(`${API_URL}/messages/${currentTargetId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: content, userId: currentUser._id, replyTo: replyingToId }) });
    if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Failed to send message.");
    }
    cancelReply(); loadMessages(true);
});

// Modals
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
async function addFriend() { await fetch(`${API_URL}/friends/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentUserId: currentUser._id, friendTag: document.getElementById('friend-tag').value }) }); hideModal('friend-modal'); goHome(); }
async function createServer() { await fetch(`${API_URL}/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('new-server-name').value, userId: currentUser._id }) }); hideModal('server-modal'); loadServers(); }

async function createChannel() {
    const isLocked = document.getElementById('new-channel-locked').checked;
    const res = await fetch(`${API_URL}/servers/${activeServer._id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('new-channel-name').value,
            topic: document.getElementById('new-channel-topic').value,
            isLocked: isLocked,
            userId: currentUser._id
        })
    });
    if (!res.ok) {
        const err = await res.json();
        alert(err.error || "Could not create channel.");
    }
    hideModal('channel-modal');
    loadChannels(activeServer._id);
}
