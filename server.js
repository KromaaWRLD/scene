const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

const mongoURI = "mongodb+srv://27johnballenger2_db_user:hm398KIfJh0lX98E@cluster0.nkbek9a.mongodb.net/scene_db?retryWrites=true&w=majority";
mongoose.connect(mongoURI).then(() => console.log('MongoDB Connected')).catch(err => console.log(err));

// --- SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true },
    discriminator: { type: String, required: true },
    password: { type: String, required: true },
    pfp: { type: String, default: 'https://ui-avatars.com/api/?name=U&background=5865F2&color=fff' },
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

const Server = mongoose.model('Server', new mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    inviteCode: { type: String, unique: true },
    isVerified: { type: Boolean, default: false },
    isQuarantined: { type: Boolean, default: false },
    maxChannels: { type: Number, default: 50 }
}));

const Channel = mongoose.model('Channel', new mongoose.Schema({
    name: { type: String, required: true },
    topic: { type: String, default: '' },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Server' },
    isLocked: { type: Boolean, default: false },
    allowedMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const DM = mongoose.model('DM', new mongoose.Schema({
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    content: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    isEdited: { type: Boolean, default: false },
    isSystem: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
}));

const SystemConfig = mongoose.model('SystemConfig', new mongoose.Schema({
    key: { type: String, default: 'global', unique: true },
    maintenanceMode: { type: Boolean, default: false },
    allowEmojis: { type: Boolean, default: true },
    allowMentions: { type: Boolean, default: true },
    rateLimitCount: { type: Number, default: 5 },
    rateLimitWindowSec: { type: Number, default: 10 },
    changelogText: { type: String, default: 'Welcome to Scene! Check out our latest updates.' },
    changelogVersion: { type: String, default: 'v1.0' },
    tosText: { type: String, default: '1. Be respectful.\n2. No spamming.\n3. Follow community guidelines.' },
    autoWelcomeEnabled: { type: Boolean, default: true },
    autoWelcomeMsg: { type: String, default: 'Welcome to Scene! Let us know if you need any help.' },
    customBadges: [{ name: String, color: String, icon: String }]
}));

const Ticket = mongoose.model('Ticket', new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subject: String,
    message: String,
    reply: { type: String, default: '' },
    status: { type: String, default: 'Open' },
    createdAt: { type: Date, default: Date.now }
}));

const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({
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
mongoose.connection.once('open', initSystem);

async function logAdmin(adminName, action, target) {
    await new AuditLog({ adminName: adminName || 'Admin', action, target }).save();
}

// In-memory rate limit tracker
const userMessageTimestamps = {};

// --- PUBLIC CONFIG & HEARTBEAT ---
app.get('/api/config', async (req, res) => {
    const cfg = await SystemConfig.findOne({ key: 'global' });
    res.json(cfg);
});

app.post('/api/heartbeat/:userId', async (req, res) => {
    const user = await User.findByIdAndUpdate(req.params.userId, { lastActive: new Date() }, { new: true });
    const cfg = await SystemConfig.findOne({ key: 'global' });
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const warning = user.pendingWarning;
    if (warning) {
        user.pendingWarning = '';
        await user.save();
    }
    res.json({
        user,
        warning,
        maintenanceMode: cfg?.maintenanceMode || false,
        config: cfg
    });
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

    // Auto-Welcome DM from Official Scene Bot
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
    res.json(await User.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});
app.get('/api/users/:id/friends', async (req, res) => {
    const user = await User.findById(req.params.id).populate('friends', 'username discriminator pfp activity customStatus isVerified badges bio banner');
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

// --- SUPPORT TICKETS (USER SIDE) ---
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

// --- SERVERS & CHANNELS ---
app.get('/api/servers/user/:userId', async (req, res) => res.json(await Server.find({ members: req.params.userId })));
app.post('/api/servers', async (req, res) => {
    const server = new Server({ name: req.body.name, ownerId: req.body.userId, members: [req.body.userId], inviteCode: Math.random().toString(36).substring(2, 8) });
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
app.get('/api/servers/:serverId/channels', async (req, res) => res.json(await Channel.find({ serverId: req.params.serverId })));
app.post('/api/servers/:serverId/channels', async (req, res) => {
    const server = await Server.findById(req.params.serverId);
    const existingCount = await Channel.countDocuments({ serverId: req.params.serverId });
    if (server && existingCount >= (server.maxChannels || 50)) {
        return res.status(403).json({ error: `Channel limit (${server.maxChannels}) reached for this server.` });
    }
    const newChannelData = { name: req.body.name, topic: req.body.topic, serverId: req.params.serverId };
    if (req.body.isLocked) {
        newChannelData.isLocked = true;
        newChannelData.allowedMembers = [req.body.userId];
    }
    res.json(await new Channel(newChannelData).save());
});
app.delete('/api/channels/:id', async (req, res) => {
    await Channel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
});
app.get('/api/servers/:serverId/members', async (req, res) => {
    const server = await Server.findById(req.params.serverId).populate('members', 'username discriminator pfp banner bio activity customStatus badges isVerified');
    res.json(server ? server.members : []);
});

// --- MESSAGES ---
app.get('/api/messages/:targetId', async (req, res) => {
    const messages = await Message.find({ targetId: req.params.targetId })
        .populate('authorId', 'username discriminator pfp banner bio activity customStatus badges isVerified')
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

    // Check Server Quarantine
    const channel = await Channel.findById(req.params.targetId);
    if (channel) {
        const srv = await Server.findById(channel.serverId);
        if (srv && srv.isQuarantined && !sender.isAdmin) {
            return res.status(403).json({ error: 'This server is currently quarantined by System Admins.' });
        }
    }

    // Global Rate Limiting
    const cfg = await SystemConfig.findOne({ key: 'global' });
    if (cfg && !sender.isAdmin) {
        const now = Date.now();
        const windowMs = (cfg.rateLimitWindowSec || 10) * 1000;
        const maxMsgs = cfg.rateLimitCount || 5;
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

    const msg = new Message({ content: finalContent, authorId: userId, targetId: req.params.targetId, replyTo });
    await msg.save();
    res.json(await Message.findById(msg._id).populate('authorId').populate({ path: 'replyTo', populate: { path: 'authorId', select: 'username' } }));
});

app.put('/api/messages/edit/:msgId', async (req, res) => res.json(await Message.findByIdAndUpdate(req.params.msgId, { content: req.body.content, isEdited: true }, { new: true })));
app.delete('/api/messages/:msgId', async (req, res) => { await Message.findByIdAndDelete(req.params.msgId); res.json({ success: true }); });

// ==========================================
// --- EXPANDED ADMIN PANEL ROUTES ---
// ==========================================

// 1. Users Full Details, Suspend, Password Reset, Identity, Resets, Badges, Servers, Warnings
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
    if (type === 'pfp') updates.pfp = `https://ui-avatars.com/api/?name=${targetUser.username}&background=5865F2&color=fff`;
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

// 2. Servers Oversight: Member Count, Rename, Invite Regen/Vanity, Quarantine, Channel Limits, Locked Channel Allowlist
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

// 3. Official SYSTEM Message Broadcaster
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

// 4. System Config, Badge Studio, Audit Logs, Tickets
app.put('/api/admin/config', async (req, res) => {
    const { adminName, ...updates } = req.body;
    const cfg = await SystemConfig.findOneAndUpdate({ key: 'global' }, updates, { new: true, upsert: true });
    await logAdmin(adminName, 'Updated global system configuration', 'SystemConfig');
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

app.listen(3000, () => console.log(`Server running on port 3000`));
