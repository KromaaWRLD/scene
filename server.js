const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(__dirname));

// MongoDB Connection String (Using your credentials)
const mongoURI = "mongodb+srv://27johnballenger2_db_user:hm398KIfJh0lX98E@cluster0.nkbek9a.mongodb.net/scene_db?retryWrites=true&w=majority";

mongoose.connect(mongoURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB successfully!'))
  .catch(err => console.error('MongoDB connection error:', err));

// Database Schema for a Post/Message
const postSchema = new mongoose.Schema({
  username: { type: String, default: 'Anonymous User' },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const Post = mongoose.model('Post', postSchema);

// API Route to GET all posts
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await Post.find().sort({ timestamp: 1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// API Route to CREATE a new post
app.post('/api/posts', async (req, res) => {
  try {
    const newPost = new Post({
      content: req.body.content
    });
    const savedPost = await newPost.save();
    res.json(savedPost);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save post' });
  }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
