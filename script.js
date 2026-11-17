const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api' : '/api';
let currentUser = JSON.parse(localStorage.getItem('scene_user'));
let realAdminUser = null;
let currentTargetId = null;
let activeServer = null;
let messageInterval = null;
let heartbeatInterval = null;
let replyingToId = null;
let lastRenderedHash = "";
let globalConfig = {};
let selectedUserDecoration = "";
let editingRoleId = null;
let lastTypingSentAt = 0;

// Unread & Ping tracking state
let lastReadMap = JSON.parse(localStorage.getItem('scene_last_read') || '{}');
let unreadSummary = { targets: {}, servers: {} };
let prevTotalPings = 0;

window.userCache = {};
window.currentServerMembers = [];
window.currentServerRoles = [];
window.currentServerMemberRoles = [];
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

function playPingSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
    } catch (e) { /* audio blocked before interaction */ }
}

function markTargetAsRead(targetId) {
    if (!targetId) return;
    lastReadMap[targetId] = Date.now();
    localStorage.setItem('scene_last_read', JSON.stringify(lastReadMap));
    if (unreadSummary.targets[targetId]) {
        unreadSummary.targets[targetId] = { hasUnread: false, pingCount: 0 };
    }
    applyUnreadBadgesToUI();
}

function getEffectiveDecoration(user) {
    if (!user || !user.avatarDecoration) return '';
    if (globalConfig.allowNonAdminDecorations === false && !user.isAdmin) return '';
    return user.avatarDecoration;
}

function getUserServerRoles(userId) {
    if (!activeServer) return [];
    const entry = window.currentServerMemberRoles.find(mr => mr.userId === userId);
    if (!entry || !entry.roleIds) return [];
    return entry.roleIds
        .map(rid => window.currentServerRoles.find(r => r._id === rid))
        .filter(Boolean);
}

function getMyServerPermissions() {
    const perms = { manageServer: false, manageChannels: false, manageMessages: false, viewLockedChannels: false };
    if (!activeServer || !currentUser) return perms;
    if (activeServer.ownerId === currentUser._id || (currentUser.isAdmin && !realAdminUser)) {
        return { manageServer: true, manageChannels: true, manageMessages: true, viewLockedChannels: true };
    }
    const roles = getUserServerRoles(currentUser._id);
    roles.forEach(r => {
        if (r.permissions) {
            if (r.permissions.manageServer) perms.manageServer = true;
            if (r.permissions.manageChannels) perms.manageChannels = true;
            if (r.permissions.manageMessages) perms.manageMessages = true;
            if (r.permissions.viewLockedChannels) perms.viewLockedChannels = true;
        }
    });
    return perms;
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
    await runHeartbeat();
    updateUserPanel();
    await loadServers();
    goHome();
    checkInvite();
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(runHeartbeat, 3500);
}

// --- HEARTBEAT & UNREAD / PING SYNC ---
async function runHeartbeat() {
    if (!currentUser) return;
    try {
        const res = await fetch(`${API_URL}/heartbeat/${currentUser._id}`, { method: 'POST' });
        if (!res.ok) return;
        const data = await res.json();
        globalConfig = data.config || {};

        if (data.maintenanceMode && !currentUser.isAdmin && !realAdminUser) {
            alert("Scene has entered Maintenance Mode.");
            logout();
            return;
        }

        if (data.user.suspendedUntil && new Date(data.user.suspendedUntil) > new Date() && !realAdminUser) {
            alert(`Your account was suspended until ${new Date(data.user.suspendedUntil).toLocaleString()}`);
            logout();
            return;
        }

        if (currentUser.avatarDecoration !== data.user.avatarDecoration) {
            currentUser.avatarDecoration = data.user.avatarDecoration;
            localStorage.setItem('scene_user', JSON.stringify(currentUser));
            updateUserPanel();
        }

        if (data.warning) {
            document.getElementById('system-warning-text').innerText = data.warning;
            showModal('system-warning-modal');
        }

        if (globalConfig.changelogVersion && localStorage.getItem('seen_changelog') !== globalConfig.changelogVersion) {
            document.getElementById('changelog-modal-title').innerText = `What's New (${globalConfig.changelogVersion})`;
            document.getElementById('changelog-modal-body').innerText = globalConfig.changelogText;
            showModal('changelog-modal');
        }

        document.getElementById('emoji-btn').style.display = globalConfig.allowEmojis === false ? 'none' : 'inline-block';

        // Refresh unread & @ping summary
        await refreshUnreadSummary();
    } catch (e) { /* ignore network blips */ }
}

async function refreshUnreadSummary() {
    if (!currentUser) return;
    try {
        if (currentTargetId) {
            lastReadMap[currentTargetId] = Date.now();
            localStorage.setItem('scene_last_read', JSON.stringify(lastReadMap));
        }
        const res = await fetch(`${API_URL}/unread-summary`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: currentUser._id,
                username: currentUser.username,
                lastReadMap
            })
        });
        if (!res.ok) return;
        unreadSummary = await res.json();

        // Count total pings across non-active targets
        let totalPings = 0;
        for (const [tid, st] of Object.entries(unreadSummary.targets || {})) {
            if (tid !== currentTargetId) totalPings += (st.pingCount || 0);
        }
        if (totalPings > prevTotalPings) {
            playPingSound();
        }
        prevTotalPings = totalPings;
        document.title = totalPings > 0 ? `(${totalPings}) Scene` : 'Scene';

        applyUnreadBadgesToUI();
    } catch (e) {}
}

function applyUnreadBadgesToUI() {
    // 1. Update Server Icons (white side highlight + red ping circle)
    document.querySelectorAll('#servers-container .server-icon').forEach(el => {
        const sid = el.dataset.serverId;
        const st = unreadSummary.servers?.[sid] || { hasUnread: false, pingCount: 0 };
        let pill = el.querySelector('.unread-pill');
        let badge = el.querySelector('.ping-badge');

        if (st.hasUnread || el.classList.contains('active')) {
            if (!pill) {
                pill = document.createElement('div');
                pill.className = 'unread-pill';
                el.appendChild(pill);
            }
        } else if (pill) {
            pill.remove();
        }

        if (st.pingCount > 0) {
            if (!badge) {
                badge = document.createElement('div');
                badge.className = 'ping-badge';
                el.appendChild(badge);
            }
            badge.innerText = st.pingCount > 99 ? '99+' : st.pingCount;
        } else if (badge) {
            badge.remove();
        }
    });

    // 2. Update Home DM Icon for unread DMs
    const homeIcon = document.getElementById('home-server-icon');
    if (homeIcon) {
        let dmUnread = false;
        let dmPings = 0;
        document.querySelectorAll('#sidebar-list .list-item[data-dm="true"]').forEach(el => {
            const tid = el.dataset.targetId;
            const st = unreadSummary.targets?.[tid];
            if (st?.hasUnread) dmUnread = true;
            dmPings += (st?.pingCount || 0);
        });
        let pill = homeIcon.querySelector('.unread-pill');
        let badge = homeIcon.querySelector('.ping-badge');
        if (dmUnread || homeIcon.classList.contains('active')) {
            if (!pill) { pill = document.createElement('div'); pill.className = 'unread-pill'; homeIcon.appendChild(pill); }
        } else if (pill) pill.remove();

        if (dmPings > 0) {
            if (!badge) { badge = document.createElement('div'); badge.className = 'ping-badge'; homeIcon.appendChild(badge); }
            badge.innerText = dmPings;
        } else if (badge) badge.remove();
    }

    // 3. Update Channels & DM List Items
    document.querySelectorAll('#sidebar-list .list-item').forEach(el => {
        const tid = el.dataset.targetId;
        if (!tid) return;
        const isCurrent = tid === currentTargetId;
        const st = isCurrent ? { hasUnread: false, pingCount: 0 } : (unreadSummary.targets?.[tid] || { hasUnread: false, pingCount: 0 });

        el.classList.toggle('has-unread', st.hasUnread);

        let pill = el.querySelector('.channel-unread-pill');
        if (st.hasUnread) {
            if (!pill) {
                pill = document.createElement('div');
                pill.className = 'channel-unread-pill';
                el.appendChild(pill);
            }
        } else if (pill) {
            pill.remove();
        }

        let badge = el.querySelector('.channel-ping-badge');
        if (st.pingCount > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'channel-ping-badge';
                el.appendChild(badge);
            }
            badge.innerText = st.pingCount > 99 ? '99+' : st.pingCount;
        } else if (badge) {
            badge.remove();
        }
    });
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

    const myDec = document.getElementById('my-decoration');
    const effectiveDec = getEffectiveDecoration(currentUser);
    if (effectiveDec) {
        myDec.src = effectiveDec;
        myDec.classList.remove('hidden');
    } else {
        myDec.classList.add('hidden');
    }

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
    if (id === 'settings-roles-panel') loadServerRolesPane();
    if (id === 'settings-channels-panel') loadServerChannelPermsPane();
}

function openAdminSettingsQuickly() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = "USER SETTINGS";
    document.getElementById('tab-my-account').style.display = 'block';
    document.getElementById('tab-support').style.display = 'block';
    document.getElementById('tab-admin').style.display = 'block';
    document.getElementById('tab-server').style.display = 'none';
    document.getElementById('tab-server-roles').style.display = 'none';
    document.getElementById('tab-server-channels').style.display = 'none';
    showSettingsPane('settings-admin-panel', document.getElementById('tab-admin'));
}

async function openUserSettings() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = "USER SETTINGS";

    document.getElementById('tab-my-account').style.display = 'block';
    document.getElementById('tab-support').style.display = 'block';
    if (currentUser.isAdmin && !realAdminUser) document.getElementById('tab-admin').style.display = 'block';
    document.getElementById('tab-server').style.display = 'none';
    document.getElementById('tab-server-roles').style.display = 'none';
    document.getElementById('tab-server-channels').style.display = 'none';

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

    const cfgRes = await fetch(`${API_URL}/config`);
    globalConfig = await cfgRes.json();
    selectedUserDecoration = getEffectiveDecoration(currentUser);
    renderUserDecorationPicker();
}

function renderUserDecorationPicker() {
    const previewDec = document.getElementById('set-preview-decoration');
    if (selectedUserDecoration) {
        previewDec.src = selectedUserDecoration;
        previewDec.classList.remove('hidden');
    } else {
        previewDec.classList.add('hidden');
    }

    const canWear = currentUser.isAdmin || globalConfig.allowNonAdminDecorations !== false;
    const disabledMsg = document.getElementById('user-decoration-disabled-msg');
    const grid = document.getElementById('user-decoration-grid');
    grid.innerHTML = '';

    if (!canWear) {
        disabledMsg.classList.remove('hidden');
        return;
    }
    disabledMsg.classList.add('hidden');

    const noneCard = document.createElement('div');
    noneCard.className = `decoration-card ${!selectedUserDecoration ? 'selected' : ''}`;
    noneCard.innerHTML = `<div style="width:44px;height:44px;border-radius:50%;background:#36393f;display:flex;align-items:center;justify-content:center;color:#72767d;font-size:18px;">✕</div><span>None</span>`;
    noneCard.onclick = () => {
        selectedUserDecoration = '';
        renderUserDecorationPicker();
    };
    grid.appendChild(noneCard);

    (globalConfig.avatarDecorations || []).forEach(dec => {
        const card = document.createElement('div');
        card.className = `decoration-card ${selectedUserDecoration === dec.image ? 'selected' : ''}`;
        card.innerHTML = `
            <div class="avatar-wrapper" style="width:44px;height:44px;">
                <img src="${currentUser.pfp}" class="avatar" style="width:44px;height:44px;">
                <img src="${dec.image}" class="avatar-decoration">
            </div>
            <span>${dec.name}</span>
        `;
        card.onclick = () => {
            selectedUserDecoration = dec.image;
            renderUserDecorationPicker();
        };
        grid.appendChild(card);
    });
}

function openServerSettings() {
    document.getElementById('settings-screen').classList.remove('hidden');
    document.getElementById('settings-header').innerText = `${activeServer.name.toUpperCase()} SETTINGS`;

    document.getElementById('tab-my-account').style.display = 'none';
    document.getElementById('tab-support').style.display = 'none';
    document.getElementById('tab-admin').style.display = 'none';
    document.getElementById('tab-server').style.display = 'block';
    document.getElementById('tab-server-roles').style.display = 'block';
    document.getElementById('tab-server-channels').style.display = 'block';

    showSettingsPane('settings-server-panel', document.getElementById('tab-server'));

    document.getElementById('edit-server-name').value = activeServer.name;
    document.getElementById('server-invite-link').value = `${window.location.origin}/?invite=${activeServer.inviteCode}`;
}

// --- SERVER ROLES CREATION, REORDERING, EDITING & PERMISSIONS ---
async function loadServerRolesPane() {
    if (!activeServer) return;
    const res = await fetch(`${API_URL}/servers/${activeServer._id}/members`);
    const data = await res.json();
    window.currentServerMembers = data.members;
    window.currentServerRoles = data.roles || [];
    window.currentServerMemberRoles = data.memberRoles || [];
    activeServer.roles = window.currentServerRoles;
    activeServer.memberRoles = window.currentServerMemberRoles;

    const rolesList = document.getElementById('server-roles-list');
    rolesList.innerHTML = window.currentServerRoles.length ? '' : '<div style="color:#72767d;font-size:13px;">No custom roles created yet.</div>';

    window.currentServerRoles.forEach((r, idx) => {
        const p = r.permissions || {};
        const permTags = [
            p.manageServer ? 'Manage Server' : '',
            p.manageChannels ? 'Manage Channels' : '',
            p.manageMessages ? 'Delete Messages' : '',
            p.viewLockedChannels ? 'Locked Channels' : ''
        ].filter(Boolean).join(' • ') || 'Basic Member Permissions';

        rolesList.innerHTML += `<div class="admin-item">
            <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                <div style="display:flex; flex-direction:column; gap:2px;">
                    <button class="btn-neutral" style="padding:2px 6px; font-size:10px;" ${idx === 0 ? 'disabled style="opacity:0.3;padding:2px 6px;font-size:10px;"' : ''} onclick="moveServerRole(${idx}, -1)">▲</button>
                    <button class="btn-neutral" style="padding:2px 6px; font-size:10px;" ${idx === window.currentServerRoles.length - 1 ? 'disabled style="opacity:0.3;padding:2px 6px;font-size:10px;"' : ''} onclick="moveServerRole(${idx}, 1)">▼</button>
                </div>
                <span class="role-dot" style="background:${r.color}; width:14px; height:14px; flex-shrink:0;"></span>
                <div>
                    <b style="color:${r.color};">${r.name}</b>
                    <div style="font-size:11px; color:#8e9297;">${permTags}</div>
                </div>
            </div>
            <div style="display:flex; gap:5px; flex-shrink:0;">
                <button class="btn-verify" onclick="openEditRoleModal('${r._id}')">Edit</button>
                <button class="btn-del" onclick="deleteServerRole('${r._id}')">Delete</button>
            </div>
        </div>`;
    });

    const memberRolesList = document.getElementById('server-member-roles-list');
    memberRolesList.innerHTML = '';
    window.currentServerMembers.forEach(m => {
        const assigned = getUserServerRoles(m._id);
        const badgesHtml = assigned.map(r => `<span class="badge" style="background:${r.color};">${r.name} <span style="cursor:pointer;margin-left:4px;" onclick="toggleMemberRole('${m._id}', '${r._id}', 'remove')">✕</span></span>`).join('');
        const optionsHtml = window.currentServerRoles.map(r => `<option value="${r._id}">${r.name}</option>`).join('');

        memberRolesList.innerHTML += `<div class="admin-item" style="flex-direction:column; align-items:flex-start;">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <img src="${m.pfp}" style="width:24px;height:24px;border-radius:50%;">
                    <b>${m.username}#${m.discriminator}</b>
                </div>
                ${window.currentServerRoles.length ? `
                <div style="display:flex; gap:4px;">
                    <select id="role-select-${m._id}" style="padding:4px 8px; background:#18191c; color:white; border:none; border-radius:4px; font-size:12px;">${optionsHtml}</select>
                    <button class="btn-manage" onclick="assignSelectedRole('${m._id}')">+ Role</button>
                </div>` : ''}
            </div>
            <div class="badges-container" style="margin-top:4px;">${badgesHtml || '<span style="font-size:11px;color:#72767d;">No roles</span>'}</div>
        </div>`;
    });
}

async function createServerRole() {
    const name = document.getElementById('new-role-name').value.trim();
    const color = document.getElementById('new-role-color').value;
    if (!name) return alert("Enter a role name.");

    const permissions = {
        manageServer: document.getElementById('new-role-perm-server').checked,
        manageChannels: document.getElementById('new-role-perm-channels').checked,
        manageMessages: document.getElementById('new-role-perm-messages').checked,
        viewLockedChannels: document.getElementById('new-role-perm-locked').checked
    };

    await fetch(`${API_URL}/servers/${activeServer._id}/roles`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, permissions })
    });
    document.getElementById('new-role-name').value = '';
    document.getElementById('new-role-perm-server').checked = false;
    document.getElementById('new-role-perm-channels').checked = false;
    document.getElementById('new-role-perm-messages').checked = false;
    document.getElementById('new-role-perm-locked').checked = false;

    await loadServerRolesPane();
    loadMembers(activeServer._id);
}

function openEditRoleModal(roleId) {
    const role = window.currentServerRoles.find(r => r._id === roleId);
    if (!role) return;
    editingRoleId = roleId;
    document.getElementById('edit-role-name').value = role.name;
    document.getElementById('edit-role-color').value = role.color || '#99aab5';
    const p = role.permissions || {};
    document.getElementById('edit-role-perm-server').checked = !!p.manageServer;
    document.getElementById('edit-role-perm-channels').checked = !!p.manageChannels;
    document.getElementById('edit-role-perm-messages').checked = !!p.manageMessages;
    document.getElementById('edit-role-perm-locked').checked = !!p.viewLockedChannels;
    showModal('edit-role-modal');
}

async function saveEditedRole() {
    if (!editingRoleId) return;
    const name = document.getElementById('edit-role-name').value.trim();
    const color = document.getElementById('edit-role-color').value;
    const permissions = {
        manageServer: document.getElementById('edit-role-perm-server').checked,
        manageChannels: document.getElementById('edit-role-perm-channels').checked,
        manageMessages: document.getElementById('edit-role-perm-messages').checked,
        viewLockedChannels: document.getElementById('edit-role-perm-locked').checked
    };
    await fetch(`${API_URL}/servers/${activeServer._id}/roles/${editingRoleId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color, permissions })
    });
    hideModal('edit-role-modal');
    await loadServerRolesPane();
    loadMembers(activeServer._id);
    lastRenderedHash = "";
    loadMessages(false);
}

async function moveServerRole(index, direction) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= window.currentServerRoles.length) return;
    const arr = [...window.currentServerRoles];
    const [moved] = arr.splice(index, 1);
    arr.splice(newIndex, 0, moved);
    const orderedRoleIds = arr.map(r => r._id);

    await fetch(`${API_URL}/servers/${activeServer._id}/roles-reorder`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedRoleIds })
    });
    await loadServerRolesPane();
    loadMembers(activeServer._id);
    lastRenderedHash = "";
    loadMessages(false);
}

async function deleteServerRole(roleId) {
    await fetch(`${API_URL}/servers/${activeServer._id}/roles/${roleId}`, { method: 'DELETE' });
    await loadServerRolesPane();
    loadMembers(activeServer._id);
}

async function assignSelectedRole(userId) {
    const roleId = document.getElementById(`role-select-${userId}`).value;
    if (!roleId) return;
    await toggleMemberRole(userId, roleId, 'add');
}

async function toggleMemberRole(userId, roleId, action) {
    await fetch(`${API_URL}/servers/${activeServer._id}/members/${userId}/roles`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId, action })
    });
    await loadServerRolesPane();
    loadMembers(activeServer._id);
    lastRenderedHash = "";
    loadMessages(false);
}

// --- CHANNEL ACCESS PERMISSIONS ---
async function loadServerChannelPermsPane() {
    if (!activeServer) return;
    const res = await fetch(`${API_URL}/servers/${activeServer._id}/channels`);
    const channels = await res.json();
    const container = document.getElementById('server-channel-perms-list');
    container.innerHTML = '';

    channels.forEach(ch => {
        const rolesCheckboxes = window.currentServerRoles.map(r => {
            const checked = (ch.allowedRoles || []).includes(r._id) ? 'checked' : '';
            return `<label class="checkbox-row" style="font-size:12px;"><input type="checkbox" ${checked} onchange="toggleChannelRoleAccess('${ch._id}', '${r._id}', this.checked)"> <span style="color:${r.color};">${r.name}</span></label>`;
        }).join('');

        container.innerHTML += `<div class="admin-item" style="flex-direction:column; align-items:flex-start;">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                <b># ${ch.name}</b>
                <label class="checkbox-row" style="font-size:12px;">
                    <input type="checkbox" ${ch.isLocked ? 'checked' : ''} onchange="toggleChannelLockState('${ch._id}', this.checked)">
                    <span>Locked Channel</span>
                </label>
            </div>
            ${ch.isLocked ? `<div style="margin-top:6px; width:100%; border-top:1px solid #2f3136; padding-top:6px;">
                <div style="font-size:11px; color:#8e9297; margin-bottom:4px;">Roles allowed to access #${ch.name}:</div>
                <div style="display:flex; flex-wrap:wrap; gap:10px;">${rolesCheckboxes || '<span style="font-size:11px;color:#72767d;">Create roles first to assign channel access.</span>'}</div>
            </div>` : ''}
        </div>`;
    });
}

async function toggleChannelLockState(channelId, isLocked) {
    await fetch(`${API_URL}/channels/${channelId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked })
    });
    loadServerChannelPermsPane();
    loadChannels(activeServer._id);
}

async function toggleChannelRoleAccess(channelId, roleId, allowed) {
    const res = await fetch(`${API_URL}/servers/${activeServer._id}/channels`);
    const channels = await res.json();
    const ch = channels.find(c => c._id === channelId);
    if (!ch) return;

    let updated = ch.allowedRoles || [];
    if (allowed && !updated.includes(roleId)) updated.push(roleId);
    if (!allowed) updated = updated.filter(id => id !== roleId);

    await fetch(`${API_URL}/channels/${channelId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedRoles: updated })
    });
    loadChannels(activeServer._id);
}

function openCreateChannelModal() {
    document.getElementById('new-channel-name').value = '';
    document.getElementById('new-channel-topic').value = '';
    document.getElementById('new-channel-locked').checked = false;
    document.getElementById('new-channel-roles-box').classList.add('hidden');

    const rolesList = document.getElementById('new-channel-roles-list');
    rolesList.innerHTML = window.currentServerRoles.map(r =>
        `<label class="checkbox-row" style="font-size:13px;"><input type="checkbox" class="new-ch-role-cb" value="${r._id}"> <span style="color:${r.color};">${r.name}</span></label>`
    ).join('') || '<span style="font-size:12px;color:#72767d;">No roles created yet.</span>';

    showModal('channel-modal');
}

async function saveProfile() {
    if (realAdminUser) return alert("Cannot save changes in Read-Only Impersonation Mode.");
    const pfpFile = document.getElementById('upload-pfp').files[0];
    const bannerFile = document.getElementById('upload-banner').files[0];
    let pfpData = currentUser.pfp;
    let bannerData = currentUser.banner;
    if (pfpFile) pfpData = await toBase64(pfpFile);
    if (bannerFile) bannerData = await toBase64(bannerFile);

    const updates = {
        pfp: pfpData,
        banner: bannerData,
        avatarDecoration: selectedUserDecoration,
        bio: document.getElementById('set-bio').value,
        activity: document.getElementById('set-activity').value,
        customStatus: document.getElementById('set-custom-status').value
    };
    const res = await fetch(`${API_URL}/users/${currentUser._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
    if (!res.ok) {
        const err = await res.json();
        return alert(err.error || "Failed to update profile.");
    }
    currentUser = await res.json();
    localStorage.setItem('scene_user', JSON.stringify(currentUser));
    updateUserPanel();
    closeSettings();
    lastRenderedHash = "";
    loadMessages(false);
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

    const cfgRes = await fetch(`${API_URL}/config`);
    const cfg = await cfgRes.json();
    globalConfig = cfg;
    document.getElementById('cfg-maintenance').checked = cfg.maintenanceMode || false;
    document.getElementById('cfg-emojis').checked = cfg.allowEmojis !== false;
    document.getElementById('cfg-mentions').checked = cfg.allowMentions !== false;
    document.getElementById('cfg-nonadmin-decorations').checked = cfg.allowNonAdminDecorations !== false;
    document.getElementById('cfg-rate-count').value = cfg.rateLimitCount || 15;
    document.getElementById('cfg-rate-window').value = cfg.rateLimitWindowSec || 10;

    document.getElementById('cfg-welcome-enabled').checked = cfg.autoWelcomeEnabled !== false;
    document.getElementById('cfg-welcome-msg').value = cfg.autoWelcomeMsg || '';
    document.getElementById('cfg-changelog-ver').value = cfg.changelogVersion || '';
    document.getElementById('cfg-changelog-text').value = cfg.changelogText || '';
    document.getElementById('cfg-tos-text').value = cfg.tosText || '';

    const decList = document.getElementById('admin-decoration-list');
    decList.innerHTML = '';
    (cfg.avatarDecorations || []).forEach(dec => {
        decList.innerHTML += `<div class="decoration-card">
            <button class="del-dec" onclick="deleteAvatarDecoration('${dec._id}')" title="Delete">✕</button>
            <div class="avatar-wrapper" style="width:44px;height:44px;">
                <img src="${currentUser.pfp}" class="avatar" style="width:44px;height:44px;">
                <img src="${dec.image}" class="avatar-decoration">
            </div>
            <span>${dec.name}</span>
        </div>`;
    });

    const bList = document.getElementById('badge-studio-list');
    bList.innerHTML = '';
    (cfg.customBadges || []).forEach(b => {
        bList.innerHTML += `<span class="badge" style="background:${b.color}; font-size:12px; padding:4px 8px;">${b.icon} ${b.name}</span>`;
    });

    const chRes = await fetch(`${API_URL}/admin/all-channels`);
    const channels = await chRes.json();
    const chSelect = document.getElementById('sys-msg-channel');
    chSelect.innerHTML = '';
    channels.forEach(c => {
        const srvName = c.serverId ? c.serverId.name : 'Unknown Server';
        chSelect.innerHTML += `<option value="${c._id}">[${srvName}] #${c.name}</option>`;
    });

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

async function uploadAvatarDecoration() {
    const name = document.getElementById('new-decoration-name').value.trim();
    const file = document.getElementById('new-decoration-file').files[0];
    if (!name || !file) return alert("Enter a decoration name and select an image file.");

    const image = await toBase64(file);
    await fetch(`${API_URL}/admin/decorations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image, adminName: currentUser.username })
    });
    document.getElementById('new-decoration-name').value = '';
    document.getElementById('new-decoration-file').value = '';
    loadAdminPanel();
}

async function deleteAvatarDecoration(decId) {
    await fetch(`${API_URL}/admin/decorations/${decId}?adminName=${encodeURIComponent(currentUser.username)}`, { method: 'DELETE' });
    loadAdminPanel();
}

async function toggleNonAdminDecorations() {
    const allowNonAdminDecorations = document.getElementById('cfg-nonadmin-decorations').checked;
    await fetch(`${API_URL}/admin/config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowNonAdminDecorations, adminName: currentUser.username })
    });
    globalConfig.allowNonAdminDecorations = allowNonAdminDecorations;
    lastRenderedHash = "";
    loadMessages(false);
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

    const bSelect = document.getElementById('adm-u-badge-select');
    bSelect.innerHTML = '';
    (globalConfig.customBadges || []).forEach(b => {
        bSelect.innerHTML += `<option value="${b.name}">${b.icon} ${b.name}</option>`;
    });

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

    const viewDec = document.getElementById('view-decoration');
    const effDec = getEffectiveDecoration(user);
    if (effDec) {
        viewDec.src = effDec;
        viewDec.classList.remove('hidden');
    } else {
        viewDec.classList.add('hidden');
    }

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

    const rolesSection = document.getElementById('view-roles-section');
    const rolesContainer = document.getElementById('view-roles');
    const userRoles = getUserServerRoles(userId);
    if (activeServer && userRoles.length > 0) {
        rolesSection.classList.remove('hidden');
        rolesContainer.innerHTML = userRoles.map(r => `<span class="badge" style="background:#202225; border:1px solid ${r.color};"><span class="role-dot" style="background:${r.color};"></span>${r.name}</span>`).join('');
    } else {
        rolesSection.classList.add('hidden');
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
    if (y + 420 > window.innerHeight) y = window.innerHeight - 440;

    modal.style.left = x + 'px';
    modal.style.top = y + 'px';
}

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
    window.currentServerRoles = [];
    window.currentServerMemberRoles = [];
    document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
    document.querySelector('.home-icon').classList.add('active');
    document.getElementById('sidebar-title').innerText = "Direct Messages";
    document.getElementById('chat-header-icon').innerText = "@";

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
        const effDec = getEffectiveDecoration(f);
        const decHtml = effDec ? `<img src="${effDec}" class="avatar-decoration">` : '';
        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.targetId = dm._id;
        div.dataset.dm = "true";
        div.innerHTML = `<div class="avatar-wrapper"><img src="${f.pfp}" class="avatar" style="width:24px;height:24px;">${decHtml}<div class="status-dot ${f.activity}" style="width:8px;height:8px;bottom:0;right:0;"></div></div> <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.username}</span> ${f.isVerified ? verifiedSVG : ''}`;
        div.onclick = (e) => {
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectChat(dm._id, f.username, "", "@");
        };
        list.appendChild(div);

        if (!firstFriendDiv) firstFriendDiv = div;
    });

    applyUnreadBadgesToUI();

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
        const div = document.createElement('div');
        div.className = 'server-icon';
        div.dataset.serverId = s._id;
        if (activeServer && activeServer._id === s._id) div.classList.add('active');
        if (s.icon) div.style.backgroundImage = `url(${s.icon})`; else div.innerText = s.name.charAt(0).toUpperCase();
        div.onclick = (e) => {
            document.querySelectorAll('.server-icon').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectServer(s);
        };
        container.appendChild(div);
    });
    applyUnreadBadgesToUI();
}

async function selectServer(server) {
    activeServer = server;
    document.getElementById('sidebar-title').innerHTML = `${server.name} ${server.isVerified ? verifiedSVG : ''}`;
    document.getElementById('add-friend-btn').classList.add('hidden');
    document.getElementById('member-list').classList.remove('hidden');

    await loadMembers(server._id);

    const perms = getMyServerPermissions();
    document.getElementById('add-channel-btn').classList.toggle('hidden', !perms.manageChannels);
    document.getElementById('server-settings-btn').classList.toggle('hidden', !perms.manageServer);

    loadChannels(server._id);
    applyUnreadBadgesToUI();
}

// RIGHT CLICK CONTEXT MENU
let contextTargetId = null;
function showContextMenu(e, id, type) {
    e.preventDefault();
    e.stopPropagation();
    const perms = getMyServerPermissions();
    if (activeServer && perms.manageChannels) {
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

    const perms = getMyServerPermissions();
    const myRoles = getUserServerRoles(currentUser._id).map(r => r._id);

    let firstAllowedChannel = null;

    channels.forEach((c) => {
        const hasRoleAccess = (c.allowedRoles || []).some(rid => myRoles.includes(rid));
        const isAllowed = !c.isLocked
            || c.allowedMembers?.includes(currentUser._id)
            || hasRoleAccess
            || perms.viewLockedChannels;

        const lockIcon = c.isLocked ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#72767d" stroke-width="2" style="margin-left:auto; flex-shrink:0;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>` : '';

        const div = document.createElement('div');
        div.className = 'list-item';
        div.dataset.targetId = c._id;
        div.innerHTML = `<span class="channel-hash">#</span> <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name}</span> ${lockIcon}`;

        div.addEventListener('contextmenu', (e) => showContextMenu(e, c._id, 'channel'));

        div.onclick = (e) => {
            if (!isAllowed) return alert("You don't have the required role to view this locked channel.");
            document.querySelectorAll('.list-item').forEach(el => el.classList.remove('active'));
            e.currentTarget.classList.add('active');
            selectChat(c._id, c.name, c.topic, "#");
        };
        list.appendChild(div);

        if (isAllowed && !firstAllowedChannel) firstAllowedChannel = { c, div };
    });

    applyUnreadBadgesToUI();

    if (firstAllowedChannel) {
        firstAllowedChannel.div.classList.add('active');
        selectChat(firstAllowedChannel.c._id, firstAllowedChannel.c.name, firstAllowedChannel.c.topic, "#");
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
    const data = await res.json();
    window.currentServerMembers = data.members || [];
    window.currentServerRoles = data.roles || [];
    window.currentServerMemberRoles = data.memberRoles || [];

    const container = document.getElementById('members-container');
    container.innerHTML = '';

    const grouped = {};
    const noRoleMembers = [];

    window.currentServerMembers.forEach(m => {
        window.userCache[m._id] = m;
        const roles = getUserServerRoles(m._id);
        if (roles.length > 0) {
            const topRole = roles[0];
            if (!grouped[topRole._id]) grouped[topRole._id] = { role: topRole, members: [] };
            grouped[topRole._id].members.push({ member: m, topRole });
        } else {
            noRoleMembers.push({ member: m, topRole: null });
        }
    });

    const renderMemberGroup = (title, color, list) => {
        if (!list.length) return;
        const header = document.createElement('h3');
        header.className = 'member-role';
        if (color) header.style.color = color;
        header.innerText = `${title} — ${list.length}`;
        container.appendChild(header);

        list.forEach(({ member: m, topRole }) => {
            const effDec = getEffectiveDecoration(m);
            const decHtml = effDec ? `<img src="${effDec}" class="avatar-decoration">` : '';
            const nameColor = topRole ? `style="color:${topRole.color};"` : '';
            const div = document.createElement('div');
            div.className = 'member-item';
            div.innerHTML = `<div class="avatar-wrapper"><img src="${m.pfp}" class="avatar" style="width:28px;height:28px;">${decHtml}<div class="status-dot ${m.activity}" style="width:10px;height:10px;"></div></div> <span class="username" ${nameColor}>${m.username}</span>`;
            div.onclick = (e) => showUserProfile(e, m._id);
            container.appendChild(div);
        });
    };

    window.currentServerRoles.forEach(r => {
        if (grouped[r._id]) renderMemberGroup(r.name, r.color, grouped[r._id].members);
    });
    renderMemberGroup('Members', null, noRoleMembers);
}

// --- MESSAGES, TYPING POLLING & @MENTION HIGHLIGHTING ---
function selectChat(targetId, chatName, topic = "", headerIcon = "#") {
    if (currentTargetId === targetId) return;

    currentTargetId = targetId;
    lastRenderedHash = "";
    document.getElementById('chat-header-icon').innerText = headerIcon;
    document.getElementById('current-chat-name').innerText = chatName;
    document.getElementById('current-chat-topic').innerText = topic;
    document.getElementById('typing-indicator').classList.add('hidden');

    markTargetAsRead(targetId);

    const msgInput = document.getElementById('message-input');
    if (realAdminUser) {
        msgInput.disabled = true;
        msgInput.placeholder = "Read-only impersonation mode...";
    } else {
        msgInput.disabled = false;
        msgInput.placeholder = `Message ${headerIcon === '#' ? '#' + chatName : '@' + chatName}`;
    }
    cancelReply();

    document.getElementById('messages-container').innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#72767d;">Loading messages...</div>`;

    if (messageInterval) clearInterval(messageInterval);
    loadMessages(true);
    pollTypingUsers();
    messageInterval = setInterval(() => {
        loadMessages(false);
        pollTypingUsers();
    }, 600);
}

async function pollTypingUsers() {
    if (!currentTargetId) return;
    try {
        const res = await fetch(`${API_URL}/typing/${currentTargetId}`);
        if (!res.ok) return;
        const typers = await res.json();
        const others = typers.filter(t => t.userId !== currentUser._id);
        const indicator = document.getElementById('typing-indicator');
        const textEl = document.getElementById('typing-text');

        if (others.length === 0) {
            indicator.classList.add('hidden');
        } else if (others.length === 1) {
            textEl.innerHTML = `<b>${others[0].username}</b> is typing...`;
            indicator.classList.remove('hidden');
        } else if (others.length === 2) {
            textEl.innerHTML = `<b>${others[0].username}</b> and <b>${others[1].username}</b> are typing...`;
            indicator.classList.remove('hidden');
        } else {
            textEl.innerHTML = `<b>Several people</b> are typing...`;
            indicator.classList.remove('hidden');
        }
    } catch (e) {}
}

function sendTypingSignal() {
    if (!currentTargetId || !currentUser || realAdminUser) return;
    const now = Date.now();
    if (now - lastTypingSentAt < 2000) return;
    lastTypingSentAt = now;
    fetch(`${API_URL}/typing/${currentTargetId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser._id, username: currentUser.username })
    }).catch(() => {});
}

function initReply(msgId, username) {
    if (realAdminUser) return;
    replyingToId = msgId;
    document.getElementById('reply-banner').classList.remove('hidden');
    document.getElementById('reply-user').innerText = `@${username}`;
    document.getElementById('message-input').focus();
}
function cancelReply() { replyingToId = null; document.getElementById('reply-banner').classList.add('hidden'); }

async function deleteMsg(id) {
    await fetch(`${API_URL}/messages/${id}?userId=${currentUser._id}`, { method: 'DELETE' });
    loadMessages(false);
}
async function editMsg(id) {
    const newContent = prompt("Edit message:");
    if (newContent) {
        await fetch(`${API_URL}/messages/edit/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: newContent }) });
        loadMessages(false);
    }
}

function buildMessageElement(msg, isOptimistic = false) {
    const author = msg.authorId;
    const time = new Date(msg.timestamp || Date.now()).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    const myNameEscaped = currentUser.username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const meMentionRegex = new RegExp(`@${myNameEscaped}\\b`, 'i');
    const isMentionedMe = globalConfig.allowMentions !== false && meMentionRegex.test(msg.content);

    let safeContent = msg.content.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (globalConfig.allowMentions !== false) {
        safeContent = safeContent.replace(/@(\w+)/g, (full, uname) => {
            const isMe = uname.toLowerCase() === currentUser.username.toLowerCase();
            return `<span class="mention ${isMe ? 'me-mention' : ''}">@${uname}</span>`;
        });
    }

    const div = document.createElement('div');
    div.className = 'message-wrapper';
    if (isOptimistic) div.style.opacity = '0.85';

    let replyHtml = '';
    if (msg.replyTo && msg.replyTo.authorId) {
        replyHtml = `<div class="reply-context"><img src="${msg.replyTo.authorId.pfp || ''}" style="width:16px;height:16px;border-radius:50%;"><span class="rep-user">@${msg.replyTo.authorId.username}</span> ${msg.replyTo.content.substring(0, 40)}...</div>`;
    }

    const perms = getMyServerPermissions();
    const canDelete = author._id.toString() === currentUser._id.toString() || currentUser.isAdmin || perms.manageMessages;
    const canEdit = author._id.toString() === currentUser._id.toString() || currentUser.isAdmin;

    let actionHtml = '';
    if (!realAdminUser && !isOptimistic) {
        actionHtml = `<div class="message-actions"><button onclick="initReply('${msg._id}', '${author.username}')" title="Reply"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 0 0-4-4H4"></path></svg></button>`;
        if (canEdit) {
            actionHtml += `<button onclick="editMsg('${msg._id}')" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>`;
        }
        if (canDelete) {
            actionHtml += `<button class="del" onclick="deleteMsg('${msg._id}')" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`;
        }
        actionHtml += `</div>`;
    }

    const sysBadge = msg.isSystem ? `<span class="system-tag">SYSTEM</span>` : '';
    const effDec = getEffectiveDecoration(author);
    const decHtml = effDec ? `<img src="${effDec}" class="avatar-decoration">` : '';

    const userRoles = getUserServerRoles(author._id);
    const nameColor = userRoles.length > 0 ? `style="color:${userRoles[0].color};"` : '';

    div.innerHTML = `
        ${replyHtml}
        <div class="message ${msg.isSystem ? 'system-msg' : ''} ${isMentionedMe ? 'mentioned-msg' : ''}">
            <div class="avatar-wrapper" style="width:40px;height:40px;" onclick="showUserProfile(event, '${author._id}')">
                <img src="${author.pfp}" class="avatar">
                ${decHtml}
            </div>
            <div style="flex:1;">
                <div class="message-header">
                    <span class="username" ${nameColor} onclick="showUserProfile(event, '${author._id}')">${author.username} ${author.isVerified ? verifiedSVG : ''}</span>
                    ${sysBadge}
                    <span class="timestamp">${time}</span>
                </div>
                <div class="text">${safeContent} ${msg.isEdited ? '<span class="is-edited">(edited)</span>' : ''}</div>
            </div>
            ${actionHtml}
        </div>
    `;
    return div;
}

async function loadMessages(forceScroll = false) {
    if (!currentTargetId) return;
    const requestedTargetId = currentTargetId;

    try {
        const res = await fetch(`${API_URL}/messages/${requestedTargetId}`);
        if (!res.ok) throw new Error("Failed to fetch messages");
        const messages = await res.json();

        if (currentTargetId !== requestedTargetId) return;

        const currentHash = `${requestedTargetId}:` + messages.map(m => `${m._id}-${m.content}-${m.isEdited}-${m.authorId?.avatarDecoration || ''}`).join('|');
        if (!forceScroll && currentHash === lastRenderedHash) return;
        lastRenderedHash = currentHash;

        markTargetAsRead(requestedTargetId);

        const container = document.getElementById('messages-container');
        const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;

        container.innerHTML = '';
        messages.forEach(msg => {
            if (!msg.authorId) return;
            window.userCache[msg.authorId._id] = msg.authorId;
            container.appendChild(buildMessageElement(msg, false));
        });
        if (isAtBottom || forceScroll) container.scrollTop = container.scrollHeight;
    } catch (err) {
        console.error("Failed to load messages:", err);
        if (forceScroll && currentTargetId === requestedTargetId) {
            document.getElementById('messages-container').innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#ed4245;">Failed to load messages.</div>`;
        }
    }
}

// EMOJI, TYPING & MENTION LOGIC
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
    const val = e.target.value;
    if (val.trim().length > 0) {
        sendTypingSignal();
    }

    if (globalConfig.allowMentions === false) return;
    const match = val.match(/@(\w*)$/);
    const popup = document.getElementById('mention-suggestions');

    if (match) {
        const query = match[1].toLowerCase();
        const pool = activeServer ? window.currentServerMembers : Object.values(window.userCache);
        const filtered = pool.filter(m => m.username && m.username.toLowerCase().startsWith(query));

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

// INSTANT ZERO-DELAY MESSAGE SEND
document.getElementById('message-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (realAdminUser) return;
    const input = document.getElementById('message-input');
    const content = input.value;
    if (!content.trim() || !currentTargetId) return;

    const target = currentTargetId;
    const replyId = replyingToId;
    input.value = '';
    cancelReply();
    lastTypingSentAt = 0;

    const container = document.getElementById('messages-container');
    if (container.innerText === 'Loading messages...') container.innerHTML = '';
    const optimisticEl = buildMessageElement({
        content,
        authorId: currentUser,
        timestamp: new Date()
    }, true);
    container.appendChild(optimisticEl);
    container.scrollTop = container.scrollHeight;

    const res = await fetch(`${API_URL}/messages/${target}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, userId: currentUser._id, replyTo: replyId })
    });

    if (!res.ok) {
        optimisticEl.remove();
        const err = await res.json();
        alert(err.error || "Failed to send message.");
    } else {
        markTargetAsRead(target);
        loadMessages(true);
    }
});

// Modals
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }
async function addFriend() { await fetch(`${API_URL}/friends/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentUserId: currentUser._id, friendTag: document.getElementById('friend-tag').value }) }); hideModal('friend-modal'); goHome(); }
async function createServer() { await fetch(`${API_URL}/servers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('new-server-name').value, userId: currentUser._id }) }); hideModal('server-modal'); loadServers(); }

async function createChannel() {
    const isLocked = document.getElementById('new-channel-locked').checked;
    const allowedRoles = isLocked
        ? Array.from(document.querySelectorAll('.new-ch-role-cb:checked')).map(cb => cb.value)
        : [];

    const res = await fetch(`${API_URL}/servers/${activeServer._id}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.getElementById('new-channel-name').value,
            topic: document.getElementById('new-channel-topic').value,
            isLocked: isLocked,
            allowedRoles: allowedRoles,
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
