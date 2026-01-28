// it_usermanagement.js - IT Admin User Management (UPDATED VERSION)
import { db, auth, rtdb } from "./auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  createUserWithEmailAndPassword,
  deleteUser as authDeleteUser
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
// Import RTDB functions
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { logAdmin } from "./logger.js";

// Cache
let usersCache = [];
let usersListener = null;

// Track RTDB presence listeners we already attached to avoid duplicates
const observedPresence = new Set();

/**
 * Initialize IT User Management
 */
export async function initializeITUserManagement() {
  console.log("Initializing IT User Management...");
  
  // Setup real-time listener
  setupUsersListener();
  
  // Setup search and filter
  setupSearchAndFilter();
  
  // Setup modal handlers
  setupModalHandlers();
}

/**
 * Setup real-time listener for all users
 */
function setupUsersListener() {
  try {
    const usersRef = collection(db, "account_details");
    // Don't order by createdAt initially as some documents might not have it
    const q = query(usersRef);
    
    usersListener = onSnapshot(q, (snapshot) => {
      usersCache = [];
      snapshot.forEach((doc) => {
        const userData = doc.data();
        // Only add if user has required fields
        if (userData && (userData.email || userData.fname || userData.lname)) {
          usersCache.push({
            id: doc.id,
            uid: doc.id,
            ...userData
          });
        }
      });
      
      // Sort by createdAt after loading (handle missing dates)
      usersCache.sort((a, b) => {
        const aTime = a.createdAt?.toMillis?.() || 0;
        const bTime = b.createdAt?.toMillis?.() || 0;
        return bTime - aTime;
      });
      
      console.log(`Loaded ${usersCache.length} users`);
      console.log('User types found:', [...new Set(usersCache.map(u => u.userType || u.role))]);
      renderUsers(usersCache);
      
      // Start watching last active times for these users via RTDB
      watchUserPresence(usersCache);
      
    }, (error) => {
      console.error("Error listening to users:", error);
    });
    
  } catch (error) {
    console.error("Failed to setup users listener:", error);
  }
}

/**
 * Render users in the table
 */
function renderUsers(users) {
  const tbody = document.querySelector('#itAdminUsers');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  if (users.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 20px; color: #888;">
          No users found
        </td>
      </tr>
    `;
    return;
  }
  
  users.forEach(user => {
    const row = createUserRow(user);
    tbody.appendChild(row);
  });
}

/**
 * Create a user table row
 */
function createUserRow(user) {
  const row = document.createElement('tr');
  // IMPORTANT: Set data-user-id so RTDB updater can find this row
  row.dataset.userId = user.uid || user.id;
  row.setAttribute('data-user-id', user.uid || user.id); // Ensure consistency with selector
  
  const fullName = `${user.lname || ''}, ${user.fname || ''}`.trim() || 'N/A';
  const displayName = user.username || user.fname || 'N/A';
  const email = user.email || 'N/A';
  const userType = user.userType || user.role || 'student';
  const studentId = user.studentId || 'N/A';
  
  // Format dates
  const createdDate = formatDate(user.createdAt);
  const lastActive = user.lastActive || 'N/A';
  
  // Get user type badge
  const badgeClass = getUserTypeBadgeClass(userType);
  const typeName = getUserTypeDisplayName(userType);
  
  // Get avatar
  const avatarUrl = resolveAvatarUrl(user.avatarUrl);
  
  row.innerHTML = `
    <td class="table_user">
      <img src="${avatarUrl}" alt="${fullName}" onerror="this.src='photos/pic_placeholder.png'">
    </td>
    <td class="name">
      ${fullName}<br>
      <span>${email}</span>
    </td>
    <td></td>
    <td>${displayName}</td>
    <td>
      <div class="${badgeClass}">
        ${typeName}
      </div>
    </td>
    <!-- Added class="lastActive" here for targeting -->
    <td class="lastActive">${normalizeLastActiveForDisplay(lastActive)}</td>
    <td>${createdDate}</td>
    <td class="action">
      <div class="dpDots">
        <button class="menu-dots" onclick="window.toggleDpDots(this)">⋮</button>
        <div class="dropdown-content">
          <a href="#" onclick="window.openEditUserPopup('${user.uid || user.id}')">Edit</a>
          <a href="#" class="remove" onclick="window.openRemovePopup('${user.uid || user.id}', '${fullName}')">Remove User</a>
        </div>
      </div>
    </td>
  `;
  
  return row;
}

// --- RTDB Presence Logic (Mirrored from userManagement.js) ---

export function watchUserPresence(users) {
  if (!rtdb) {
    console.warn("RTDB not initialized. Cannot watch presence.");
    return;
  }

  if (!users || users.length === 0) return;

  users.forEach((user) => {
    const uid = user.id || user.uid;
    if (!uid) return;

    // Avoid attaching multiple listeners for same uid
    if (observedPresence.has(uid)) return;
    observedPresence.add(uid);

    // Path: status > {uid} > last_changed
    const statusRef = ref(rtdb, `status/${uid}/last_changed`);

    onValue(statusRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      let timestamp = null;
      let state = null;

      if (typeof data === 'number') {
        timestamp = data;
      } else if (typeof data === 'string' && !isNaN(Number(data))) {
        timestamp = Number(data);
      } else if (typeof data === 'object') {
        Object.entries(data).forEach(([k, v]) => {
          if (k === 'state') {
            state = v;
          }
          if (typeof v === 'number' && (!timestamp || v > timestamp)) {
            timestamp = v;
          }
          const keyNum = Number(k);
          if (!isNaN(keyNum) && (!timestamp || keyNum > timestamp)) {
            timestamp = keyNum;
          }
        });
      }

      let displayText = 'Offline';
      if (timestamp && timestamp > 0) {
        try {
          const date = new Date(timestamp);
          displayText = date.toLocaleDateString('en-US', {
             year: 'numeric', month: 'long', day: 'numeric'
          });
        } catch (e) {
          displayText = String(timestamp);
        }
      } else if (state === 'online') {
        displayText = 'Online';
      }

      // Update Cache (usersCache)
      try {
        const userIndex = usersCache ? usersCache.findIndex(u => (u.id || u.uid) === uid) : -1;
        if (userIndex !== -1) {
          usersCache[userIndex].lastActive = displayText;
        }
      } catch (e) { console.warn(e); }

      // Update DOM
      updateUserRowInDOM(uid, displayText);

    }, (err) => {
      console.error("RTDB presence listener error for uid=" + uid, err);
    });
  });
}

function updateUserRowInDOM(userId, newStatusText) {
  // Selector uses the attribute we set in createUserRow
  const rows = document.querySelectorAll(`tr[data-user-id="${userId}"]`);
  if (!rows || rows.length === 0) return;

  rows.forEach(row => {
    // Prefer the class selector added in createUserRow
    const lastActiveCell = row.querySelector('.lastActive');
    if (lastActiveCell) {
      lastActiveCell.textContent = normalizeLastActiveForDisplay(newStatusText);
      return;
    }
  });
}

function normalizeLastActiveForDisplay(value) {
  if (!value) return "—";
  const s = String(value).trim();
  if (s === "" || s.toUpperCase() === "N/A") return "—";
  return s;
}

// -----------------------------------------------------------

/**
 * Setup search and filter functionality
 */
function setupSearchAndFilter() {
  const searchInput = document.getElementById('itUserSearch');
  const filterSelect = document.querySelector('.userdrop');
  
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const searchTerm = e.target.value.toLowerCase();
      const filterValue = filterSelect ? filterSelect.value : 'All';
      
      const filtered = filterUsers(usersCache, searchTerm, filterValue);
      renderUsers(filtered);
    });
  }
  
  if (filterSelect) {
    filterSelect.addEventListener('change', (e) => {
      const filterValue = e.target.value;
      const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
      
      const filtered = filterUsers(usersCache, searchTerm, filterValue);
      renderUsers(filtered);
    });
  }
}

/**
 * Filter users by search term and type
 */
function filterUsers(users, searchTerm, filterValue) {
  let filtered = [...users];
  
  // Filter by type
  if (filterValue && filterValue !== 'All') {
    const typeMap = {
      'Peers': 'peer',
      'Users': 'student',
      'GCO': 'gco',
      'Admin': 'admin'
    };
    const userType = typeMap[filterValue];
    if (userType) {
      filtered = filtered.filter(u => {
        const uType = (u.userType || u.role || '').toLowerCase();
        return uType === userType;
      });
    }
  }
  
  // Filter by search term
  if (searchTerm) {
    filtered = filtered.filter(u => {
      const fullName = `${u.lname || ''} ${u.fname || ''}`.toLowerCase();
      const email = (u.email || '').toLowerCase();
      const studentId = (u.studentId || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      
      return fullName.includes(searchTerm) ||
             email.includes(searchTerm) ||
             studentId.includes(searchTerm) ||
             username.includes(searchTerm);
    });
  }
  
  return filtered;
}

/**
 * Setup modal handlers
 */
function setupModalHandlers() {
  // Create User Modal
  window.openCreateUserPopup = openCreateUserPopup;
  window.closeCreateUserPopup = closeCreateUserPopup;
  window.updateDisplayName = updateDisplayName;
  window.showConfirmPopup = showConfirmPopup;
  window.closeConfirmPopup = closeConfirmPopup;
  window.confirmCreateUser = confirmCreateUser;
  
  // Edit User Modal
  window.openEditUserPopup = openEditUserPopup;
  window.closeEditUserPopup = closeEditUserPopup;
  window.showEditSaveBtn = showEditSaveBtn;
  window.updateEditDisplayName = updateEditDisplayName;
  window.saveEditUser = saveEditUser;
  
  // Remove User Modal
  window.openRemovePopup = openRemovePopup;
  window.closeRemovePopup = closeRemovePopup;
  window.confirmRemoveUser = confirmRemoveUser;
  
  // Dropdown toggle
  window.toggleDpDots = toggleDpDots;
}

/**
 * Open Create User Modal
 */
function openCreateUserPopup() {
  const modal = document.getElementById('createUserPopup');
  if (modal) {
    modal.classList.add('active');
    
    // Clear form
    document.getElementById('firstName').value = '';
    document.getElementById('middleName').value = '';
    document.getElementById('lastName').value = '';
    document.getElementById('workEmail').value = '';
    document.getElementById('password').value = '';
    document.getElementById('displayUserName').textContent = '';
  }
}

/**
 * Close Create User Modal
 */
function closeCreateUserPopup() {
  const modal = document.getElementById('createUserPopup');
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Update display name in create modal
 */
function updateDisplayName() {
  const firstName = document.getElementById('firstName').value.trim();
  const middleName = document.getElementById('middleName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  
  if (firstName && lastName) {
    const displayName = middleName
      ? `${lastName}, ${firstName} ${middleName}`
      : `${lastName}, ${firstName}`;
    
    document.getElementById('displayUserName').textContent = displayName;
    document.getElementById('confirmUserName').textContent = displayName;
  }
}

/**
 * Show confirmation popup
 */
function showConfirmPopup() {
  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const email = document.getElementById('workEmail').value.trim();
  const password = document.getElementById('password').value.trim();
  
  if (!firstName || !lastName) {
    alert('Please enter first and last name');
    return;
  }
  
  if (!email) {
    alert('Please enter an email address');
    return;
  }
  
  if (!password || password.length < 6) {
    alert('Please enter a password (at least 6 characters)');
    return;
  }
  
  updateDisplayName();
  document.getElementById('confirmPopup').classList.add('active');
}

/**
 * Close confirmation popup
 */
function closeConfirmPopup() {
  const modal = document.getElementById('confirmPopup');
  if (modal) {
    modal.classList.remove('active');
  }
}

/**
 * Confirm and create new user
 */
async function confirmCreateUser() {
  const firstName = document.getElementById('firstName').value.trim();
  const middleName = document.getElementById('middleName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const email = document.getElementById('workEmail').value.trim();
  const password = document.getElementById('password').value.trim();
  
  const confirmBtn = document.querySelector('.confirmBtnConfirm');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Creating...';
  }
  
  try {
    // Call backend API to create user
    const idToken = sessionStorage.getItem('idToken');
    if (!idToken) {
      throw new Error('Not authenticated');
    }
    
    // UPDATE THIS URL TO YOUR VERCEL DEPLOYMENT URL
    const response = await fetch('https://safe-space-backend.vercel.app/api/create-user.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({
        email,
        password,
        firstName,
        middleName,
        lastName,
        userType: 'gco', // Always create as GCO
        role: 'gco'
      })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to create user');
    }
    
    alert('User created successfully!');
    await logAdmin("user_management", `Created new GCO user: ${email}`);
    closeConfirmPopup();
    closeCreateUserPopup();
    
    // Refresh will happen via listener
    
  } catch (error) {
    console.error('Error creating user:', error);
    alert('Failed to create user: ' + error.message);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm';
    }
  }
}

/**
 * Open Edit User Modal
 */
async function openEditUserPopup(userId) {
  try {
    const user = usersCache.find(u => (u.uid || u.id) === userId);
    if (!user) {
      alert('User not found');
      return;
    }
    
    const modal = document.getElementById('editUserPopup');
    if (!modal) return;
    
    // Store user ID on modal
    modal.dataset.userId = userId;
    
    // Populate fields
    document.getElementById('editFirstName').value = user.fname || '';
    document.getElementById('editMiddleName').value = user.mname || '';
    document.getElementById('editLastName').value = user.lname || '';
    document.getElementById('editSchoolEmail').value = user.email || '';
    document.getElementById('editStudentNo').value = user.studentId || '';
    document.getElementById('editProgram').value = user.program || '';
    document.getElementById('editPreferredName').value = user.username || '';
    
    const userType = user.userType || user.role || 'student';
    document.getElementById('editAccess').value = getUserTypeDisplayName(userType);
    
    const displayName = `${user.lname || ''}, ${user.fname || ''}`.trim();
    document.getElementById('editDisplayUserName').textContent = displayName;
    
    // Set avatar
    const avatar = modal.querySelector('.editUserAvatar');
    if (avatar) {
      avatar.src = resolveAvatarUrl(user.avatarUrl);
    }
    
    // Set dates
    const lastActive = modal.querySelector('.editUserLastActive span');
    if (lastActive) {
      lastActive.textContent = normalizeLastActiveForDisplay(user.lastActive || 'N/A');
    }
    
    const dateCreated = modal.querySelector('.editUserDateCreated span');
    if (dateCreated) {
      dateCreated.textContent = formatDate(user.createdAt);
    }
    
    // Hide save button initially
    document.getElementById('editUserFooter').style.display = 'none';
    
    // Enable all inputs
    document.getElementById('editFirstName').disabled = false;
    document.getElementById('editMiddleName').disabled = false;
    document.getElementById('editLastName').disabled = false;
    document.getElementById('editSchoolEmail').disabled = false;
    document.getElementById('editStudentNo').disabled = false;
    document.getElementById('editProgram').disabled = false;
    document.getElementById('editPreferredName').disabled = false;
    
    modal.classList.add('active');
    
  } catch (error) {
    console.error('Error opening edit modal:', error);
    alert('Failed to load user data');
  }
}

/**
 * Close Edit User Modal
 */
function closeEditUserPopup() {
  const modal = document.getElementById('editUserPopup');
  if (modal) {
    modal.classList.remove('active');
    document.getElementById('editUserFooter').style.display = 'none';
  }
}

/**
 * Show save button when editing
 */
function showEditSaveBtn() {
  document.getElementById('editUserFooter').style.display = 'flex';
}

/**
 * Update display name in edit modal
 */
function updateEditDisplayName() {
  const firstName = document.getElementById('editFirstName').value.trim();
  const middleName = document.getElementById('editMiddleName').value.trim();
  const lastName = document.getElementById('editLastName').value.trim();
  
  if (firstName && lastName) {
    let displayName = `${lastName}, ${firstName}`;
    if (middleName) {
      displayName += ` ${middleName}`;
    }
    document.getElementById('editDisplayUserName').textContent = displayName;
  }
}

/**
 * Save edited user
 */
async function saveEditUser() {
  const modal = document.getElementById('editUserPopup');
  const userId = modal.dataset.userId;
  
  if (!userId) {
    alert('User ID not found');
    return;
  }
  
  const saveBtn = document.querySelector('.editUserBtnSave');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
  }
  
  try {
    const firstName = document.getElementById('editFirstName').value.trim();
    const lastName = document.getElementById('editLastName').value.trim();
    
    const updates = {
      fname: firstName,
      mname: document.getElementById('editMiddleName').value.trim(),
      lname: lastName,
      email: document.getElementById('editSchoolEmail').value.trim(),
      studentId: document.getElementById('editStudentNo').value.trim(),
      program: document.getElementById('editProgram').value.trim(),
      username: document.getElementById('editPreferredName').value.trim()
    };
    
    const userRef = doc(db, 'account_details', userId);
    await updateDoc(userRef, updates);
    
    alert('User updated successfully!');
    await logAdmin("user_management", `Updated user: ${firstName} ${lastName}`);
    closeEditUserPopup();
    
    // Refresh will happen via listener
    
  } catch (error) {
    console.error('Error updating user:', error);
    alert('Failed to update user: ' + error.message);
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }
}

/**
 * Open Remove User Popup
 */
function openRemovePopup(userId, userName) {
  const modal = document.getElementById('rmvusrPopUp');
  if (!modal) return;
  
  modal.dataset.userId = userId;
  
  const user = usersCache.find(u => (u.uid || u.id) === userId);
  const userType = user ? getUserTypeDisplayName(user.userType || user.role) : 'User';
  
  document.getElementById('userName').innerHTML = `<strong>${userName}</strong> <span style="font-weight: normal;">as a</span> <strong>${userType}</strong>`;
  
  modal.style.display = 'flex';
}

/**
 * Close Remove User Popup
 */
function closeRemovePopup() {
  const modal = document.getElementById('rmvusrPopUp');
  if (modal) {
    modal.style.display = 'none';
  }
}

/**
 * Confirm and remove user
 */
async function confirmRemoveUser() {
  const modal = document.getElementById('rmvusrPopUp');
  const userId = modal.dataset.userId;
  
  if (!userId) {
    alert('User ID not found');
    return;
  }
  
  const user = usersCache.find(u => (u.uid || u.id) === userId);
  const userName = user ? `${user.fname} ${user.lname}` : 'Unknown User';
  
  const confirmBtn = document.querySelector('.removeBtnConfirm');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Removing...';
  }
  
  try {
    // Call backend API to delete user
    const idToken = sessionStorage.getItem('idToken');
    if (!idToken) {
      throw new Error('Not authenticated');
    }
    
    // UPDATE THIS URL TO YOUR VERCEL DEPLOYMENT URL
    const response = await fetch('https://safe-space-backend.vercel.app/api/delete-user.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ uid: userId })
    });
    
    const result = await response.json();
    
    if (!response.ok) {
      throw new Error(result.error || 'Failed to delete user');
    }
    
    alert('User removed successfully!');
    await logAdmin("user_management", `Removed user: ${userName}`);
    closeRemovePopup();
    
    // Refresh will happen via listener
    
  } catch (error) {
    console.error('Error removing user:', error);
    alert('Failed to remove user: ' + error.message);
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Remove';
    }
  }
}

/**
 * Toggle dropdown dots
 */
function toggleDpDots(button) {
  const dpDots = button.nextElementSibling;
  
  // Close other dropdowns
  document.querySelectorAll('.dropdown-content.show').forEach(menu => {
    if (menu !== dpDots) menu.classList.remove('show');
  });
  
  // Toggle current dropdown
  dpDots.classList.toggle('show');
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(event) {
  if (!event.target.closest('.dpDots')) {
    document.querySelectorAll('.dropdown-content.show').forEach(menu => {
      menu.classList.remove('show');
    });
  }
});

/**
 * Helper functions
 */
function getUserTypeBadgeClass(userType) {
  const classes = {
    'gco': 'cat_GCO',
    'peer': 'cat_peer',
    'student': 'cat_user',
    'admin': 'cat_admin'
  };
  return classes[userType] || 'cat_user';
}

function getUserTypeDisplayName(userType) {
  const names = {
    'gco': 'GCO Coordinator',
    'peer': 'Peer Facilitator',
    'student': 'Student',
    'admin': 'IT Admin'
  };
  return names[userType] || userType;
}

function resolveAvatarUrl(avatarUrl) {
  if (!avatarUrl) return 'photos/pic_placeholder.png';
  
  if (avatarUrl.startsWith('image_')) {
    const mapping = {
      'image_1': 'photos/avatar_panda.png',
      'image_2': 'photos/avatar_butterfly.png',
      'image_3': 'photos/avatar_wolf.png',
      'image_4': 'photos/avatar_buffalo.png'
    };
    return mapping[avatarUrl] || 'photos/pic_placeholder.png';
  }
  
  if (avatarUrl.startsWith('http')) {
    const separator = avatarUrl.includes('?') ? '&' : '?';
    return `${avatarUrl}${separator}t=${Date.now()}`;
  }
  
  return avatarUrl;
}

function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    return 'N/A';
  }
}

/**
 * Cleanup
 */
export function cleanupITUserManagement() {
  if (usersListener) {
    usersListener();
    usersListener = null;
  }
  // Note: We aren't unsubscribing from individual RTDB refs here 
  // because observedPresence tracks them, but typically you'd want to
  // unsubscribe all if this module is completely destroyed.
  usersCache = [];
  observedPresence.clear();
}

export default {
  initializeITUserManagement,
  cleanupITUserManagement
};