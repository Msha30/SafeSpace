// notification.js
import { db, auth } from "./auth.js";


let notifMenu;
let notifBadge;

/* ============================
   Initialization
============================ */
export function initNotifications() {
  notifMenu = document.getElementById("notifMenu");
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

  notifBadge.textContent = count;

  if (count <= 0) {
    notifBadge.style.display = "none";
  } else {
    notifBadge.style.display = "inline-flex";
  }
}

/* ============================
   Rendering scaffold
============================ */
/**
 * Future-proof renderer
 * For now, this just exists so you don’t bake logic into the page script
 */
export function renderNotifications(notifications = []) {
  const content = notifMenu?.querySelector(".notif-content");
  if (!content) return;

  content.innerHTML = "";

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
   Card builders (static for now)
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
      ${data.name}<br>
      <span>${data.email}</span>
    </p>
    <div class="notif-buttons">
      <button class="btn-decline" onclick="handleVerificationAction('decline')">Decline</button>
      <button class="btn-accept" onclick="handleVerificationAction('accept')">Accept</button>
    </div>
  `;

  return div;
}

function buildFlaggedCard(data) {
  const div = document.createElement("div");
  div.className = "notif-card";

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
          <span class="participant-name">${data.student}</span>
        </div>
        <div class="participant-row">
          <span style="font-size:11px;color:#888;">${data.studentEmail}</span>
        </div>
        <div class="participant-row">
          <span class="participant-label">Peer Facilitator:</span>
          <span class="participant-name">${data.peer}</span>
        </div>
      </div>
      <div class="conversation-preview">
        "${data.preview}"
      </div>
      <div class="timestamp">${data.timestamp}</div>
    </div>
    <div class="notif-buttons">
      <button class="btn-export" onclick="exportConversation()">Export Chat</button>
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
        <span class="field-value">${data.student}</span>
      </div>
      <div class="referral-field">
        <span class="field-value" style="font-size:11px;color:#888;">
          ${data.studentEmail}
        </span>
      </div>
      <div class="referral-field">
        <span class="field-label">Peer Facilitator:</span>
        <span class="field-value">${data.peer}</span>
      </div>
      <div class="referral-reason">
        <span class="field-label">Reason for Referral:</span>
        <p class="reason-text">${data.reason}</p>
      </div>
      <div class="timestamp">${data.timestamp}</div>
    </div>
    <div class="notif-buttons">
      <button class="btn-export" onclick="exportReferralChat()">Export Chat</button>
    </div>
  `;

  return div;
}

/* ============================
   Placeholder global handlers
   (same style as your page)
============================ */

window.handleVerificationAction = (action) => {
  console.log("Verification action:", action);
};

window.exportConversation = () => {
  console.log("Export conversation clicked");
};

window.exportReferralChat = () => {
  console.log("Export referral chat clicked");
};
