const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// MongoDB Connection
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
    status: { type: String, default: 'Online' },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Server = mongoose.model('Server', new mongoose.Schema({
    name: { type: String, required: true },
    icon: { type: String, default: '' },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] // Tracking who is in the server
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
    targetId: { type: mongoose.Schema.Types.ObjectId }, // Channel ID or DM ID
    timestamp: { type: Date, default: Date.now }
}));

// --- AUTH ROUTES ---
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
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Invalid username or password" });
    }
    res.json(user);
});

// --- USER & FRIEND ROUTES ---
app.put('/api/users/:id', async (req, res) => {
    const updatedUser = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedUser);
});

app.post('/api/friends/add', async (req, res) => {
    const { currentUserId, friendTag } = req.body;
    if (!friendTag.includes('#')) return res.status(400).json({ error: "Include the #0000 tag!" });
    
    const [name, disc] = friendTag.split('#');
    const friend = await User.findOne({ username: name, discriminator: disc });
    
    if (!friend) return res.status(404).json({ error: "User not found!" });
    if (friend._id.toString() === currentUserId) return res.status(400).json({ error: "Can't add yourself!" });

    await User.findByIdAndUpdate(currentUserId, { $addToSet: { friends: friend._id } });
    await User.findByIdAndUpdate(friend._id, { $addToSet: { friends: currentUserId } });
    
    // Create DM connection
    const existingDM = await DM.findOne({ participants: { $all: [currentUserId, friend._id] } });
    if (!existingDM) await new DM({ participants: [currentUserId, friend._id] }).save();

    res.json({ success: true });
});

app.get('/api/users/:id/friends', async (req, res) => {
    const user = await User.findById(req.params.id).populate('friends', 'username discriminator pfp status');
    const dms = await DM.find({ participants: req.params.id });
    res.json({ friends: user.friends, dms });
});

// --- SERVER ROUTES (Isolated by User) ---
app.get('/api/servers/user/:userId', async (req, res) => {
    // Only return servers where the user is in the members array
    const servers = await Server.find({ members: req.params.userId });
    res.json(servers);
});

app.post('/api/servers', async (req, res) => {
    const { name, userId } = req.body;
    const server = new Server({ name, ownerId: userId, members: [userId] }); // Add creator to members
    await server.save();
    await new Channel({ name: 'general', serverId: server._id }).save();
    res.json(server);
});

// Join a server by ID
app.post('/api/servers/join', async (req, res) => {
    const { serverId, userId } = req.body;
    try {
        const server = await Server.findByIdAndUpdate(serverId, { $addToSet: { members: userId } }, { new: true });
        if (!server) return res.status(404).json({ error: "Server not found!" });
        res.json(server);
    } catch (e) {
        res.status(400).json({ error: "Invalid Server ID" });
    }
});

app.put('/api/servers/:id', async (req, res) => {
    res.json(await Server.findByIdAndUpdate(req.params.id, req.body, { new: true }));
});

app.get('/api/servers/:serverId/channels', async (req, res) => {
    res.json(await Channel.find({ serverId: req.params.serverId }));
});

app.post('/api/servers/:serverId/channels', async (req, res) => {
    res.json(await new Channel({ name: req.body.name, serverId: req.params.serverId }).save());
});

// --- MESSAGE ROUTES ---
app.get('/api/messages/:targetId', async (req, res) => {
    // Fetch messages and populate ALL profile data for the clickable modal
    const messages = await Message.find({ targetId: req.params.targetId })
                                  .populate('authorId', 'username discriminator pfp banner bio status');
    res.json(messages);
});

app.post('/api/messages/:targetId', async (req, res) => {
    const msg = new Message({ content: req.body.content, authorId: req.body.userId, targetId: req.params.targetId });
    await msg.save();
    res.json(await Message.findById(msg._id).populate('authorId', 'username discriminator pfp banner bio status'));
});

app.listen(3000, () => console.log(`Server running on port 3000`));
