// chat-moderation.js
import { db, rtdb } from "./auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDatabase,
  ref,
  get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { exportChatAsHTML } from "./chat-export.js";

/* ============================
   Initialize Chat Moderation
============================ */
export async function initChatModeration() {
  console.log("Initializing Chat Moderation...");
  await loadFlaggedWords();
  await loadReferrals();
}

/* ============================
   Load Flagged Words
============================ */
async function loadFlaggedWords() {
  try {
    const flaggedMessages = [];

    // 1. Check Support Group Messages (Firestore)
    const supportGroups = await getDocs(collection(db, "supportgroup"));
    
    for (const sgDoc of supportGroups.docs) {
      const groupData = sgDoc.data();
      const groupchats = groupData.groupchats || [];
      
      for (const chat of groupchats) {
        const messagesRef = collection(db, "supportgroup", sgDoc.id, "groupchats", chat.groupchatId, "messages");
        const messagesSnapshot = await getDocs(messagesRef);
        
        messagesSnapshot.forEach((msgDoc) => {
          const msgData = msgDoc.data();
          const moderation = msgData.moderation || {};
          
          if (moderation.flagged === true) {
            flaggedMessages.push({
              type: 'supportgroup',
              groupId: sgDoc.id,
              groupName: groupData.supportgroup_name,
              chatId: chat.groupchatId,
              chatName: chat.name,
              messageId: msgDoc.id,
              senderId: msgData.senderId,
              senderName: msgData.senderName,
              text: msgData.text || msgData.message,
              timestamp: msgData.timestamp,
              moderation: moderation
            });
          }
        });
      }
    }

    // 2. Check Peer-to-Peer Messages (RTDB)
    const dbRtdb = getDatabase();
    const messagesSnapshot = await get(ref(dbRtdb, 'messages'));
    
    if (messagesSnapshot.exists()) {
      const allConversations = messagesSnapshot.val();
      
      for (const [sessionId, conversation] of Object.entries(allConversations)) {
        const messages = conversation.messages || [];
        
        if (Array.isArray(messages)) {
          messages.forEach((slot, index) => {
            if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return;
            
            Object.entries(slot).forEach(([msgKey, msgObj]) => {
              if (!msgObj || typeof msgObj !== 'object') return;
              
              const moderation = msgObj.moderation || {};
              
              if (moderation.flagged === true) {
                flaggedMessages.push({
                  type: 'peer-to-peer',
                  sessionId: sessionId,
                  peerId: conversation.peerId,
                  studentId: conversation.studentId,
                  messageIndex: index,
                  messageKey: msgKey,
                  senderId: msgObj.senderId,
                  text: msgObj.text || msgObj.message,
                  timestamp: msgObj.timestamp,
                  moderation: moderation
                });
              }
            });
          });
        }
      }
    }

    // Sort by timestamp (most recent first)
    flaggedMessages.sort((a, b) => {
      const timeA = getTimestamp(a.timestamp);
      const timeB = getTimestamp(b.timestamp);
      return timeB - timeA;
    });

    // Render the flagged messages
    await renderFlaggedWords(flaggedMessages);
    
  } catch (error) {
    console.error("Error loading flagged words:", error);
  }
}

/* ============================
   Render Flagged Words Table
============================ */
async function renderFlaggedWords(flaggedMessages) {
  const tbody = document.getElementById('flaggedWordsTableBody');
  
  if (!tbody) {
    console.error("Flagged words tbody not found");
    return;
  }

  // Clear existing rows
  tbody.innerHTML = '';

  if (flaggedMessages.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px; color: #666;">
          No flagged messages found
        </td>
      </tr>
    `;
    return;
  }

  // Render each flagged message
  for (const msg of flaggedMessages) {
    const row = await createFlaggedRow(msg);
    tbody.appendChild(row);
  }
}

/* ============================
   Create Flagged Row
============================ */
async function createFlaggedRow(msg) {
  const tr = document.createElement('tr');
  
  let studentInfo = {};
  let peerInfo = {};
  let studentDisplay = "Unknown Student";
  let studentEmail = "";
  let peerDisplay = "N/A";

  // Get user info based on message type
  if (msg.type === 'peer-to-peer') {
    studentInfo = await getUserInfo(msg.studentId);
    peerInfo = await getUserInfo(msg.peerId);
    
    studentDisplay = `${studentInfo.lname || ''}, ${studentInfo.fname || ''} ${studentInfo.mname ? studentInfo.mname.charAt(0) + '.' : ''}`.trim() || 'Unknown';
    studentEmail = studentInfo.email || msg.studentId || '';
    peerDisplay = `${peerInfo.lname || ''}, ${peerInfo.fname || ''} ${peerInfo.mname ? peerInfo.mname.charAt(0) + '.' : ''}`.trim() || 'Unknown';
  } else if (msg.type === 'supportgroup') {
    studentInfo = await getUserInfo(msg.senderId);
    studentDisplay = msg.senderName || `${studentInfo.lname || ''}, ${studentInfo.fname || ''}`.trim() || 'Unknown';
    studentEmail = studentInfo.email || msg.senderId || '';
    peerDisplay = msg.chatName || msg.groupName || 'Support Group';
  }

  const timestamp = getTimestamp(msg.timestamp);
  const dateStr = formatDate(timestamp);
  const timeStr = formatTime(timestamp);

  // Display the actual message text that was flagged
  const flaggedWords = msg.text || msg.message || 'No message content';

  // Create export data
  const exportData = JSON.stringify({
    type: msg.type,
    sessionId: msg.sessionId,
    peerId: msg.peerId,
    studentId: msg.studentId,
    groupId: msg.groupId,
    chatId: msg.chatId
  }).replace(/"/g, '&quot;');

  tr.innerHTML = `
    <td class="table_user">
      <img src="${studentInfo.profilePicture || 'photos/pic_placeholder.png'}" onerror="this.src='photos/pic_placeholder.png'">
    </td>
    <td>
      <div class="name" onclick="openUsersPopup('${msg.senderId || msg.studentId}')">
        ${studentDisplay}<br> 
        <span>${studentEmail}</span>
      </div>
    </td>
    <td></td>
    <td>${peerDisplay}</td>
    <td> 
      <div class="detected-word">${flaggedWords}</div>
    </td>
    <td>
      <div class="record-timestamp">${dateStr}<br>${timeStr}</div>
    </td>
    <td>
      <div class="mod-action-btn export" onclick='exportFlaggedChat(${exportData})'>Export Chat</div>
    </td>
  `;

  return tr;
}

/* ============================
   Load Referrals
============================ */
async function loadReferrals() {
  try {
    const referralQuery = query(
      collection(db, "referral_submission"),
      orderBy("date_submitted", "desc"),
      limit(50)
    );

    const referralsSnapshot = await getDocs(referralQuery);
    const referrals = [];

    referralsSnapshot.forEach((doc) => {
      referrals.push({
        id: doc.id,
        ...doc.data()
      });
    });

    await renderReferrals(referrals);
    
  } catch (error) {
    console.error("Error loading referrals:", error);
  }
}

/* ============================
   Render Referrals Table
============================ */
async function renderReferrals(referrals) {
  const tbody = document.getElementById('referralsTableBody');
  
  if (!tbody) {
    console.error("Referrals tbody not found");
    return;
  }

  // Clear existing rows
  tbody.innerHTML = '';

  if (referrals.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 20px; color: #666;">
          No referrals found
        </td>
      </tr>
    `;
    return;
  }

  // Render each referral
  for (const referral of referrals) {
    const row = await createReferralRow(referral);
    tbody.appendChild(row);
  }
}

/* ============================
   Create Referral Row
============================ */
async function createReferralRow(referral) {
  const tr = document.createElement('tr');
  
  // Get student and peer info - using correct field names from notification.js
  const studentInfo = await getUserInfo(referral.studentUid); // notification.js uses studentUid
  const peerInfo = await getUserInfo(referral.submitted_by); // notification.js uses submitted_by

  const studentDisplay = `${studentInfo.lname || ''}, ${studentInfo.fname || ''} ${studentInfo.mname ? studentInfo.mname.charAt(0) + '.' : ''}`.trim() || 'Unknown';
  const studentEmail = studentInfo.email || referral.studentUid || '';
  
  const peerDisplay = `${peerInfo.lname || ''}, ${peerInfo.fname || ''} ${peerInfo.mname ? peerInfo.mname.charAt(0) + '.' : ''}`.trim() || 'Unknown';

  const timestamp = getTimestamp(referral.date_submitted);
  const dateStr = formatDate(timestamp);
  const timeStr = formatTime(timestamp);

  const reason = referral.reason || "No reason provided"; // notification.js uses 'reason'

  // Create export data - using correct field names
  const exportData = JSON.stringify({
    sessionId: referral.messageId, // notification.js uses messageId for sessionId
    peerId: referral.submitted_by,
    studentId: referral.studentUid
  }).replace(/"/g, '&quot;');

  tr.innerHTML = `
    <td class="table_user">
      <img src="${studentInfo.profilePicture || 'photos/pic_placeholder.png'}" onerror="this.src='photos/pic_placeholder.png'">
    </td>
    <td>
      <div class="name" onclick="openUsersPopup('${referral.studentUid}')">
        ${studentDisplay}<br> 
        <span>${studentEmail}</span>
      </div>
    </td>
    <td></td>
    <td>${peerDisplay}</td>
    <td> 
      <div class="gco-reason">${reason}</div>
    </td>
    <td>
      <div class="record-timestamp">${dateStr}<br>${timeStr}</div>
    </td>
    <td>
      <div class="mod-action-btn export" onclick='exportReferralChat(${exportData})'>Export Chat</div>
    </td>
  `;

  return tr;
}

/* ============================
   Export Functions
============================ */
window.exportFlaggedChat = async function(data) {
  try {
    if (data.type === 'peer-to-peer') {
      await exportPeerToPeerChat(data.peerId, data.studentId);
    } else if (data.type === 'supportgroup') {
      await exportSupportGroupChat(data.groupId, data.chatId);
    }
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export conversation');
  }
};

window.exportReferralChat = async function(data) {
  try {
    await exportPeerToPeerChat(data.peerId, data.studentId);
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export conversation');
  }
};

async function exportPeerToPeerChat(peerId, studentId) {
  try {
    // Get user info for display names
    const peerInfo = await getUserInfo(peerId);
    const studentInfo = await getUserInfo(studentId);
    
    const peerDisplay = `${peerInfo.lname || ''}, ${peerInfo.fname || ''}`.trim() || peerId;
    const studentDisplay = `${studentInfo.lname || ''}, ${studentInfo.fname || ''}`.trim() || studentId;
    
    // Get messages from RTDB
    const dbRtdb = getDatabase();
    const messagesSnapshot = await get(ref(dbRtdb, 'messages'));
    
    if (!messagesSnapshot.exists()) {
      alert('No messages found');
      return;
    }
    
    const allConversations = messagesSnapshot.val();
    let targetConversation = null;
    
    // Find the conversation
    for (const [sessionId, conversation] of Object.entries(allConversations)) {
      if ((conversation.peerId === peerId && conversation.studentId === studentId) ||
          (conversation.peerId === studentId && conversation.studentId === peerId)) {
        targetConversation = conversation;
        break;
      }
    }
    
    if (!targetConversation) {
      alert('Conversation not found');
      return;
    }
    
    // Flatten messages
    const flattenedMessages = [];
    const rawMessages = targetConversation.messages || [];
    
    if (Array.isArray(rawMessages)) {
      rawMessages.forEach(slot => {
        if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return;
        
        Object.values(slot).forEach(msgObj => {
          if (!msgObj || typeof msgObj !== 'object') return;
          
          // Determine sender info
          const senderId = msgObj.senderId || msgObj.uid || msgObj.sender;
          let senderName = "Unknown";
          let isPeer = false;
          
          if (senderId === peerId) {
            senderName = peerDisplay;
            isPeer = true;
          } else if (senderId === studentId) {
            senderName = studentDisplay;
            isPeer = false;
          } else {
            senderName = senderId || "Unknown";
          }
          
          flattenedMessages.push({
            senderId: senderId,
            senderName: senderName,
            sender: senderName,
            text: msgObj.text || msgObj.message || msgObj.content || "",
            timestamp: msgObj.timestamp,
            moderation: msgObj.moderation || {},
            isPeer: isPeer,
            userType: isPeer ? 'peer' : 'student'
          });
        });
      });
    }
    
    // Sort by timestamp
    flattenedMessages.sort((a, b) => (Number(a.timestamp || 0) - Number(b.timestamp || 0)));
    
    // Export as HTML with chat bubbles
    const title = `Peer to Peer Chat Export`;
    const participants = {
      peer: { name: peerDisplay, id: peerId },
      student: { name: studentDisplay, id: studentId }
    };
    
    const safePeer = peerDisplay.replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
    const safeStudent = studentDisplay.replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
    const filename = `chat_p2p_${safePeer}_${safeStudent}.html`;
    
    exportChatAsHTML(flattenedMessages, title, filename, participants);
    
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export chat');
  }
}

async function exportSupportGroupChat(groupId, chatId) {
  try {
    const messagesRef = collection(db, "supportgroup", groupId, "groupchats", chatId, "messages");
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    const querySnapshot = await getDocs(q);
    
    // Get group and chat names
    const groupDoc = await getDoc(doc(db, "supportgroup", groupId));
    const groupData = groupDoc.exists() ? groupDoc.data() : {};
    const groupName = groupData.supportgroup_name || "Support Group";
    
    const groupchats = groupData.groupchats || [];
    const chatData = groupchats.find(gc => gc.groupchatId === chatId);
    const chatName = chatData ? chatData.name : "Group Chat";
    
    const messages = [];
    
    querySnapshot.forEach(docSnap => {
      const data = docSnap.data();
      const ts = getTimestamp(data.timestamp);
      
      messages.push({
        senderId: data.senderId,
        senderName: data.senderName || data.senderId || "Unknown",
        sender: data.senderName || data.senderId || "Unknown",
        text: data.text || data.message || data.content || "",
        timestamp: ts,
        moderation: data.moderation || {}
      });
    });
    
    // Export as HTML with chat bubbles
    const title = `Support Group Chat Export`;
    const participants = {
      groupName: groupName,
      chatName: chatName
    };
    
    const safeGroup = groupName.replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
    const safeChat = chatName.replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
    const filename = `chat_sg_${safeGroup}_${safeChat}.html`;
    
    exportChatAsHTML(messages, title, filename, participants);
    
  } catch (error) {
    console.error('Export error:', error);
    alert('Failed to export chat');
  }
}

/* ============================
   Helper Functions
============================ */
async function getUserInfo(uid) {
  try {
    if (!uid) return {};
    
    const userDoc = await getDoc(doc(db, "account_details", uid));
    if (userDoc.exists()) {
      return userDoc.data();
    }
    return {};
  } catch (error) {
    console.error("Error fetching user info:", error);
    return {};
  }
}

function getTimestamp(timestamp) {
  if (!timestamp) return 0;
  
  // Handle number
  if (typeof timestamp === 'number') return timestamp;
  
  // Handle Firestore Timestamp
  if (timestamp.toDate) return timestamp.toDate().getTime();
  
  // Handle Date object
  if (timestamp instanceof Date) return timestamp.getTime();
  
  return 0;
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}