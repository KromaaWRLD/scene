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

// --- DATABASE SCHEMAS ---
const User = mongoose.model('User', new mongoose.Schema({
    username: { type: String, required: true },
    discriminator: { type: String, required: true }, // The #0000 part
    password: { type: String, required: true }
}));

const Server = mongoose.model('Server', new mongoose.Schema({
    name: { type: String, required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}));

const Channel = mongoose.model('Channel', new mongoose.Schema({
    name: { type: String, required: true },
    serverId: { type: mongoose.Schema.Types.ObjectId, ref: 'Server' }
}));

const Message = mongoose.model('Message', new mongoose.Schema({
    content: { type: String, required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel' },
    timestamp: { type: Date, default: Date.now }
}));

// --- AUTHENTICATION ROUTES ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    // Generate random 4-digit discriminator
    let discriminator = Math.floor(1000 + Math.random() * 9000).toString();
    
    // Make sure Username#Discriminator is unique
    while(await User.findOne({ username, discriminator })) {
        discriminator = Math.floor(1000 + Math.random() * 9000).toString();
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, discriminator, password: hashedPassword });
    await user.save();
    res.json({ _id: user._id, username: user.username, discriminator: user.discriminator });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    // User might type Username#1234 or just Username
    const [name, disc] = username.split('#');
    const query = disc ? { username: name, discriminator: disc } : { username: name };
    
    const user = await User.findOne(query);
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.status(401).json({ error: "Invalid credentials" });
    }
    res.json({ _id: user._id, username: user.username, discriminator: user.discriminator });
});

// --- SERVER & CHANNEL ROUTES ---
app.get('/api/servers', async (req, res) => {
    const servers = await Server.find();
    res.json(servers);
});

app.post('/api/servers', async (req, res) => {
    const { name, userId } = req.body;
    const server = new Server({ name, ownerId: userId, members: [userId] });
    await server.save();
    // Auto-create a general channel
    await new Channel({ name: 'general', serverId: server._id }).save();
    res.json(server);
});

app.get('/api/servers/:serverId/channels', async (req, res) => {
    const channels = await Channel.find({ serverId: req.params.serverId });
    res.json(channels);
});

app.post('/api/servers/:serverId/channels', async (req, res) => {
    const { name, userId } = req.body;
    const server = await Server.findById(req.params.serverId);
    
    // Basic Permissions: Only Owner can create channels
    if (server.ownerId.toString() !== userId) {
        return res.status(403).json({ error: "Only the server owner can create channels." });
    }

    const channel = new Channel({ name, serverId: req.params.serverId });
    await channel.save();
    res.json(channel);
});

// --- MESSAGE ROUTES ---
app.get('/api/channels/:channelId/messages', async (req, res) => {
    const messages = await Message.find({ channelId: req.params.channelId }).populate('authorId', 'username discriminator');
    res.json(messages);
});

app.post('/api/channels/:channelId/messages', async (req, res) => {
    const { content, userId } = req.body;
    const msg = new Message({ content, authorId: userId, channelId: req.params.channelId });
    await msg.save();
    const populatedMsg = await Message.findById(msg._id).populate('authorId', 'username discriminator');
    res.json(populatedMsg);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
