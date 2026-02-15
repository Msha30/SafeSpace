// notification.js
import { db, auth, rtdb } from "./auth.js";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocs,
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getDatabase,
  ref,
  get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { exportChatAsHTML } from "./chat-export.js";

let notifMenu;
let notifBadge;
let unsubscribeNotifications = null;
let flaggedCheckInterval = null;

/* ============================
   Initialization
============================ */
export function initNotifications() {
  notifMenu = document.getElementById("notifer");
  notifBadge = document.querySelector(".notif-badge");

  if (!notifMenu) {
    console.warn("notifMenu not found");
    return;
  }

  // Close on outside click
  document.addEventListener("click", handleOutsideClick);

  // Optional: escape key close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeNotif();
  });
}

/* ============================
   Start listeners when auth ready
============================ */
export async function initNotificationListener() {
  return new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      unsubscribe(); // Stop listening after first auth state
      
      if (!user) {
        console.warn("No authenticated user for notifications");
        resolve();
        return;
      }

      console.log("Starting notification listeners for:", user.email);
      
      // Start all listeners
      listenForVerificationRequests();
      listenForReferrals();
      checkForFlaggedMessages();
      
      // Poll for flagged messages every 30 seconds
      flaggedCheckInterval = setInterval(checkForFlaggedMessages, 30000);
      
      resolve();
    });
  });
}

/* ============================
   Toggle logic
============================ */
export function toggleNotif(event) {
  event.stopPropagation();

  if (!notifMenu) return;

  notifMenu.classList.toggle("show");
}

export function closeNotif() {
  if (!notifMenu) return;
  notifMenu.classList.remove("show");
}

function handleOutsideClick(e) {
  if (!notifMenu) return;

  // Close if clicking outside the notification container
  const notifContainer = document.querySelector(".notification");
  if (!notifContainer.contains(e.target)) {
    closeNotif();
  }
}

/* ============================
   Badge helpers
============================ */
export function setNotifBadge(count) {
  if (!notifBadge) return;

  notifBadge.textContent = count > 99 ? '99+' : count;

  if (count <= 0) {
    notifBadge.style.display = "none";
  } else {
    notifBadge.style.display = "inline-flex";
  }
}

/* ============================
   Listen for Verification Requests
============================ */
function listenForVerificationRequests() {
  const verificationQuery = query(
    collection(db, "account_details"),
    where("userType", "==", "peer")
  );

  onSnapshot(verificationQuery, async (snapshot) => {
    const pendingVerifications = [];
    
    snapshot.forEach((doc) => {
      const data = doc.data();
      // Check if verification is pending or undefined
      if (!data.isVerified || data.isVerified === "pending") {
        pendingVerifications.push({
          uid: doc.id,
          ...data
        });
      }
    });

    // Render verification notifications
    await renderAllNotifications();
  }, (error) => {
    console.error("Verification listener error:", error);
  });
}

/* ============================
   Listen for Referrals
============================ */
function listenForReferrals() {
  const referralQuery = query(
    collection(db, "referral_submission"),
    orderBy("date_submitted", "desc"),
    limit(20)
  );

  onSnapshot(referralQuery, async (snapshot) => {
    // Render all notifications (will fetch fresh data)
    await renderAllNotifications();
  }, (error) => {
    console.error("Referral listener error:", error);
  });
}

/* ============================
   Check for Flagged Messages
============================ */
async function checkForFlaggedMessages() {
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

    // Store flagged messages for rendering
    window._flaggedMessages = flaggedMessages;
    
    // Re-render notifications
    await renderAllNotifications();
    
  } catch (error) {
    console.error("Error checking for flagged messages:", error);
  }
}

/* ============================
   Render All Notifications
============================ */
async function renderAllNotifications() {
  try {
    const notifications = [];

    // 1. Get Verification Requests
    const verificationQuery = query(
      collection(db, "account_details"),
      where("userType", "==", "peer")
    );
    const verificationSnapshot = await getDocs(verificationQuery);
    
    verificationSnapshot.forEach((doc) => {
      const data = doc.data();
      if (!data.isVerified || data.isVerified === "pending") {
        notifications.push({
          type: 'verification',
          uid: doc.id,
          name: `${data.fname || ''} ${data.lname || ''}`.trim(),
          email: data.email,
          timestamp: data.createdAt
        });
      }
    });

    // 2. Get Flagged Messages
    const flaggedMessages = window._flaggedMessages || [];
    for (const flagged of flaggedMessages) {
      let studentInfo, peerInfo;
      
      if (flagged.type === 'peer-to-peer') {
        studentInfo = await getUserInfo(flagged.studentId);
        peerInfo = await getUserInfo(flagged.peerId);
        
        notifications.push({
          type: 'flagged',
          subType: 'peer-to-peer',
          student: `${studentInfo.lname || ''}, ${studentInfo.fname || ''}`.trim() || 'Unknown',
          studentEmail: studentInfo.email || '',
          peer: `${peerInfo.lname || ''}, ${peerInfo.fname || ''}`.trim() || 'Unknown',
          preview: flagged.text || '',
          timestamp: flagged.timestamp,
          sessionId: flagged.sessionId,
          peerId: flagged.peerId,
          studentId: flagged.studentId
        });
      } else if (flagged.type === 'supportgroup') {
        const senderInfo = await getUserInfo(flagged.senderId);
        
        notifications.push({
          type: 'flagged',
          subType: 'supportgroup',
          student: flagged.senderName || `${senderInfo.lname || ''}, ${senderInfo.fname || ''}`.trim(),
          studentEmail: senderInfo.email || '',
          peer: `${flagged.groupName} - ${flagged.chatName}`,
          preview: flagged.text || '',
          timestamp: flagged.timestamp,
          groupId: flagged.groupId,
          chatId: flagged.chatId
        });
      }
    }

    // 3. Get Referrals
    const referralQuery = query(
      collection(db, "referral_submission"),
      orderBy("date_submitted", "desc"),
      limit(20)
    );
    const referralSnapshot = await getDocs(referralQuery);
    
    for (const doc of referralSnapshot.docs) {
      const data = doc.data();
      const studentInfo = await getUserInfo(data.studentUid);
      const peerInfo = await getUserInfo(data.submitted_by);
      
      notifications.push({
        type: 'referral',
        student: `${studentInfo.lname || ''}, ${studentInfo.fname || ''}`.trim() || 'Unknown',
        studentEmail: studentInfo.email || '',
        peer: `${peerInfo.lname || ''}, ${peerInfo.fname || ''}`.trim() || 'Unknown',
        reason: data.reason || '',
        timestamp: data.date_submitted,
        sessionId: data.messageId, // This is the RTDB session ID
        peerId: data.submitted_by,
        studentId: data.studentUid
      });
    }

    // Sort by timestamp (newest first)
    notifications.sort((a, b) => {
      const tsA = getTimestamp(a.timestamp);
      const tsB = getTimestamp(b.timestamp);
      return tsB - tsA;
    });

    // Render
    renderNotifications(notifications);
    
  } catch (error) {
    console.error("Error rendering notifications:", error);
  }
}

/* ============================
   Helper: Get user info
============================ */
async function getUserInfo(uid) {
  if (!uid) return {};
  
  try {
    const userDoc = await getDoc(doc(db, "account_details", uid));
    if (userDoc.exists()) {
      return userDoc.data();
    }
  } catch (error) {
    console.error("Error fetching user info:", error);
  }
  
  return {};
}

/* ============================
   Helper: Get timestamp as number
============================ */
function getTimestamp(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  return 0;
}

/* ============================
   Helper: Format timestamp
============================ */
function formatTimestamp(ts) {
  const ms = getTimestamp(ts);
  if (!ms) return 'Unknown time';
  
  const date = new Date(ms);
  const now = new Date();
  const diff = now - date;
  
  // Less than 1 minute
  if (diff < 60000) return 'Just now';
  
  // Less than 1 hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  }
  
  // Today
  if (date.toDateString() === now.toDateString()) {
    return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  // Older
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ============================
   Rendering scaffold
============================ */
export function renderNotifications(notifications = []) {
  const content = notifMenu?.querySelector(".notif-content");
  if (!content) return;

  content.innerHTML = "";

  if (notifications.length === 0) {
    content.innerHTML = '<div style="padding: 20px; text-align: center; color: #888;">No notifications</div>';
    setNotifBadge(0);
    return;
  }

  notifications.forEach((notif) => {
    const card = buildNotifCard(notif);
    if (card) content.appendChild(card);
  });

  setNotifBadge(notifications.length);
}

function buildNotifCard(notif) {
  switch (notif.type) {
    case "verification":
      return buildVerificationCard(notif);
    case "flagged":
      return buildFlaggedCard(notif);
    case "referral":
      return buildReferralCard(notif);
    default:
      console.warn("Unknown notification type:", notif.type);
      return null;
  }
}

/* ============================
   Card builders
============================ */

function buildVerificationCard(data) {
  const div = document.createElement("div");
  div.className = "notif-card";

  div.innerHTML = `
    <h3>
      <span class="notif-type-badge badge-verification" style="font-weight:900;">
        VERIFICATION
      </span>
      Peer Facilitator Verification
    </h3>
    <p class="usrName">
      ${escapeHtml(data.name)}<br>
      <span>${escapeHtml(data.email)}</span>
    </p>
    <div class="notif-buttons">
      <button class="btn-decline" onclick="handleVerificationAction('decline', '${data.uid}')">Decline</button>
      <button class="btn-accept" onclick="handleVerificationAction('accept', '${data.uid}')">Accept</button>
    </div>
  `;

  return div;
}

function buildFlaggedCard(data) {
  const div = document.createElement("div");
  div.className = "notif-card";

  const exportData = JSON.stringify({
    subType: data.subType,
    sessionId: data.sessionId,
    peerId: data.peerId,
    studentId: data.studentId,
    groupId: data.groupId,
    chatId: data.chatId
  }).replace(/"/g, '&quot;');

  div.innerHTML = `
    <h3>
      <span class="notif-type-badge badge-flagged" style="font-weight:900;">
        FLAGGED
      </span>
      Flagged Words Detected
    </h3>
    <div class="flagged-info">
      <div class="flagged-participants">
        <div class="participant-row">
          <span class="participant-label">Student:</span>
          <span class="participant-name">${escapeHtml(data.student)}</span>
        </div>
        <div class="participant-row">
          <span style="font-size:11px;color:#888;">${escapeHtml(data.studentEmail)}</span>
        </div>
        <div class="participant-row">
          <span class="participant-label">${data.subType === 'supportgroup' ? 'Group Chat:' : 'Peer Facilitator:'}</span>
          <span class="participant-name">${escapeHtml(data.peer)}</span>
        </div>
      </div>
      <div class="conversation-preview">
        "${escapeHtml(data.preview)}"
      </div>
      <div class="timestamp">${formatTimestamp(data.timestamp)}</div>
    </div>
    <div class="notif-buttons">
      <button class="btn-export" onclick='exportFlaggedConversation(${exportData})'>Export Chat</button>
    </div>
  `;

  return div;
}

function buildReferralCard(data) {
  const div = document.createElement("div");
  div.className = "notif-card";

  const exportData = JSON.stringify({
    sessionId: data.sessionId,
    peerId: data.peerId,
    studentId: data.studentId
  }).replace(/"/g, '&quot;');

  div.innerHTML = `
    <h3>
      <span class="notif-type-badge badge-referral" style="font-weight:900;">
        REFERRAL
      </span>
      Student Referred to GCO
    </h3>
    <div class="referral-info">
      <div class="referral-field">
        <span class="field-label">Student:</span>
        <span class="field-value">${escapeHtml(data.student)}</span>
      </div>
      <div class="referral-field">
        <span class="field-value" style="font-size:11px;color:#888;">
          ${escapeHtml(data.studentEmail)}
        </span>
      </div>
      <div class="referral-field">
        <span class="field-label">Peer Facilitator:</span>
        <span class="field-value">${escapeHtml(data.peer)}</span>
      </div>
      <div class="referral-reason">
        <span class="field-label">Reason for Referral:</span>
        <p class="reason-text">${escapeHtml(data.reason)}</p>
      </div>
      <div class="timestamp">${formatTimestamp(data.timestamp)}</div>
    </div>
    <div class="notif-buttons">
      <button class="btn-export" onclick='exportReferralChat(${exportData})'>Export Chat</button>
    </div>
  `;

  return div;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/* ============================
   Action Handlers
============================ */

window.handleVerificationAction = async function(action, uid) {
  try {
    const userRef = doc(db, "account_details", uid);
    
    if (action === 'accept') {
      await updateDoc(userRef, {
        isVerified: 'verified'
      });
      alert('Peer facilitator verified successfully');
    } else {
      await updateDoc(userRef, {
        isVerified: 'not_verified'
      });
      alert('Peer facilitator verification declined');
    }
    
    // Refresh notifications
    await renderAllNotifications();
    
  } catch (error) {
    console.error('Error handling verification:', error);
    alert('Failed to process verification');
  }
};

window.exportFlaggedConversation = async function(data) {
  try {
    if (data.subType === 'peer-to-peer') {
      await exportPeerToPeerChat(data.peerId, data.studentId);
    } else if (data.subType === 'supportgroup') {
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

/* ============================
   Export Functions
============================ */

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
   Cleanup
============================ */
export function destroyNotificationListener() {
  if (unsubscribeNotifications) {
    unsubscribeNotifications();
    unsubscribeNotifications = null;
  }
  
  if (flaggedCheckInterval) {
    clearInterval(flaggedCheckInterval);
    flaggedCheckInterval = null;
  }
}