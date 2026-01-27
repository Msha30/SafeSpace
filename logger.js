// logger.js - Universal Logging System
// Import this in any file to easily create logs
import { db, auth } from "./auth.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/**
 * Create a log entry - THIS IS THE MAIN FUNCTION YOU'LL USE
 * 
 * @param {Object} params
 * @param {string} params.representedBy - "admin", "gco", or "peer" (auto-detects if not provided)
 * @param {string} params.type - Any string for filtering (e.g., "user_management", "task", "announcement")
 * @param {string} params.data - The actual log message
 * @returns {Promise<string>} - Document ID
 * 
 * @example
 * import { log } from "./logger.js";
 * await log({ type: "user_created", data: "Created user John Doe" });
 */
export async function log({ representedBy, type, data }) {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.warn("Cannot log: No user authenticated");
      return null;
    }
    
    // Auto-detect role if not provided
    let role = representedBy;
    if (!role) {
      role = await detectUserRole(currentUser.uid);
    }
    
    const logEntry = {
      log_date: serverTimestamp(),
      log_by: currentUser.uid,
      log_representedby: role.toLowerCase(),
      log_type: type,
      log_data: data
    };
    
    const docRef = await addDoc(collection(db, "Logs"), logEntry);
    console.log("✓ Log created:", logEntry.log_data);
    return docRef.id;
    
  } catch (error) {
    console.error("Failed to create log:", error);
    return null;
  }
}

/**
 * Detect user role from Firebase
 */
async function detectUserRole(uid) {
  try {
    const userDoc = await getDoc(doc(db, "account_details", uid));
    if (userDoc.exists()) {
      const userType = userDoc.data().userType || userDoc.data().role || "user";
      return userType.toLowerCase();
    }
  } catch (error) {
    console.warn("Could not detect user role:", error);
  }
  return "user";
}

// ============ CONVENIENCE FUNCTIONS ============
// Use these for common actions to save typing

export async function logAdmin(type, data) {
  return log({ representedBy: "admin", type, data });
}

export async function logGCO(type, data) {
  return log({ representedBy: "gco", type, data });
}

export async function logPeer(type, data) {
  return log({ representedBy: "peer", type, data });
}

// Common log types - use these or create your own strings
export const LOG_TYPES = {
  USER: "user_management",
  TASK: "task",
  ANNOUNCEMENT: "announcement",
  SETTINGS: "settings",
  SUPPORT_GROUP: "support_group",
  COUNSELING: "counseling",
  REPORT: "report",
  SYSTEM: "system"
};

export default { log, logAdmin, logGCO, logPeer, LOG_TYPES };