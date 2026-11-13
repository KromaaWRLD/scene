const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // For image uploads
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
    activity: { type: String, default: 'online' }, // online, idle, dnd, offline
    customStatus: { type: String, default: '' },
    badges: { type: [String], default: ['Early Supporter'] },
    isAdmin: { type: Boolean, default: false }, // Set to true in MongoDB Compass to get admin panel
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Server = mongoose.model('Server', new mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    inviteCode: { type: String, unique: true },
    isVerified: { type: Boolean, default: false }
}));

const Channel = mongoose.model('Channel', new mongoose.Schema({
    name: { type: String, required: true },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Server' }
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
    timestamp: { type: Date, default: Date.now }
}));

// --- AUTH ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    let discriminator = Math.floor(1000 + Math.random() * 9000).toString();
    while(await User.findOne({ username, discriminator })) {
        discriminator = Math.floor(1000 + Math.random() * 9000).toString();
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const pfp = `https://ui-avatars.com/api/?name=${username}&background=5865F2&color=fff`;
    const user = new User({ username, discriminator, password: hashedPassword, pfp });
    await user.save();
    res.json(user);
});
app.post('/api/login', async (req, res) => {
    const user = await User.findOne({ username: req.body.username });
    if (!user || !(await bcrypt.compare(req.body.password, user.password))) return res.status(401).json({ error: "Invalid credentials" });
    res.json(user);
});

// --- USERS & FRIENDS ---
app.put('/api/users/:id', async (req, res) => {
    res.json(await User.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});
app.get('/api/users/:id/friends', async (req, res) => {
    const user = await User.findById(req.params.id).populate('friends', 'username discriminator pfp activity customStatus');
    const dms = await DM.find({ participants: req.params.id });
    res.json({ friends: user.friends, dms });
});
app.post('/api/friends/add', async (req, res) => {
    const { currentUserId, friendTag } = req.body;
    if(!friendTag.includes('#')) return res.status(400).json({ error: "Need #0000 format" });
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

// --- SERVERS ---
app.get('/api/servers/user/:userId', async (req, res) => res.json(await Server.find({ members: req.params.userId })));
app.post('/api/servers', async (req, res) => {
    const server = new Server({ name: req.body.name, ownerId: req.body.userId, members: [req.body.userId], inviteCode: Math.random().toString(36).substring(2, 8) });
    await server.save();
    await new Channel({ name: 'general', serverId: server._id }).save();
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
app.post('/api/servers/:serverId/channels', async (req, res) => res.json(await new Channel({ name: req.body.name, serverId: req.params.serverId }).save()));
app.get('/api/servers/:serverId/members', async (req, res) => {
    const server = await Server.findById(req.params.serverId).populate('members', 'username discriminator pfp activity customStatus badges');
    res.json(server.members);
});

// --- MESSAGES ---
app.get('/api/messages/:targetId', async (req, res) => {
    const messages = await Message.find({ targetId: req.params.targetId })
        .populate('authorId', 'username discriminator pfp banner bio activity customStatus badges')
        .populate({ path: 'replyTo', populate: { path: 'authorId', select: 'username pfp' }});
    res.json(messages);
});
app.post('/api/messages/:targetId', async (req, res) => {
    const msg = new Message({ content: req.body.content, authorId: req.body.userId, targetId: req.params.targetId, replyTo: req.body.replyTo });
    await msg.save();
    res.json(await Message.findById(msg._id).populate('authorId').populate({ path: 'replyTo', populate: { path: 'authorId', select: 'username' }}));
});
app.put('/api/messages/edit/:msgId', async (req, res) => res.json(await Message.findByIdAndUpdate(req.params.msgId, { content: req.body.content, isEdited: true }, { new: true })));
app.delete('/api/messages/:msgId', async (req, res) => { await Message.findByIdAndDelete(req.params.msgId); res.json({ success: true }); });

// --- ADMIN ROUTES ---
app.get('/api/admin/users', async (req, res) => res.json(await User.find({}, 'username discriminator pfp isAdmin')));
app.get('/api/admin/servers', async (req, res) => res.json(await Server.find({}, 'name isVerified')));
app.put('/api/admin/servers/verify/:id', async (req, res) => res.json(await Server.findByIdAndUpdate(req.params.id, { isVerified: req.body.isVerified }, {new: true})));
app.delete('/api/admin/users/:id', async (req, res) => { await User.findByIdAndDelete(req.params.id); res.json({success:true}); });

app.listen(3000, () => console.log(`Server running on port 3000`));
