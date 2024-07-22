const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = 3000;

// Store user IDs and their socket IDs
const userMap = new Map(); // Maps user IDs to socket IDs
const socketIdMap = new Map(); // Maps socket IDs to user IDs

// Queue system for offline messages
const messageQueue = new Map(); // Maps user IDs to an array of messages

// Attempt to send all queued messages for a user
const attemptToSendQueuedMessages = (userId, socketId) => {
  const queuedMessages = messageQueue.get(userId);
  if (queuedMessages) {
    queuedMessages.forEach(msg => {
      io.to(socketId).emit('messageSent', msg);
      console.log('Delivered queued message:', msg);
    });
    // Clear the queue for this user after attempting to send messages
    messageQueue.delete(userId);
  }
};

// Retry mechanism to attempt sending messages periodically
const retrySendingMessages = () => {
  setInterval(() => {
    messageQueue.forEach((messages, userId) => {
      const socketId = userMap.get(userId);
      if (socketId) {
        attemptToSendQueuedMessages(userId, socketId);
      }
    });
  }, 5000); // Retry every 5 seconds
};

io.on('connection', (socket) => {
  console.log('A user connected', socket.id);

  // Set user ID when a user connects
  socket.on('setUserId', (userId) => {
    // Store the mapping
    userMap.set(userId, socket.id);
    socketIdMap.set(socket.id, userId);
    console.log('User ID set:', userId);

    // Emit updated user list
    io.emit('allClientIDs', Array.from(userMap.entries())); // Send user ID and socket ID

    // Deliver any queued messages for this user
    attemptToSendQueuedMessages(userId, socket.id);
  });

  socket.on('get users', () => {
    io.emit('allClientIDs', Array.from(userMap.entries())); // Send user ID and socket ID
  });

  socket.on('sendMessage', (msg) => {
    const { message_id, conversation_id, sender_id, recipient_id, content } = msg;
    console.log('Sending message:', msg);

    const recipientSocketId = userMap.get(recipient_id);
    if (recipientSocketId) {
      // Emit the message to the recipient
      io.to(recipientSocketId).emit('messageSent', msg);
      console.log('Message sent to recipient:', recipient_id);
    } else {
      // Queue the message for offline recipient
      if (!messageQueue.has(recipient_id)) {
        messageQueue.set(recipient_id, []);
      }
      messageQueue.get(recipient_id).push(msg);
      console.log('Message queued for offline recipient:', recipient_id);
    }
  });

  // Handle conversation creation event
  socket.on('createConversation', ({ sender_id, recipient_id, username }) => {
    console.log('Conversation create event triggered:', sender_id, recipient_id, username);
    const recipientSocketId = userMap.get(recipient_id);
    if (recipientSocketId) {
      // Emit conversation created event to the recipient
      io.to(recipientSocketId).emit('conversationCreated', { sender_id, recipient_id, username });
    } else {
      // Queue the conversation creation event for offline recipient
      if (!messageQueue.has(recipient_id)) {
        messageQueue.set(recipient_id, []);
      }
      messageQueue.get(recipient_id).push({ type: 'conversationCreated', sender_id, recipient_id, username });
      console.log('Conversation creation event queued for offline recipient:', recipient_id);
    }
  });

  // Handle conversation confirmation event
  socket.on('confirmConversation', ({ sender_id, recipient_id, username }) => {
    console.log('confirmConversation event triggered by recipient:', sender_id, recipient_id, username);
    const senderSocketId = userMap.get(sender_id);
    if (senderSocketId) {
      // Emit conversation created event back to the sender
      io.to(senderSocketId).emit('conversationConfirmed', { sender_id: recipient_id, recipient_id: sender_id, username });
      console.log('conversationConfirmed event sent back to sender', { sender_id: recipient_id, recipient_id: sender_id, username });
    } else {
      // Queue the conversation confirmation event for offline sender
      if (!messageQueue.has(sender_id)) {
        messageQueue.set(sender_id, []);
      }
      messageQueue.get(sender_id).push({ type: 'conversationConfirmed', sender_id: recipient_id, recipient_id: sender_id, username });
      console.log('Conversation confirmation event queued for offline sender:', sender_id);
    }
  });

  socket.on('sendToSpecificClient', (data) => {
    const { targetClientId, message } = data;
    if (userMap.has(targetClientId)) {
      io.to(userMap.get(targetClientId)).emit('private message', message);
    } else {
      socket.emit('error', 'Client not found');
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected', socket.id);
    const userId = socketIdMap.get(socket.id);
    userMap.delete(userId);
    socketIdMap.delete(socket.id);
    io.emit('allClientIDs', Array.from(userMap.entries())); // Update client list
  });
});

// Start retry mechanism
retrySendingMessages();

server.listen(port, () => {
  console.log('Server running on port:', port);
});
