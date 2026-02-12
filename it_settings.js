// it_settings.js - IT Admin Settings Management
import { db, auth } from "./auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  orderBy,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { logAdmin } from "./logger.js";

// Cache for terms and privacy
let termsContent = "";
let privacyContent = "";

/**
 * Initialize IT Settings
 */
export async function initializeITSettings() {
  console.log("Initializing IT Settings...");
  
  // Load Terms and Privacy Policy
  await loadTermsAndConditions();
  await loadPrivacyPolicy();
  
  // Setup modal handlers
  setupModalHandlers();
  
  // Setup Support Group Management
  await loadSupportGroups();
}

/**
 * Load Terms and Conditions from Firestore
 */
async function loadTermsAndConditions() {
  try {
    const docRef = doc(db, "TermsAndPrivacy", "TermsAndConditions");
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      termsContent = data.content || "<p>No terms and conditions set.</p>";
    } else {
      termsContent = "<p>No terms and conditions set.</p>";
    }
    
  } catch (error) {
    console.error("Error loading Terms and Conditions:", error);
    termsContent = "<p>Error loading terms and conditions.</p>";
  }
}

/**
 * Load Privacy Policy from Firestore
 */
async function loadPrivacyPolicy() {
  try {
    const docRef = doc(db, "TermsAndPrivacy", "PrivacyPolicy");
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      privacyContent = data.content || "<p>No privacy policy set.</p>";
    } else {
      privacyContent = "<p>No privacy policy set.</p>";
    }
    
  } catch (error) {
    console.error("Error loading Privacy Policy:", error);
    privacyContent = "<p>Error loading privacy policy.</p>";
  }
}

/**
 * Setup modal handlers
 */
function setupModalHandlers() {
  // Terms Modal
  window.openTermsModal = openTermsModal;
  window.closeTermsModal = closeTermsModal;
  window.saveTerms = saveTerms;
  
  // Support Group Modal
  window.openSupportGroupModal = openSupportGroupModal;
  window.closeSupportGroupModal = closeSupportGroupModal;
  window.deleteSupportGroup = deleteSupportGroup;
}

/**
 * Open Terms/Privacy Modal
 */
function openTermsModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  
  const termsBox = modal.querySelector('.terms-box');
  if (!termsBox) return;
  
  // Load appropriate content
  if (modalId === 'termsModal') {
    termsBox.innerHTML = termsContent;
  } else if (modalId === 'privacyModal') {
    termsBox.innerHTML = privacyContent;
  }
  
  // Make editable
  termsBox.setAttribute('contenteditable', 'true');
  
  modal.style.display = 'block';
}

/**
 * Close Terms/Privacy Modal
 */
function closeTermsModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Save Terms or Privacy content
 */
async function saveTerms() {
  const termsModal = document.getElementById('termsModal');
  const privacyModal = document.getElementById('privacyModal');
  
  let modalToSave = null;
  let docId = null;
  let content = null;
  
  // Determine which modal is open
  if (termsModal && termsModal.style.display === 'block') {
    modalToSave = termsModal;
    docId = 'TermsAndConditions';
    const termsBox = termsModal.querySelector('.terms-box');
    content = termsBox ? termsBox.innerHTML : null;
  } else if (privacyModal && privacyModal.style.display === 'block') {
    modalToSave = privacyModal;
    docId = 'PrivacyPolicy';
    const privacyBox = privacyModal.querySelector('.terms-box');
    content = privacyBox ? privacyBox.innerHTML : null;
  }
  
  if (!modalToSave || !docId || !content) {
    alert('No content to save');
    return;
  }
  
  const saveBtn = modalToSave.querySelector('.save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    const docRef = doc(db, "TermsAndPrivacy", docId);
    await setDoc(docRef, {
      content: content,
      lastUpdated: new Date(),
      updatedBy: auth.currentUser?.uid || 'unknown'
    }, { merge: true });
    
    // Update cache
    if (docId === 'TermsAndConditions') {
      termsContent = content;
    } else {
      privacyContent = content;
    }
    
    alert('Saved successfully!');
    closeTermsModal(modalToSave.id);
    
  } catch (error) {
    console.error('Error saving:', error);
    alert('Failed to save: ' + error.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
      await logAdmin("settings", "Updated Terms and Conditions");
    }
  }
}

/**
 * Load Support Groups
 */
async function loadSupportGroups() {
  try {
    const groupsRef = collection(db, "supportgroup");
    const q = query(groupsRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    
    const groups = [];
    snapshot.forEach((doc) => {
      groups.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    renderSupportGroups(groups);
    
  } catch (error) {
    console.error("Error loading support groups:", error);
  }
}

/**
 * Render Support Groups in modal
 */
function renderSupportGroups(groups) {
  const container = document.getElementById('supportGroupList');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (groups.length === 0) {
    container.innerHTML = `
      <div class="emptyState">
        <div style="font-size: 60px; margin-bottom: 15px;">🔭</div>
        <div class="emptyStateText">No support groups available</div>
      </div>
    `;
    return;
  }
  
  groups.forEach(group => {
    const item = document.createElement('div');
    item.className = 'supportGroupItem';
    item.dataset.groupId = group.id;
    
    const name = group.supportgroup_name || 'Unnamed Group';
    const memberCount = Array.isArray(group.member_list) ? group.member_list.length : 0;
    const pfpUrl = group.supportgroup_pfp_URL || 'photos/suppGroup_placeholder.png';
    
    item.innerHTML = `
      <div class="supportGroupInfo">
        <div class="supportGroupIcon">
          <img src="${pfpUrl}" alt="${escapeHtml(name)}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;">
        </div>
        <div class="supportGroupDetails">
          <div class="supportGroupName">${escapeHtml(name)}</div>
          <div class="supportGroupMembers">${memberCount} Members</div>
        </div>
      </div>
      <button class="deleteBtn" onclick="window.deleteSupportGroup('${group.id}', '${escapeHtml(name)}')">Delete</button>
    `;
    
    container.appendChild(item);
  });
}

/**
 * Open Support Group Management Modal
 */
function openSupportGroupModal() {
  const modal = document.getElementById('supportGroupModal');
  if (modal) {
    loadSupportGroups(); // Refresh list
    modal.style.display = 'block';
  }
}

/**
 * Close Support Group Management Modal
 */
function closeSupportGroupModal() {
  const modal = document.getElementById('supportGroupModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Delete Support Group
 */
async function deleteSupportGroup(groupId, groupName) {
  if (!confirm(`Are you sure you want to delete "${groupName}"? This action cannot be undone.`)) {
    return;
  }
  
  try {
    const groupRef = doc(db, "supportgroup", groupId);
    await deleteDoc(groupRef);
    
    alert(`"${groupName}" has been deleted successfully.`);
    await logAdmin("support_group", `Deleted support group: ${groupName}`);
    
    // Remove from UI
    const item = document.querySelector(`.supportGroupItem[data-group-id="${groupId}"]`);
    if (item) {
      item.style.opacity = '0';
      item.style.transform = 'translateX(-20px)';
      setTimeout(() => {
        item.remove();
        checkEmptyState();
      }, 300);
    }
    
  } catch (error) {
    console.error('Error deleting support group:', error);
    alert('Failed to delete support group: ' + error.message);
  }
}

/**
 * Check if support groups list is empty
 */
function checkEmptyState() {
  const container = document.getElementById('supportGroupList');
  if (container && container.children.length === 0) {
    container.innerHTML = `
      <div class="emptyState">
        <div style="font-size: 60px; margin-bottom: 15px;">🔭</div>
        <div class="emptyStateText">No support groups available</div>
      </div>
    `;
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Cleanup
 */
export function cleanupITSettings() {
  termsContent = "";
  privacyContent = "";
}

export default {
  initializeITSettings,
  cleanupITSettings
};
