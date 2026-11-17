const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));

const mongoURI = "mongodb+srv://27johnballenger2_db_user:hm398KIfJh0lX98E@cluster0.nkbek9a.mongodb.net/scene_db?retryWrites=true&w=majority";

// --- SERVERLESS-SAFE MONGODB CONNECTION CACHE ---
let cachedConn = null;
let systemInitialized = false;

async function connectDB() {
    if (cachedConn && mongoose.connection.readyState === 1) {
        return cachedConn;
    }
    cachedConn = await mongoose.connect(mongoURI);
    if (!systemInitialized) {
        systemInitialized = true;
        await initSystem();
    }
    return cachedConn;
}

// Ensure DB is connected before any /api route executes
app.use('/api', async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('MongoDB connection error:', err);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// --- SCHEMAS ---
const User = mongoose.models.User || mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true },
    discriminator: { type: String, required: true },
    password: { type: String, required: true },
    pfp: { type: String, default: 'https://ui-avatars.com/api/?name=U&background=5865F2&color=fff' },
    avatarDecoration: { type: String, default: '' },
    banner: { type: String, default: '#36393f' },
    bio: { type: String, default: "I'm new to Scene!" },
    activity: { type: String, default: 'online' },
    customStatus: { type: String, default: '' },
    badges: { type: [String], default: ['Early Supporter'] },
    isAdmin: { type: Boolean, default: false },
    isVerified: { type: Boolean, default: false },
    isSystemBot: { type: Boolean, default: false },
    suspendedUntil: { type: Date, default: null },
    pendingWarning: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Server = mongoose.models.Server || mongoose.model('Server', new mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    inviteCode: { type: String, unique: true },
    isVerified: { type: Boolean, default: false },
    isQuarantined: { type: Boolean, default: false },
    maxChannels: { type: Number, default: 50 },
    roles: [{
        name: { type: String, required: true },
        color: { type: String, default: '#99aab5' },
        permissions: {
            manageServer: { type: Boolean, default: false },
            manageChannels: { type: Boolean, default: false },
            manageMessages: { type: Boolean, default: false },
            viewLockedChannels: { type: Boolean, default: false }
        }
    }],
    memberRoles: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        roleIds: [String]
    }]
}));

const Channel = mongoose.models.Channel || mongoose.model('Channel', new mongoose.Schema({
    name: { type: String, required: true },
    topic: { type: String, default: '' },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Server' },
    isLocked: { type: Boolean, default: false },
    allowedMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    allowedRoles: [String]
}));

const DM = mongoose.models.DM || mongoose.model('DM', new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Message = mongoose.models.Message || mongoose.model('Message', new mongoose.Schema({
    content: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    isEdited: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
}));

const SystemConfig = mongoose.models.SystemConfig || mongoose.model('SystemConfig', new mongoose.Schema({
    key: { type: String, default: 'global', unique: true },
    maintenanceMode: { type: Boolean, default: false },
    allowEmojis: { type: Boolean, default: true },
    allowMentions: { type: Boolean, default: true },
    allowNonAdminDecorations: { type: Boolean, default: true },
    avatarDecorations: [{ name: String, image: String }],
    rateLimitCount: { type: Number, default: 15 },
    rateLimitWindowSec: { type: Number, default: 10 },
    changelogText: { type: String, default: 'Welcome to Scene! Check out our latest updates.' },
    changelogVersion: { type: String, default: 'v1.0' },
    tosText: { type: String, default: '1. Be respectful.\n2. No spamming.\n3. Follow community guidelines.' },
    autoWelcomeEnabled: { type: Boolean, default: true },
    autoWelcomeMsg: { type: String, default: 'Welcome to Scene! Let us know if you need any help.' },
    customBadges: [{ name: String, color: String, icon: String }]
}));

const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject: String,
    message: String,
    reply: { type: String, default: '' },
    status: { type: String, default: 'Open' },
    createdAt: { type: Date, default: Date.now }
}));

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', new mongoose.Schema({
    adminName: String,
    action: String,
    target: String,
    timestamp: { type: Date, default: Date.now }
}));

// --- INITIALIZE SYSTEM CONFIG & OFFICIAL BOT ---
async function initSystem() {
    let cfg = await SystemConfig.findOne({ key: 'global' });
    if (!cfg) {
        cfg = await new SystemConfig({
            customBadges: [
                { name: 'Early Supporter', color: '#5865F2', icon: '★' },
                { name: 'Staff', color: '#ed4245', icon: '🛡️' },
                { name: 'Bug Hunter', color: '#43b581', icon: '🐛' }
            ]
        }).save();
    }
    let bot = await User.findOne({ username: 'Scene', discriminator: '0000' });
    if (!bot) {
        const hashedPassword = await bcrypt.hash(Math.random().toString(36), 10);
        bot = await new User({
            username: 'Scene',
            discriminator: '0000',
            password: hashedPassword,
            pfp: 'https://ui-avatars.com/api/?name=Scene&background=faa61a&color=000',
            bio: 'Official Scene System Bot',
            badges: ['Official Bot', 'Staff'],
            isAdmin: true,
            isVerified: true,
            isSystemBot: true
        }).save();
    }
}

async function logAdmin(adminName, action, target) {
    await new AuditLog({ adminName: adminName || 'Admin', action, target }).save();
}

const userMessageTimestamps = {};
const typingState = {};

function getMemberServerPerms(server, user) {
    const perms = {
        manageServer: false,
        manageChannels: false,
        manageMessages: false,
        viewLockedChannels: false
    };
    if (!server || !user) return perms;
    if (server.ownerId?.toString() === user._id.toString() || user.isAdmin) {
        return { manageServer: true, manageChannels: true, manageMessages: true, viewLockedChannels: true };
    }
    const entry = (server.memberRoles || []).find(mr => mr.userId.toString() === user._id.toString());
    if (!entry) return perms;
    for (const rid of entry.roleIds) {
        const role = (server.roles || []).find(r => r._id.toString() === rid);
        if (role && role.permissions) {
            if (role.permissions.manageServer) perms.manageServer = true;
            if (role.permissions.manageChannels) perms.manageChannels = true;
            if (role.permissions.manageMessages) perms.manageMessages = true;
            if (role.permissions.viewLockedChannels) perms.viewLockedChannels = true;
        }
    }
    return perms;
}

// --- PUBLIC CONFIG & HEARTBEAT ---
app.get('/api/config', async (req, res) => {
    const cfg = await SystemConfig.findOne({ key: 'global' });
    res.json(cfg || {});
});

app.post('/api/heartbeat/:userId', async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.userId)) {
        return res.status(400).json({ error: 'Invalid user ID' });
    }
    const user = await User.findByIdAndUpdate(req.params.userId, { lastActive: new Date() }, { new: true });
    const cfg = await SystemConfig.findOne({ key: 'global' });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (cfg && cfg.allowNonAdminDecorations === false && !user.isAdmin && user.avatarDecoration) {
        user.avatarDecoration = '';
        await user.save();
    }

    const warning = user.pendingWarning;
    if (warning) {
        user.pendingWarning = '';
        await user.save();
    }
    res.json({
        user,
        warning,
        maintenanceMode: cfg?.maintenanceMode || false,
        config: cfg || {}
    });
});

// --- TYPING INDICATORS ---
app.post('/api/typing/:targetId', (req, res) => {
    const { userId, username } = req.body;
    if (!typingState[req.params.targetId]) typingState[req.params.targetId] = {};
    typingState[req.params.targetId][userId] = {
        username,
        expiresAt: Date.now() + 3500
    };
    res.json({ success: true });
});

app.get('/api/typing/:targetId', (req, res) => {
    const now = Date.now();
    const room = typingState[req.params.targetId] || {};
    const active = [];
    for (const [uid, info] of Object.entries(room)) {
        if (info.expiresAt > now) {
            active.push({ userId: uid, username: info.username });
        } else {
            delete room[uid];
        }
    }
    res.json(active);
});

// --- UNREAD & PING TRACKER ---
app.post('/api/unread-summary', async (req, res) => {
    const { userId, username, lastReadMap } = req.body;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        return res.json({ targets: {}, servers: {} });
    }
    const readMap = lastReadMap || {};
    const regex = username ? new RegExp(`@${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;

    const servers = await Server.find({ members: userId });
    const dms = await DM.find({ participants: userId });
    const serverIds = servers.map(s => s._id);
    const channels = await Channel.find({ serverId: { $in: serverIds } });

    const targets = [
        ...channels.map(c => ({ id: c._id.toString(), serverId: c.serverId.toString() })),
        ...dms.map(d => ({ id: d._id.toString(), serverId: null }))
    ];

    const targetStatus = {};
    const serverStatus = {};

    await Promise.all(targets.map(async t => {
        const since = readMap[t.id] ? new Date(readMap[t.id]) : new Date(0);
        const unreadMsgs = await Message.find({
            targetId: t.id,
            authorId: { $ne: userId },
            timestamp: { $gt: since }
        }, 'content');

        const hasUnread = unreadMsgs.length > 0;
        let pingCount = 0;
        if (regex && hasUnread) {
            unreadMsgs.forEach(m => {
                if (regex.test(m.content)) pingCount++;
            });
        }

        targetStatus[t.id] = { hasUnread, pingCount };
        if (t.serverId) {
            if (!serverStatus[t.serverId]) serverStatus[t.serverId] = { hasUnread: false, pingCount: 0 };
            if (hasUnread) serverStatus[t.serverId].hasUnread = true;
            serverStatus[t.serverId].pingCount += pingCount;
        }
    }));

    res.json({ targets: targetStatus, servers: serverStatus });
});

// --- AUTH ---
app.post('/api/register', async (req, res) => {
    const cfg = await SystemConfig.findOne({ key: 'global' });
    if (cfg && cfg.maintenanceMode) return res.status(503).json({ error: "Scene is currently in Maintenance Mode." });

    const { username, password } = req.body;
    let discriminator = Math.floor(1000 + Math.random() * 9000).toString();
    while (await User.findOne({ username, discriminator })) {
        discriminator = Math.floor(1000 + Math.random() * 9000).toString();
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const pfp = `https://ui-avatars.com/api/?name=${username}&background=5865F2&color=fff`;
    const isAdmin = (username === "Die" && discriminator === "4252");

    const user = new User({ username, discriminator, password: hashedPassword, pfp, isAdmin });
    await user.save();

    if (cfg && cfg.autoWelcomeEnabled) {
        const bot = await User.findOne({ username: 'Scene', discriminator: '0000' });
        if (bot) {
            await User.findByIdAndUpdate(user._id, { $addToSet: { friends: bot._id } });
            const dm = await new DM({ participants: [bot._id, user._id] }).save();
            await new Message({
                content: cfg.autoWelcomeMsg,
                authorId: bot._id,
                targetId: dm._id,
                isSystem: true
            }).save();
        }
    }

    res.json(user);
});

app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.username === "Die" && user.discriminator === "4252" && !user.isAdmin) {
        user.isAdmin = true;
        await user.save();
    }

    const cfg = await SystemConfig.findOne({ key: 'global' });
    if (cfg && cfg.maintenanceMode && !user.isAdmin) {
        return res.status(503).json({ error: "Maintenance Mode is active. Only admins can log in right now." });
    }

    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
        return res.status(403).json({ error: `Account suspended until ${new Date(user.suspendedUntil).toLocaleString()}` });
    }

    user.lastActive = new Date();
    await user.save();
    res.json(user);
});

// --- USERS & FRIENDS ---
app.put('/api/users/:id', async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const cfg = await SystemConfig.findOne({ key: 'global' });
    if (req.body.avatarDecoration && cfg && cfg.allowNonAdminDecorations === false && !user.isAdmin) {
        return res.status(403).json({ error: 'Avatar decorations are currently disabled for non-admins.' });
    }

    res.json(await User.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});

app.get('/api/users/:id/friends', async (req, res) => {
    const user = await User.findById(req.params.id).populate('friends', 'username discriminator pfp avatarDecoration activity customStatus isVerified isAdmin badges bio banner');
    const dms = await DM.find({ participants: req.params.id });
    res.json({ friends: user ? user.friends : [], dms });
});

app.post('/api/friends/add', async (req, res) => {
    const { currentUserId, friendTag } = req.body;
    if (!friendTag.includes('#')) return res.status(400).json({ error: "Need #0000 format" });
    const [name, disc] = friendTag.split('#');
    const friend = await User.findOne({ username: name, discriminator: disc });
    if (!friend) return res.status(404).json({ error: "User not found!" });
    await User.findByIdAndUpdate(currentUserId, { $addToSet: { friends: friend._id } });
    await User.findByIdAndUpdate(friend._id, { $addToSet: { friends: currentUserId } });
    if (!await DM.findOne({ participants: { $all: [currentUserId, friend._id] } })) {
        await new DM({ participants: [currentUserId, friend._id] }).save();
    }
    res.json({ success: true });
});

// --- SUPPORT TICKETS ---
app.post('/api/tickets', async (req, res) => {
    const ticket = await new Ticket({
        userId: req.body.userId,
        subject: req.body.subject,
        message: req.body.message
    }).save();
    res.json(ticket);
});
app.get('/api/tickets/user/:userId', async (req, res) => {
    res.json(await Ticket.find({ userId: req.params.userId }).sort({ createdAt: -1 }));
});

// --- SERVERS, ROLES & CHANNELS ---
app.get('/api/servers/user/:userId', async (req, res) => res.json(await Server.find({ members: req.params.userId })));
app.post('/api/servers', async (req, res) => {
    const server = new Server({
        name: req.body.name,
        ownerId: req.body.userId,
        members: [req.body.userId],
        inviteCode: Math.random().toString(36).substring(2, 8),
        roles: []
    });
    await server.save();
    await new Channel({ name: 'general', topic: 'General chat', serverId: server._id }).save();
    res.json(server);
});
app.put('/api/servers/:id', async (req, res) => res.json(await Server.findByIdAndUpdate(req.params.id, req.body, { new: true })));
app.delete('/api/servers/:id', async (req, res) => {
    await Server.findByIdAndDelete(req.params.id);
    await Channel.deleteMany({ serverId: req.params.id });
    res.json({ success: true });
});
app.post('/api/servers/join/:code', async (req, res) => {
    const server = await Server.findOneAndUpdate({ inviteCode: req.params.code }, { $addToSet: { members: req.body.userId } }, { new: true });
    if (!server) return res.status(404).json({ error: "Invalid code" });
    res.json(server);
});

app.post('/api/servers/:serverId/roles', async (req, res) => {
    const { name, color, permissions } = req.body;
    const server = await Server.findByIdAndUpdate(
        req.params.serverId,
        {
            $push: {
                roles: {
                    name,
                    color: color || '#99aab5',
                    permissions: permissions || {
                        manageServer: false,
                        manageChannels: false,
                        manageMessages: false,
                        viewLockedChannels: false
                    }
                }
            }
        },
        { new: true }
    );
    res.json(server);
});

app.put('/api/servers/:serverId/roles/:roleId', async (req, res) => {
    const { name, color, permissions } = req.body;
    const server = await Server.findById(req.params.serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    const role = server.roles.id(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    if (name !== undefined) role.name = name;
    if (color !== undefined) role.color = color;
    if (permissions !== undefined) role.permissions = permissions;

    await server.save();
    res.json(server);
});

app.put('/api/servers/:serverId/roles-reorder', async (req, res) => {
    const { orderedRoleIds } = req.body;
    const server = await Server.findById(req.params.serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    const roleMap = {};
    server.roles.forEach(r => { roleMap[r._id.toString()] = r; });

    const reordered = orderedRoleIds.map(id => roleMap[id]).filter(Boolean);
    server.roles.forEach(r => {
        if (!orderedRoleIds.includes(r._id.toString())) reordered.push(r);
    });

    server.roles = reordered;
    await server.save();
    res.json(server);
});

app.delete('/api/servers/:serverId/roles/:roleId', async (req, res) => {
    const server = await Server.findById(req.params.serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });
    server.roles = server.roles.filter(r => r._id.toString() !== req.params.roleId);
    server.memberRoles.forEach(mr => {
        mr.roleIds = mr.roleIds.filter(id => id !== req.params.roleId);
    });
    await server.save();
    res.json(server);
});

app.put('/api/servers/:serverId/members/:userId/roles', async (req, res) => {
    const { roleId, action } = req.body;
    const server = await Server.findById(req.params.serverId);
    if (!server) return res.status(404).json({ error: 'Server not found' });

    let entry = server.memberRoles.find(mr => mr.userId.toString() === req.params.userId);
    if (!entry) {
        server.memberRoles.push({ userId: req.params.userId, roleIds: action === 'add' ? [roleId] : [] });
    } else {
        if (action === 'add' && !entry.roleIds.includes(roleId)) {
            entry.roleIds.push(roleId);
        } else if (action === 'remove') {
            entry.roleIds = entry.roleIds.filter(id => id !== roleId);
        }
    }
    await server.save();
    res.json(server);
});

app.get('/api/servers/:serverId/channels', async (req, res) => res.json(await Channel.find({ serverId: req.params.serverId })));
app.post('/api/servers/:serverId/channels', async (req, res) => {
    const server = await Server.findById(req.params.serverId);
    const existingCount = await Channel.countDocuments({ serverId: req.params.serverId });
    if (server && existingCount >= (server.maxChannels || 50)) {
        return res.status(403).json({ error: `Channel limit (${server.maxChannels}) reached for this server.` });
    }
    const newChannelData = {
        name: req.body.name,
        topic: req.body.topic,
        serverId: req.params.serverId,
        isLocked: !!req.body.isLocked,
        allowedMembers: req.body.isLocked ? [req.body.userId] : [],
        allowedRoles: req.body.allowedRoles || []
    };
    res.json(await new Channel(newChannelData).save());
});
app.put('/api/channels/:id', async (req, res) => {
    res.json(await Channel.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});
app.delete('/api/channels/:id', async (req, res) => {
    await Channel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});
app.get('/api/servers/:serverId/members', async (req, res) => {
    const server = await Server.findById(req.params.serverId).populate('members', 'username discriminator pfp avatarDecoration banner bio activity customStatus badges isVerified isAdmin');
    res.json({
        members: server ? server.members : [],
        roles: server ? server.roles : [],
        memberRoles: server ? server.memberRoles : []
    });
});

// --- MESSAGES ---
app.get('/api/messages/:targetId', async (req, res) => {
    const messages = await Message.find({ targetId: req.params.targetId })
        .sort({ timestamp: 1 })
        .populate('authorId', 'username discriminator pfp avatarDecoration banner bio activity customStatus badges isVerified isAdmin')
        .populate({ path: 'replyTo', populate: { path: 'authorId', select: 'username pfp' } });
    res.json(messages);
});

app.post('/api/messages/:targetId', async (req, res) => {
    const { content, userId, replyTo } = req.body;
    const sender = await User.findById(userId);
    if (!sender) return res.status(404).json({ error: 'User not found' });

    if (sender.suspendedUntil && new Date(sender.suspendedUntil) > new Date()) {
        return res.status(403).json({ error: 'Your account is temporarily suspended.' });
    }

    const channel = await Channel.findById(req.params.targetId);
    if (channel) {
        const srv = await Server.findById(channel.serverId);
        if (srv && srv.isQuarantined && !sender.isAdmin) {
            return res.status(403).json({ error: 'This server is currently quarantined by System Admins.' });
        }
    }

    const cfg = await SystemConfig.findOne({ key: 'global' });
    if (cfg && !sender.isAdmin) {
        const now = Date.now();
        const windowMs = (cfg.rateLimitWindowSec || 10) * 1000;
        const maxMsgs = cfg.rateLimitCount || 15;
        if (!userMessageTimestamps[userId]) userMessageTimestamps[userId] = [];
        userMessageTimestamps[userId] = userMessageTimestamps[userId].filter(t => now - t < windowMs);
        if (userMessageTimestamps[userId].length >= maxMsgs) {
            return res.status(429).json({ error: `Slow down! Max ${maxMsgs} messages per ${cfg.rateLimitWindowSec}s.` });
        }
        userMessageTimestamps[userId].push(now);
    }

    let finalContent = content;
    if (cfg && !cfg.allowEmojis && !sender.isAdmin) {
        finalContent = finalContent.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}]/gu, '');
    }

    if (typingState[req.params.targetId]) {
        delete typingState[req.params.targetId][userId];
    }

    const msg = new Message({ content: finalContent, authorId: userId, targetId: req.params.targetId, replyTo });
    await msg.save();
    res.json({ success: true, _id: msg._id });
});

app.put('/api/messages/edit/:msgId', async (req, res) => res.json(await Message.findByIdAndUpdate(req.params.msgId, { content: req.body.content, isEdited: true }, { new: true })));
app.delete('/api/messages/:msgId', async (req, res) => {
    const msg = await Message.findById(req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const requesterId = req.query.userId;
    if (requesterId && msg.authorId.toString() !== requesterId) {
        const requester = await User.findById(requesterId);
        const channel = await Channel.findById(msg.targetId);
        const server = channel ? await Server.findById(channel.serverId) : null;
        const perms = getMemberServerPerms(server, requester);
        if (!requester?.isAdmin && !perms.manageMessages) {
            return res.status(403).json({ error: 'Missing Delete Messages permission.' });
        }
    }

    await Message.findByIdAndDelete(req.params.msgId);
    res.json({ success: true });
});

// ==========================================
// --- EXPANDED ADMIN PANEL ROUTES ---
// ==========================================
app.get('/api/admin/users', async (req, res) => {
    res.json(await User.find({}, '-password').sort({ createdAt: -1 }));
});

app.get('/api/admin/users/:id/servers', async (req, res) => {
    const servers = await Server.find({ members: req.params.id }, 'name inviteCode members isVerified');
    res.json(servers);
});

app.put('/api/admin/users/:id/suspend', async (req, res) => {
    const { hours, adminName } = req.body;
    const suspendedUntil = hours > 0 ? new Date(Date.now() + hours * 3600000) : null;
    const u = await User.findByIdAndUpdate(req.params.id, { suspendedUntil }, { new: true });
    await logAdmin(adminName, hours > 0 ? `Suspended user for ${hours}h` : 'Lifted suspension', `${u.username}#${u.discriminator}`);
    res.json(u);
});

app.put('/api/admin/users/:id/password', async (req, res) => {
    const { newPassword, adminName } = req.body;
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const u = await User.findByIdAndUpdate(req.params.id, { password: hashedPassword }, { new: true });
    await logAdmin(adminName, 'Forced password reset', `${u.username}#${u.discriminator}`);
    res.json({ success: true });
});

app.put('/api/admin/users/:id/identity', async (req, res) => {
    const { username, discriminator, adminName } = req.body;
    const u = await User.findByIdAndUpdate(req.params.id, { username, discriminator }, { new: true });
    await logAdmin(adminName, 'Changed user tag', `${u.username}#${u.discriminator}`);
    res.json(u);
});

app.put('/api/admin/users/:id/reset-profile', async (req, res) => {
    const { type, adminName } = req.body;
    const targetUser = await User.findById(req.params.id);
    const updates = {};
    if (type === 'pfp') { updates.pfp = `https://ui-avatars.com/api/?name=${targetUser.username}&background=5865F2&color=fff`; updates.avatarDecoration = ''; }
    if (type === 'bio') { updates.bio = "I'm new to Scene!"; updates.customStatus = ''; }
    if (type === 'banner') updates.banner = '#36393f';
    const u = await User.findByIdAndUpdate(req.params.id, updates, { new: true });
    await logAdmin(adminName, `Reset user ${type}`, `${u.username}#${u.discriminator}`);
    res.json(u);
});

app.put('/api/admin/users/:id/badges', async (req, res) => {
    const { badge, action, adminName } = req.body;
    const update = action === 'remove' ? { $pull: { badges: badge } } : { $addToSet: { badges: badge } };
    const u = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    await logAdmin(adminName, `${action === 'remove' ? 'Removed' : 'Awarded'} badge "${badge}"`, `${u.username}#${u.discriminator}`);
    res.json(u);
});

app.post('/api/admin/users/:id/warn', async (req, res) => {
    const { warning, adminName } = req.body;
    const u = await User.findByIdAndUpdate(req.params.id, { pendingWarning: warning }, { new: true });
    await logAdmin(adminName, `Sent warning: "${warning}"`, `${u.username}#${u.discriminator}`);
    res.json({ success: true });
});

app.put('/api/admin/users/verify/:id', async (req, res) => {
    const u = await User.findByIdAndUpdate(req.params.id, { isVerified: req.body.isVerified }, { new: true });
    await logAdmin(req.body.adminName, `Set verified=${req.body.isVerified}`, `${u.username}#${u.discriminator}`);
    res.json(u);
});

app.delete('/api/admin/users/:id', async (req, res) => {
    const u = await User.findByIdAndDelete(req.params.id);
    await logAdmin(req.query.adminName, 'Deleted user account', u ? `${u.username}#${u.discriminator}` : req.params.id);
    res.json({ success: true });
});

app.get('/api/admin/servers', async (req, res) => {
    const servers = await Server.find({}).populate('ownerId', 'username discriminator');
    res.json(servers);
});

app.put('/api/admin/servers/:id/manage', async (req, res) => {
    const { name, inviteCode, isQuarantined, maxChannels, regenInvite, adminName } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (inviteCode !== undefined && inviteCode.trim() !== '') updates.inviteCode = inviteCode.trim();
    if (regenInvite) updates.inviteCode = Math.random().toString(36).substring(2, 8);
    if (isQuarantined !== undefined) updates.isQuarantined = isQuarantined;
    if (maxChannels !== undefined) updates.maxChannels = Number(maxChannels);

    const s = await Server.findByIdAndUpdate(req.params.id, updates, { new: true });
    await logAdmin(adminName, 'Updated server settings/oversight', s.name);
    res.json(s);
});

app.get('/api/admin/servers/:id/locked-channels', async (req, res) => {
    const channels = await Channel.find({ serverId: req.params.id, isLocked: true }).populate('allowedMembers', 'username discriminator');
    res.json(channels);
});

app.put('/api/admin/channels/:id/allowlist', async (req, res) => {
    const { userTag, action, adminName } = req.body;
    const [name, disc] = userTag.split('#');
    const targetUser = await User.findOne({ username: name, discriminator: disc });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    const update = action === 'remove'
        ? { $pull: { allowedMembers: targetUser._id } }
        : { $addToSet: { allowedMembers: targetUser._id } };

    const ch = await Channel.findByIdAndUpdate(req.params.id, update, { new: true }).populate('allowedMembers', 'username discriminator');
    await logAdmin(adminName, `${action === 'remove' ? 'Removed' : 'Added'} ${userTag} on locked channel #${ch.name}`, ch.name);
    res.json(ch);
});

app.put('/api/admin/servers/verify/:id', async (req, res) => {
    const s = await Server.findByIdAndUpdate(req.params.id, { isVerified: req.body.isVerified }, { new: true });
    await logAdmin(req.body.adminName, `Set server verified=${req.body.isVerified}`, s.name);
    res.json(s);
});

app.get('/api/admin/all-channels', async (req, res) => {
    const channels = await Channel.find({}).populate('serverId', 'name');
    res.json(channels);
});

app.post('/api/admin/system-message', async (req, res) => {
    const { targetId, content, adminName } = req.body;
    let bot = await User.findOne({ username: 'Scene', discriminator: '0000' });
    if (!bot) await initSystem();
    bot = await User.findOne({ username: 'Scene', discriminator: '0000' });

    const msg = await new Message({
        content,
        authorId: bot._id,
        targetId,
        isSystem: true
    }).save();
    await logAdmin(adminName, `Sent SYSTEM message: "${content.substring(0, 30)}..."`, targetId);
    res.json(msg);
});

app.put('/api/admin/config', async (req, res) => {
    const { adminName, ...updates } = req.body;
    const cfg = await SystemConfig.findOneAndUpdate({ key: 'global' }, updates, { new: true, upsert: true });
    await logAdmin(adminName, 'Updated global system configuration', 'SystemConfig');
    res.json(cfg);
});

app.post('/api/admin/decorations', async (req, res) => {
    const { name, image, adminName } = req.body;
    const cfg = await SystemConfig.findOneAndUpdate(
        { key: 'global' },
        { $push: { avatarDecorations: { name, image } } },
        { new: true, upsert: true }
    );
    await logAdmin(adminName, `Uploaded avatar decoration "${name}"`, 'Avatar Decorations');
    res.json(cfg);
});

app.delete('/api/admin/decorations/:decId', async (req, res) => {
    const cfg = await SystemConfig.findOneAndUpdate(
        { key: 'global' },
        { $pull: { avatarDecorations: { _id: req.params.decId } } },
        { new: true }
    );
    await logAdmin(req.query.adminName, 'Deleted avatar decoration', req.params.decId);
    res.json(cfg);
});

app.post('/api/admin/badges', async (req, res) => {
    const { name, color, icon, adminName } = req.body;
    const cfg = await SystemConfig.findOneAndUpdate(
        { key: 'global' },
        { $push: { customBadges: { name, color: color || '#5865F2', icon: icon || '★' } } },
        { new: true }
    );
    await logAdmin(adminName, `Created custom badge "${name}"`, 'Badge Studio');
    res.json(cfg);
});

app.get('/api/admin/audit-logs', async (req, res) => {
    res.json(await AuditLog.find({}).sort({ timestamp: -1 }).limit(100));
});

app.get('/api/admin/tickets', async (req, res) => {
    res.json(await Ticket.find({}).populate('userId', 'username discriminator pfp').sort({ createdAt: -1 }));
});

app.put('/api/admin/tickets/:id', async (req, res) => {
    const { reply, status, adminName } = req.body;
    const t = await Ticket.findByIdAndUpdate(req.params.id, { reply, status: status || 'Resolved' }, { new: true }).populate('userId', 'username discriminator');
    await logAdmin(adminName, `Replied to ticket: ${t.subject}`, t.userId ? `${t.userId.username}#${t.userId.discriminator}` : 'User');
    res.json(t);
});

if (process.env.VERCEL !== '1') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
