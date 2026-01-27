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
  getDoc,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

let notifMenu;
let notifBadge;
let allNotifications = [];
let unsubscribeVerification = null;
let unsubscribeReferrals = null;


auth.onAuthStateChanged((user) => {
  if (user) {
    console.log("User authenticated, starting notification listeners");
    initNotificationListener();
  } else {
    console.log("User signed out, stopping notifications");
    destroyNotificationListener();
  }
});

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

/**
 * Initialize all notification listeners
 */
export async function initNotificationListener() {
  const user = auth.currentUser;

  if (!user) {
    console.warn("No authenticated user for notifications");
    return;
  }

  // Start all listeners
  await Promise.all([
    listenForVerificationRequests(),
    listenForReferrals()
  ]);

  // Check flagged messages periodically (every 30 seconds)
  checkForFlaggedMessages();
  setInterval(checkForFlaggedMessages, 30000);
}

/**
 * Listen for peer verification requests
 */
async function listenForVerificationRequests() {
  const accountsRef = collection(db, "account_details");
  const q = query(accountsRef, where("userType", "==", "peer"));

  unsubscribeVerification = onSnapshot(q, async (snapshot) => {
    const verificationNotifs = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const isVerified = data.isVerified;

      // Only show if pending or unverified (not "verified" or "not_verified")
      if (!isVerified || isVerified === "pending") {
        verificationNotifs.push({
          type: "verification",
          uid: docSnap.id,
          name: `${data.fname || ""} ${data.lname || ""}`.trim() || "Unknown",
          email: data.email || "unknown@email",
          timestamp: data.createdAt?.toDate ? data.createdAt.toDate() : new Date()
        });
      }
    }

    updateNotifications("verification", verificationNotifs);
  }, (error) => {
    console.error("Verification listener error:", error);
  });
}

/**
 * Check for flagged messages (both support groups and peer-to-peer)
 */
async function checkForFlaggedMessages() {
  try {
    const flaggedNotifs = [];

    // Check support group messages
    await checkSupportGroupFlaggedMessages(flaggedNotifs);

    // Check RTDB peer-to-peer messages
    await checkRTDBFlaggedMessages(flaggedNotifs);

    updateNotifications("flagged", flaggedNotifs);
  } catch (error) {
    console.error("Error checking flagged messages:", error);
  }
}

/**
 * Check support group messages for flags
 */
async function checkSupportGroupFlaggedMessages(flaggedNotifs) {
  try {
    // Get all support groups
    const supportGroupsSnap = await getDocs(collection(db, "supportgroup"));

    for (const sgDoc of supportGroupsSnap.docs) {
      const sgData = sgDoc.data();
      const groupchats = sgData.groupchats || [];

      // Check each groupchat
      for (const gc of groupchats) {
        if (!gc.groupchatId) continue;

        const messagesRef = collection(
          db,
          "supportgroup",
          sgDoc.id,
          "groupchats",
          gc.groupchatId,
          "messages"
        );

        const messagesSnap = await getDocs(messagesRef);

        for (const msgDoc of messagesSnap.docs) {
          const msgData = msgDoc.data();
          const moderation = msgData.moderation || {};
          const categories = moderation.categories || {};
          const flagged = moderation.flagged;

          // Check if flagged or any category is true
          const isFlagged =
            flagged ||
            categories.dangerous ||
            categories.harassment ||
            categories.hate ||
            categories.selfHarm ||
            categories.sexual ||
            categories.violence;

          if (isFlagged && !moderation.reviewed) {
            // Get sender info
            const senderData = await getUserInfo(msgData.senderId);

            flaggedNotifs.push({
              type: "flagged",
              messageId: msgDoc.id,
              supportGroupName: sgData.supportgroup_name || "Unknown Group",
              groupChatName: gc.name || "Unknown Chat",
              senderType: senderData.userType || "Unknown",
              senderName: senderData.name || "Unknown",
              senderEmail: senderData.email || "",
              student: senderData.name || "Unknown",
              studentEmail: senderData.email || "",
              peer: "Support Group Member",
              preview: msgData.message?.substring(0, 50) || "",
              timestamp: formatTimestamp(msgData.timestamp),
              supportGroupId: sgDoc.id,
              groupChatId: gc.groupchatId
            });
          }
        }
      }
    }
  } catch (error) {
    console.error("Error checking support group flagged messages:", error);
  }
}

/**
 * Check RTDB for flagged peer-to-peer messages
 */
async function checkRTDBFlaggedMessages(flaggedNotifs) {
  try {
    const messagesRef = ref(rtdb, "messages");
    const snapshot = await get(messagesRef);

    if (!snapshot.exists()) return;

    const sessions = snapshot.val();

    for (const sessionId in sessions) {
      const session = sessions[sessionId];
      
      // Get peer and student IDs from session
      const peerId = session.peerId;
      const studentId = session.studentId;
      
      if (!peerId || !studentId) continue;

      const messages = session.messages || {};

      for (const msgNum in messages) {
        const msg = messages[msgNum];
        const moderation = msg.moderation || {};
        const categories = moderation.categories || {};
        const flagged = moderation.flagged;

        const isFlagged =
          flagged ||
          categories.dangerous ||
          categories.harassment ||
          categories.hate ||
          categories.selfHarm ||
          categories.sexual ||
          categories.violence;

        if (isFlagged && !moderation.reviewed) {
          // Get peer and student info
          const peerData = await getUserInfo(peerId);
          const studentData = await getUserInfo(studentId);

          flaggedNotifs.push({
            type: "flagged",
            messageId: `${sessionId}_${msgNum}`,
            isPeerToPeer: true,
            peerName: peerData.name || "Unknown Peer",
            studentName: studentData.name || "Unknown Student",
            student: studentData.name || "Unknown Student",
            studentEmail: studentData.email || "",
            peer: peerData.name || "Unknown Peer",
            preview: msg.message?.substring(0, 50) || "",
            timestamp: formatTimestamp(msg.timestamp),
            sessionId: sessionId
          });
        }
      }
    }
  } catch (error) {
    console.error("RTDB flagged messages error:", error);
  }
}

/**
 * Listen for referral submissions
 */
async function listenForReferrals() {
  const referralsRef = collection(db, "referral_submission");

  unsubscribeReferrals = onSnapshot(referralsRef, async (snapshot) => {
    const referralNotifs = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();

      // Get student and peer info
      const studentData = await getUserInfo(data.studentUid);
      const peerData = await getUserInfo(data.submitted_by);

      referralNotifs.push({
        type: "referral",
        referralId: docSnap.id,
        student: studentData.name || "Unknown Student",
        studentEmail: studentData.email || "",
        peer: peerData.name || "Unknown Peer",
        reason: data.reason || "No reason provided",
        timestamp: formatTimestamp(data.date_submitted),
        messageId: data.messageId,
        studentUid: data.studentUid,
        peerUid: data.submitted_by
      });
    }

    updateNotifications("referral", referralNotifs);
  }, (error) => {
    console.error("Referrals listener error:", error);
  });
}

/**
 * Get user info from account_details
 */
async function getUserInfo(uid) {
  if (!uid) return { name: "Unknown", email: "", userType: "unknown" };

  try {
    const userDoc = await getDoc(doc(db, "account_details", uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      return {
        name: `${data.fname || ""} ${data.lname || ""}`.trim() || "Unknown",
        email: data.email || "",
        userType: data.userType || "unknown"
      };
    }
  } catch (error) {
    console.error("Error fetching user info:", error);
  }

  return { name: "Unknown", email: "", userType: "unknown" };
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return "Just now";

  try {
    let date;
    
    if (timestamp.toDate) {
      date = timestamp.toDate();
    } else if (typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else {
      date = new Date(timestamp);
    }

    const now = new Date();
    const diff = now - date;
    
    // Less than 1 minute
    if (diff < 60000) return "Just now";
    
    // Less than 1 hour
    if (diff < 3600000) {
      const mins = Math.floor(diff / 60000);
      return `${mins} minute${mins > 1 ? 's' : ''} ago`;
    }
    
    // Today
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }
    
    // This week
    if (diff < 604800000) {
      return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    }
    
    // Older
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (error) {
    console.error("Error formatting timestamp:", error);
    return "Just now";
  }
}

/**
 * Update notifications of a specific type
 */
function updateNotifications(type, notifs) {
  // Remove old notifications of this type
  allNotifications = allNotifications.filter(n => n.type !== type);
  
  // Add new notifications
  allNotifications = [...allNotifications, ...notifs];
  
  // Sort by timestamp (newest first)
  allNotifications.sort((a, b) => {
    const timeA = a.timestamp instanceof Date ? a.timestamp : new Date(a.timestamp);
    const timeB = b.timestamp instanceof Date ? b.timestamp : new Date(b.timestamp);
    return timeB - timeA;
  });
  
  // Render
  renderNotifications(allNotifications);
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
  if (!notifContainer || !notifContainer.contains(e.target)) {
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
   Rendering
============================ */
export function renderNotifications(notifications = []) {
  const content = notifMenu?.querySelector(".notif-content");
  if (!content) return;

  content.innerHTML = "";

  if (notifications.length === 0) {
    content.innerHTML = `
      <div style="padding: 20px; text-align: center; color: #888;">
        No notifications
      </div>
    `;
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
  div.dataset.uid = data.uid;

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

  const locationInfo = data.isPeerToPeer 
    ? "Peer-to-Peer Chat"
    : `${escapeHtml(data.supportGroupName)} - ${escapeHtml(data.groupChatName)}`;

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
          <span class="participant-label">Location:</span>
          <span class="participant-name" style="margin-left:-45px;">${locationInfo}</span>
        </div>
        <div class="participant-row">
          <span class="participant-label">Student:</span>
          <span class="participant-name" style="margin-left:-70px;">${escapeHtml(data.student)}</span>
        </div>
        <div class="participant-row" style="margin-left: 59px;">
          <span style="font-size:11px;color:#888;">${escapeHtml(data.studentEmail)}</span>
        </div>
        <div class="participant-row">
          <span class="participant-label">Peer Facilitator:</span>
          <span class="participant-name" style="margin-left:-25px;">${escapeHtml(data.peer)}</span>
        </div>
      </div>
      <div class="conversation-preview">
        "${escapeHtml(data.preview)}"
      </div>
      <div class="timestamp">${data.timestamp}</div>
    </div>
    <div class="notif-buttons">
      <button class="btn-export" onclick="exportConversation('${data.messageId}', ${data.isPeerToPeer})">Export Chat</button>
    </div>
  `;

  return div;
}

function buildReferralCard(data) {
  const div = document.createElement("div");
  div.className = "notif-card";

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
        <span class="field-value" style="margin-left:-90px;">${escapeHtml(data.student)}</span>
      </div>
      <div class="referral-field" style="margin-left: 57px;">
        <span class="field-value" style="font-size:11px;color:#888;">
          ${escapeHtml(data.studentEmail)}
        </span>
      </div>
      <div class="referral-field">
        <span class="field-label">Peer Facilitator:</span>
        <span class="field-value" style="margin-left:-45px;">${escapeHtml(data.peer)}</span>
      </div>
      <div class="referral-reason">
        <span class="field-label">Reason for Referral:</span>
        <p class="reason-text">
          ${escapeHtml(data.reason)}
        </p>
      </div>
      <div class="timestamp">${data.timestamp}</div>
    </div>
    <div class="notif-buttons">
      <button class="btn-export" onclick="exportReferralChat('${data.referralId}')">Export Chat</button>
    </div>
  `;

  return div;
}

/* ============================
   Action handlers
============================ */

window.handleVerificationAction = async (action, uid) => {
  if (!uid) return;

  try {
    const userRef = doc(db, "account_details", uid);
    const newStatus = action === 'accept' ? 'verified' : 'not_verified';
    
    await updateDoc(userRef, {
      isVerified: newStatus
    });

    alert(`Peer facilitator ${action === 'accept' ? 'verified' : 'declined'} successfully`);
    
    // Remove the notification card from UI
    const card = document.querySelector(`.notif-card[data-uid="${uid}"]`);
    if (card) card.remove();
    
    // Update badge count
    allNotifications = allNotifications.filter(n => !(n.type === 'verification' && n.uid === uid));
    setNotifBadge(allNotifications.length);
  } catch (error) {
    console.error("Error updating verification status:", error);
    alert("Failed to update verification status");
  }
};

window.exportConversation = (messageId, isPeerToPeer) => {
  console.log("Export conversation:", messageId, "isPeerToPeer:", isPeerToPeer);
  alert("Export functionality coming soon!");
};

window.exportReferralChat = (referralId) => {
  console.log("Export referral chat:", referralId);
  alert("Export functionality coming soon!");
};

/* ============================
   Cleanup
============================ */
export function destroyNotificationListener() {
  if (unsubscribeVerification) {
    unsubscribeVerification();
    unsubscribeVerification = null;
  }
  if (unsubscribeReferrals) {
    unsubscribeReferrals();
    unsubscribeReferrals = null;
  }
  allNotifications = [];
}

/* ============================
   Utility
============================ */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}