// log_reader.js - Display Logs in UI
import { db } from "./auth.js";
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

// Cache to avoid repeated user lookups
const userCache = new Map();

/**
 * Get user display name and avatar
 */
async function getUserInfo(uid) {
  if (!uid) return { name: "System", avatar: "photos/pic_placeholder.png" };
  if (userCache.has(uid)) return userCache.get(uid);
  
  try {
    const snap = await getDoc(doc(db, "account_details", uid));
    if (snap.exists()) {
      const data = snap.data();
      const fname = data.fname || data.firstName || "";
      const lname = data.lname || data.lastName || "";
      const name = data.name || `${lname}, ${fname}`.trim() || "Unknown User";
      const avatar = resolveAvatarUrl(data.avatarUrl);
      
      const info = { name, avatar };
      userCache.set(uid, info);
      return info;
    }
  } catch (error) {
    console.error("Error fetching user info:", error);
  }
  
  return { name: "Unknown User", avatar: "photos/pic_placeholder.png" };
}

/**
 * Resolve avatar URL
 */
function resolveAvatarUrl(url) {
  if (!url) return "photos/pic_placeholder.png";
  if (url.startsWith("image_")) {
    const map = {
      image_1: "photos/avatar_panda.png",
      image_2: "photos/avatar_butterfly.png",
      image_3: "photos/avatar_wolf.png",
      image_4: "photos/avatar_buffalo.png"
    };
    return map[url] || "photos/pic_placeholder.png";
  }
  if (url.startsWith("http")) {
    return `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  }
  return url;
}

/**
 * Format timestamp
 */
function formatTime(timestamp) {
  if (!timestamp) return "Unknown time";
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric"
    }) + " at " + date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  } catch (error) {
    return "Invalid date";
  }
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

/**
 * Render logs into a container
 */
async function renderLogs(logs, container) {
  if (!container) return;
  
  container.innerHTML = "";
  
  if (logs.length === 0) {
    container.innerHTML = `
      <div class="log-entry" style="text-align:center; color:#888; padding:20px;">
        No logs available
      </div>
    `;
    return;
  }
  
  for (const logData of logs) {
    const user = await getUserInfo(logData.log_by);
    
    const entry = document.createElement("div");
    entry.className = "log-entry";
    
    entry.innerHTML = `
      <img src="${user.avatar}" class="avatar" alt="Avatar" onerror="this.src='photos/pic_placeholder.png'">
      <div class="log-top">
        <span class="log-name">${escapeHtml(user.name)}</span>
        <span class="log-time">${formatTime(logData.log_date)}</span>
      </div>
      <div class="log-message">
        ${escapeHtml(logData.log_data)}
      </div>
    `;
    
    container.appendChild(entry);
  }
}

/**
 * Fetch logs from Firebase
 */
async function fetchLogs(role, limitCount = 10) {
  try {
    const q = query(
      collection(db, "Logs"),
      where("log_representedby", "==", role),
      orderBy("log_date", "desc"),
      limit(limitCount)
    );
    
    const snapshot = await getDocs(q);
    const logs = [];
    
    snapshot.forEach((doc) => {
      logs.push({ id: doc.id, ...doc.data() });
    });
    
    return logs;
  } catch (error) {
    console.error(`Error fetching ${role} logs:`, error);
    return [];
  }
}

// ========================================
// GCO.HTML - SETTINGS AND SYSTEM LOGS PAGE
// ========================================

/**
 * FOR GCO.HTML -> Settings and System Logs Page -> GCO Coordinator Logs
 * Shows logs where log_representedby = "gco"
 * 
 * HTML ID: Find the container in GCO.html under "Settings and System Logs"
 * The first .card with <h3>GCO Coordinator Logs</h3>
 * Give the .logs-list div an id like "gcoCoordinatorLogsContainer"
 */
export async function loadGCOCoordinatorLogs(containerId = "gcoCoordinatorLogsContainer", limitCount = 10) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Container ${containerId} not found`);
    return;
  }
  
  const logs = await fetchLogs("gco", limitCount);
  await renderLogs(logs, container);
}

/**
 * FOR GCO.HTML -> Settings and System Logs Page -> Peer Facilitator Logs
 * Shows logs where log_representedby = "peer"
 * 
 * HTML ID: The second .card with <h3>Peer Facilitator Logs</h3>
 * Give the .logs-list div an id like "peerFacilitatorLogsContainer"
 */
export async function loadPeerFacilitatorLogs(containerId = "peerFacilitatorLogsContainer", limitCount = 10) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Container ${containerId} not found`);
    return;
  }
  
  const logs = await fetchLogs("peer", limitCount);
  await renderLogs(logs, container);
}

// ========================================
// GCO.HTML - REPORTS PAGE
// ========================================

/**
 * FOR GCO.HTML -> Reports Page -> System Updates
 * Shows logs where log_representedby = "admin"
 * 
 * HTML ID: In the Reports page, find <h3>System Updates</h3>
 * Give the .leftscroll div an id like "gcoReportsSystemUpdates"
 */
export async function loadGCOReportsSystemUpdates(containerId = "gcoReportsSystemUpdates", limitCount = 10) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Container ${containerId} not found`);
    return;
  }
  
  const logs = await fetchLogs("admin", limitCount);
  await renderLogs(logs, container);
}

// ========================================
// IT_Admin.HTML - REPORTS PAGE
// ========================================

/**
 * FOR IT_Admin.HTML -> Reports Page -> GCO Reports
 * Shows logs where log_representedby = "gco"
 * 
 * HTML ID: In the Reports page, find <h3>GCO Reports</h3>
 * Give the .leftscroll div an id like "itAdminGCOReports"
 */
export async function loadITAdminGCOReports(containerId = "itAdminGCOReports", limitCount = 10) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Container ${containerId} not found`);
    return;
  }
  
  const logs = await fetchLogs("gco", limitCount);
  await renderLogs(logs, container);
}

/**
 * FOR IT_Admin.HTML -> Reports Page -> System Updates
 * Shows logs where log_representedby = "admin"
 * 
 * HTML ID: Find <h3>System Updates</h3>
 * Give the .leftscroll div an id like "itAdminSystemUpdates"
 */
export async function loadITAdminSystemUpdates(containerId = "itAdminSystemUpdates", limitCount = 10) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Container ${containerId} not found`);
    return;
  }
  
  const logs = await fetchLogs("admin", limitCount);
  await renderLogs(logs, container);
}

export default {
  loadGCOCoordinatorLogs,
  loadPeerFacilitatorLogs,
  loadGCOReportsSystemUpdates,
  loadITAdminGCOReports,
  loadITAdminSystemUpdates
};