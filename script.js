const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');

// Determine the API URL (works locally or deployed)
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:3000/api/posts' : '/api/posts';

// Fetch messages from MongoDB
async function fetchMessages() {
    try {
        const response = await fetch(API_URL);
        const messages = await response.json();
        
        messagesContainer.innerHTML = '';
        messages.forEach(msg => {
            appendMessageToUI(msg);
        });
        
        // Scroll to bottom
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        console.error("Error fetching messages:", error);
    }
}

// Append a single message to the UI
function appendMessageToUI(msg) {
    const date = new Date(msg.timestamp).toLocaleString();
    
    const messageEl = document.createElement('div');
    messageEl.classList.add('message');
    
    messageEl.innerHTML = `
        <div class="avatar">U</div>
        <div class="message-content">
            <div class="message-header">
                <span class="username">${msg.username}</span>
                <span class="timestamp">${date}</span>
            </div>
            <div class="text">${msg.content}</div>
        </div>
    `;
    
    messagesContainer.appendChild(messageEl);
}

// Handle sending a new message
messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const content = messageInput.value.trim();
    if (!content) return;
    
    try {
        // Send to MongoDB
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        });
        
        const newMsg = await response.json();
        
        // Add to UI immediately
        appendMessageToUI(newMsg);
        messageInput.value = '';
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
    } catch (error) {
        console.error("Error sending message:", error);
    }
});

// Load messages when page loads
fetchMessages();

// Refresh messages every 3 seconds to act like real-time chat
setInterval(fetchMessages, 3000);
