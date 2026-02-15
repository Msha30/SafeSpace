// chat-export.js - Shared module for exporting chats as HTML with chat bubbles

/**
 * Generates and downloads an HTML file with chat bubble UI
 * @param {Array} messages - Array of message objects with {sender, senderName, text, timestamp, moderation}
 * @param {String} title - Title for the chat export
 * @param {String} filename - Filename for download
 * @param {Object} participants - {peer: {name, id}, student: {name, id}} or {groupName, chatName}
 */
export function exportChatAsHTML(messages, title, filename, participants = {}) {
  const html = generateChatHTML(messages, title, participants);
  downloadHTML(html, filename);
}

/**
 * Generates the complete HTML with chat bubbles
 */
function generateChatHTML(messages, title, participants) {
  const messagesHTML = messages.map((msg, index) => {
    const isLeft = determineMessageSide(msg, index, messages);
    return createMessageBubble(msg, isLeft);
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
      min-height: 100vh;
    }

    .chat-container {
      max-width: 900px;
      margin: 0 auto;
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }

    .chat-header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 25px 30px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .chat-header h1 {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 8px;
    }

    .chat-header .participants {
      font-size: 14px;
      opacity: 0.9;
      line-height: 1.5;
    }

    .chat-header .export-info {
      font-size: 12px;
      opacity: 0.7;
      margin-top: 8px;
    }

    .chat-messages {
      padding: 30px;
      background: #f8f9fa;
      max-height: calc(100vh - 200px);
      overflow-y: auto;
    }

    .message-wrapper {
      display: flex;
      margin-bottom: 20px;
      animation: fadeIn 0.3s ease;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .message-wrapper.left {
      justify-content: flex-start;
    }

    .message-wrapper.right {
      justify-content: flex-end;
    }

    .message {
      max-width: 65%;
      position: relative;
    }

    .sender-name {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
      padding: 0 4px;
      opacity: 0.7;
    }

    .message-wrapper.left .sender-name {
      color: #667eea;
    }

    .message-wrapper.right .sender-name {
      color: #764ba2;
      text-align: right;
    }

    .message-bubble {
      padding: 12px 16px;
      border-radius: 18px;
      word-wrap: break-word;
      position: relative;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .message-wrapper.left .message-bubble {
      background: white;
      border-bottom-left-radius: 4px;
      color: #333;
    }

    .message-wrapper.right .message-bubble {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-bottom-right-radius: 4px;
      color: white;
    }

    .message-text {
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 6px;
    }

    .message-time {
      font-size: 11px;
      opacity: 0.6;
      text-align: right;
      margin-top: 4px;
    }

    .moderation-flag {
      display: inline-block;
      background: #ff4757;
      color: white;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      margin-top: 8px;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.7;
      }
    }

    .moderation-details {
      font-size: 11px;
      margin-top: 4px;
      padding: 6px 10px;
      background: rgba(255, 71, 87, 0.1);
      border-radius: 8px;
      color: #ff4757;
      font-weight: 500;
    }

    .date-divider {
      text-align: center;
      margin: 30px 0 20px;
      position: relative;
    }

    .date-divider span {
      background: #e9ecef;
      padding: 6px 16px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      color: #6c757d;
      display: inline-block;
    }

    .chat-footer {
      padding: 20px 30px;
      background: #f8f9fa;
      border-top: 1px solid #dee2e6;
      text-align: center;
      color: #6c757d;
      font-size: 12px;
    }

    .stats {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin-bottom: 10px;
    }

    .stat-item {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .stat-value {
      font-size: 20px;
      font-weight: 700;
      color: #667eea;
    }

    .stat-label {
      font-size: 11px;
      text-transform: uppercase;
      color: #6c757d;
      margin-top: 2px;
    }

    @media print {
      body {
        background: white;
        padding: 0;
      }
      
      .chat-container {
        box-shadow: none;
      }
      
      .chat-messages {
        max-height: none;
      }
    }

    @media (max-width: 768px) {
      .message {
        max-width: 85%;
      }
      
      .chat-messages {
        padding: 15px;
      }
      
      .chat-header {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="chat-container">
    <div class="chat-header">
      <h1>${escapeHtml(title)}</h1>
      <div class="participants">
        ${generateParticipantsInfo(participants)}
      </div>
      <div class="export-info">
        Exported on ${new Date().toLocaleString()}
      </div>
    </div>
    
    <div class="chat-messages">
      ${messagesHTML}
    </div>
    
    <div class="chat-footer">
      <div class="stats">
        <div class="stat-item">
          <div class="stat-value">${messages.length}</div>
          <div class="stat-label">Total Messages</div>
        </div>
        <div class="stat-item">
          <div class="stat-value">${messages.filter(m => m.moderation && m.moderation.flagged).length}</div>
          <div class="stat-label">Flagged Messages</div>
        </div>
      </div>
      <div style="margin-top: 10px;">
        Generated by NU Fairview GCO Chat Export System
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Creates an individual message bubble
 */
function createMessageBubble(msg, isLeft) {
  const moderation = msg.moderation || {};
  const isFlagged = moderation.flagged === true;
  const flaggedWords = moderation.flaggedWords || [];
  
  const timestamp = formatTimestamp(msg.timestamp);
  const messageText = escapeHtml(msg.text || msg.message || '');
  const senderName = escapeHtml(msg.senderName || msg.sender || 'Unknown');
  
  let moderationHTML = '';
  if (isFlagged) {
    moderationHTML = `
      <div class="moderation-flag">⚠️ FLAGGED</div>
      ${flaggedWords.length > 0 ? `<div class="moderation-details">Detected: ${escapeHtml(flaggedWords.join(', '))}</div>` : ''}
    `;
  }
  
  return `
    <div class="message-wrapper ${isLeft ? 'left' : 'right'}">
      <div class="message">
        <div class="sender-name">${senderName}</div>
        <div class="message-bubble">
          <div class="message-text">${messageText}</div>
          <div class="message-time">${timestamp}</div>
          ${moderationHTML}
        </div>
      </div>
    </div>
  `;
}

/**
 * Determines if message should be on left or right side
 * For peer-to-peer: peer on right, student on left
 * For support group: alternate based on sender
 */
function determineMessageSide(msg, index, allMessages) {
  // If we know this is from a peer facilitator, put it on the right
  if (msg.isPeer || msg.userType === 'peer') {
    return false; // right side
  }
  
  // If we know this is from a student, put it on the left
  if (msg.isStudent || msg.userType === 'student') {
    return true; // left side
  }
  
  // For support groups, alternate based on sender ID
  if (index > 0 && allMessages[index - 1]) {
    const prevSender = allMessages[index - 1].senderId || allMessages[index - 1].sender;
    const currentSender = msg.senderId || msg.sender;
    
    // If same sender as previous, keep same side
    if (prevSender === currentSender) {
      return determineMessageSide(allMessages[index - 1], index - 1, allMessages);
    }
  }
  
  // Default: alternate based on position
  return index % 2 === 0;
}

/**
 * Generates participant information HTML
 */
function generateParticipantsInfo(participants) {
  if (participants.peer && participants.student) {
    return `
      <strong>Peer Facilitator:</strong> ${escapeHtml(participants.peer.name)}<br>
      <strong>Student:</strong> ${escapeHtml(participants.student.name)}
    `;
  } else if (participants.groupName && participants.chatName) {
    return `
      <strong>Support Group:</strong> ${escapeHtml(participants.groupName)}<br>
      <strong>Chat:</strong> ${escapeHtml(participants.chatName)}
    `;
  } else if (participants.groupName) {
    return `<strong>Group:</strong> ${escapeHtml(participants.groupName)}`;
  }
  return 'Chat Conversation';
}

/**
 * Formats timestamp to readable format
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  
  let date;
  if (typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else if (timestamp.toDate) {
    date = timestamp.toDate();
  } else {
    date = new Date(timestamp);
  }
  
  const options = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  };
  
  return date.toLocaleString('en-US', options);
}

/**
 * Escapes HTML special characters
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Downloads HTML content as a file
 */
function downloadHTML(htmlContent, filename) {
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
}