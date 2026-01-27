// userManagement.js
import { db, rtdb } from "./auth.js";
import { 
  collection, 
  getDocs,
  getDoc,
  query, 
  where, 
  orderBy,
  doc,
  updateDoc,
  deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { ref, onValue } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { logAdmin } from "./logger.js";

// Cache for users to avoid repeated fetches
let usersCache = null;
let lastFetchTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// popup cache (was missing)
const userPopupCache = new Map();

// Track RTDB presence listeners we already attached to avoid duplicates
const observedPresence = new Set();

export function resolveAvatarUrl(avatarUrl) {
    if (!avatarUrl) return 'photos/pic_placeholder.png';

    // CASE 1: Student Presets (Local Files)
    if (avatarUrl.startsWith('image_')) {
        const mapping = {
            'image_1': 'photos/avatar_panda.png',
            'image_2': 'photos/avatar_butterfly.png',
            'image_3': 'photos/avatar_wolf.png',
            'image_4': 'photos/avatar_buffalo.png'
        };
        return mapping[avatarUrl] || 'photos/pic_placeholder.png';
    }

    // CASE 2: Peer URLs (Web/Supabase)
    if (avatarUrl.startsWith('http')) {
        // Append timestamp to force browser to reload the image immediately
        // if the user just changed it.
        const separator = avatarUrl.includes('?') ? '&' : '?';
        return `${avatarUrl}${separator}t=${Date.now()}`;
    }

    return avatarUrl;
}


/**
 * Fetch all users from Firebase
 * @param {boolean} forceRefresh - Force refresh ignoring cache
 * @returns {Promise<Array>} Array of user objects
 */
export async function fetchAllUsers(forceRefresh = false) {
  const now = Date.now();
  
  // Return cached data if available and not expired
  if (!forceRefresh && usersCache && lastFetchTime && (now - lastFetchTime < CACHE_DURATION)) {
    console.log("Returning cached users");
    return usersCache;
  }

  try {
    console.log("Fetching users from Firebase...");
    const usersRef = collection(db, "account_details");
    const snapshot = await getDocs(usersRef);
    
    const users = [];
    snapshot.forEach((doc) => {
      users.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Update cache
    usersCache = users;
    lastFetchTime = now;
    
    console.log(`Fetched ${users.length} users from Firebase`);
    return users;
    
  } catch (error) {
    console.error("Error fetching users:", error);
    throw error;
  }
}

async function getUserForPopup(uid) {
  if (!uid) return null;
  if (userPopupCache.has(uid)) return userPopupCache.get(uid);

  try {
    const snap = await getDoc(doc(db, "account_details", uid));
    if (!snap.exists()) return null;

    const data = snap.data();
    userPopupCache.set(uid, data);
    return data;
  } catch (err) {
    console.error("Failed to fetch popup user:", err);
    return null;
  }
}


/**
 * Filter users by user type
 * @param {Array} users - Array of all users
 * @param {Array} allowedTypes - Array of allowed userTypes
 * @returns {Array} Filtered users
 */
export function filterUsersByType(users, allowedTypes) {
  return users.filter(user => allowedTypes.includes(user.userType));
}

/**
 * Format user data for display
 * @param {Object} user - User object from Firebase
 * @returns {Object} Formatted user data
 */
export function formatUserData(user) {
  const fullName = `${user.lname || ''}, ${user.fname || ''}`.trim();
  const displayName = user.username || user.fname || 'N/A';
  
  // Format dates
  let createdDate = 'N/A';
  let lastActive = 'N/A';
  
  if (user.createdAt) {
    try {
      const date = user.createdAt.toDate ? user.createdAt.toDate() : new Date(user.createdAt);
      createdDate = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    } catch (e) {
      console.error("Error formatting createdAt:", e);
    }
  }
  
  // If Firestore has a lastActive value (legacy), format it, but RTDB watcher will overwrite this.
  if (user.lastActive) {
    try {
      const date = user.lastActive.toDate ? user.lastActive.toDate() : new Date(user.lastActive);
      lastActive = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    } catch (e) {
      // If it's already a string (e.g. 'Online' or 'Offline'), just use it
      try { lastActive = String(user.lastActive); } catch(_) { }
    }
  }

  return {
    id: user.id || user.uid,
    uid: user.uid || user.id,
    fullName,
    displayName,
    email: user.email || 'N/A',
    userType: user.userType || 'N/A',
    program: user.program || 'N/A',
    studentId: user.studentId || 'N/A',
    yearLevel: user.year_lvl || 'N/A',
    avatarUrl: user.avatarUrl || 'photos/pic_placeholder.png',
    createdDate,
    lastActive,
    rawData: user
  };
}

function normalizeLastActiveForDisplay(value) {
  if (!value) return "—";
  const s = String(value).trim();
  if (s === "" || s.toUpperCase() === "N/A") return "—";
  return s;
}

/**
 * Returns the latest formatted user object for a uid:
 * 1) tries window.currentUsers (formatted)
 * 2) falls back to usersCache and formats it
 */
function getLatestUser(uid) {
  if (!uid) return null;
  // try formatted list first
  if (window.currentUsers && Array.isArray(window.currentUsers)) {
    const found = window.currentUsers.find(u => (u.id || u.uid) === uid);
    if (found) return found;
  }
  // fallback to raw cache
  if (usersCache && Array.isArray(usersCache)) {
    const raw = usersCache.find(u => (u.id || u.uid) === uid || (u.uid && u.uid === uid));
    if (raw) return formatUserData(raw);
  }
  return null;
}


function switchPage(pageId) {
  document.querySelectorAll(".page").forEach(p => {
    p.style.display = "none";
  });

  const page = document.getElementById(pageId);
  if (page) page.style.display = "block";
}


/**
 * Get user type badge class
 * @param {string} userType - User type
 * @returns {string} CSS class name
 */
export function getUserTypeBadgeClass(userType) {
  const classes = {
    'gco': 'cat_GCO',
    'peer': 'cat_peer',
    'student': 'cat_user',
    'admin': 'cat_admin'
  };
  return classes[userType] || 'cat_user';
}

/**
 * Get user type display name
 * @param {string} userType - User type
 * @returns {string} Display name
 */
export function getUserTypeDisplayName(userType) {
  const names = {
    'gco': 'GCO Coordinator',
    'peer': 'Peer Facilitator',
    'student': 'Student',
    'admin': 'IT Admin'
  };
  return names[userType] || userType;
}

/**
 * Populate user table with data
 * @param {string} tableBodyId - ID of tbody element
 * @param {Array} users - Array of formatted user data
 * @param {Object} options - Options for rendering
 */
export function populateUserTable(tableBodyId, users, options = {}) {
  const tbody = document.querySelector(`#${tableBodyId}`);
  if (!tbody) {
    console.error(`Table body with id '${tableBodyId}' not found`);
    return;
  }

  // Clear existing rows
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
    const row = createUserRow(user, options);
    tbody.appendChild(row);
  });
}

export function populatePeerTable() {
  const tbody = document.getElementById("peerTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!usersCache && !(window.currentUsers && window.currentUsers.length)) return;

  // build peers list from latest data to ensure lastActive is current
  const peersRaw = (window.currentUsers || [])
    .filter(u => u.rawData && u.rawData.userType === "peer");

  // If window.currentUsers is empty, fallback to usersCache
  if (!peersRaw.length && usersCache) {
    peersRaw.push(...usersCache.filter(u => u.userType === "peer").map(formatUserData));
  }

  if (peersRaw.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:20px;">
          No peer facilitators found
        </td>
      </tr>
    `;
    return;
  }

  peersRaw.forEach(peer => {
    const latest = getLatestUser(peer.id) || peer;
    const row = document.createElement("tr");

    // --- ensure the row contains the data-user-id attribute for updates ---
    row.setAttribute('data-user-id', latest.id);

    row.innerHTML = `
      <td class="table_user">
        <img src="${resolveAvatarUrl(latest.avatarUrl)}" onerror="this.src='photos/pic_placeholder.png'">
      </td>
      <td>
        <div class="name" style="cursor:pointer">
          ${latest.fullName}<br>
          <span>${latest.email}</span>
        </div>
      </td>
      <td></td>
      <td class="peerInteract"><span>0</span></td>
      <td class="lastActive">${normalizeLastActiveForDisplay(latest.lastActive)}</td>
      <td>${latest.createdDate}</td>
    `;

    // Pass the full formatted peer object (not just uid)
    row.querySelector(".name").onclick = () => openPerPeerPage(latest);

    tbody.appendChild(row);
  });
}

function openPerPeerPage(peer) {
  // Accept either uid or the formatted object: normalize
  const effectivePeer = (typeof peer === 'string') ? getLatestUser(peer) : (getLatestUser(peer.id) || peer);
  if (!effectivePeer) return;

  document.querySelectorAll(".page").forEach(p => p.style.display = "none");
  document.getElementById("perPeerPage").style.display = "block";

  document.querySelector(".informationProfileImg").src =
    resolveAvatarUrl(effectivePeer.avatarUrl) || "photos/pic_placeholder.png";

  document.getElementById("peerNameTitle").textContent = effectivePeer.fullName;
  document.getElementById("peerInfo_lastactive").textContent = normalizeLastActiveForDisplay(effectivePeer.lastActive);
  document.getElementById("peerInfo_dateCreated").textContent = effectivePeer.createdDate;

  document.getElementById("peerFirstName").textContent = effectivePeer.rawData.fname || "N/A";
  document.getElementById("peerLastName").textContent = effectivePeer.rawData.lname || "N/A";
  document.getElementById("peerEmail").textContent = effectivePeer.email;
  document.getElementById("peerStudentNum").textContent = effectivePeer.studentId;
  document.getElementById("peerProgram").textContent = effectivePeer.program;
  const title = `
                <a href="#" onclick="showPage('peer-facilitators')" style="text-decoration:none; color:inherit;">
                    Peer Facilitators
                </a>
                <img src="icons/ic_arrow right.svg" 
                    style="width:14px; vertical-align:middle; margin:0 5px; cursor:pointer;" 
                    onclick="showPage('peer-facilitators')">
                ${effectivePeer.fullName}
            `;
  document.getElementById("pageTitle").innerHTML = title;
}

export function initializePeerFacilitators() {
  const tbody = document.querySelector("#peer_list tbody");
  const searchInput = document.querySelector("#peer-facilitators input[type='text']");

  if (!tbody) {
    console.warn("Peer table body not found");
    return;
  }

  // peers only (use the formatted list if available)
  const peers = (window.currentUsers || [])
    .filter(u => u.rawData && u.rawData.userType === "peer");

  // If no formatted list yet, fallback to usersCache formatted
  const initialPeers = peers.length ? peers : (usersCache ? usersCache.filter(u => u.userType === "peer").map(formatUserData) : []);

  renderPeerRows(initialPeers, tbody);

  // --- Start watching last active times for these peers ---
  watchUserPresence(initialPeers);

  // 🔍 search behavior (same logic as userManagement)
  if (searchInput) {
  searchInput.addEventListener("input", () => {
    const term = searchInput.value.toLowerCase();

    // Recompute peer users from currentUsers
    const currentPeers = (window.currentUsers || [])
      .filter(u => u.rawData.userType === "peer");

    const filtered = currentPeers.filter(p =>
      p.fullName.toLowerCase().includes(term) ||
      p.email.toLowerCase().includes(term) ||
      p.studentId.toLowerCase().includes(term)
    );

    renderPeerRows(filtered, tbody);
  });
}

}

function renderPeerRows(peers, tbody) {
  tbody.innerHTML = "";

  if (!peers.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;color:#888;">
          No peer facilitators found
        </td>
      </tr>
    `;
    return;
  }

  peers.forEach(peer => {
    const latest = getLatestUser(peer.id) || peer;

    const tr = document.createElement("tr");

    tr.setAttribute('data-user-id', latest.id);

    tr.innerHTML = `
      <td class="table_user">
        <img src="${resolveAvatarUrl(latest.avatarUrl)}" onerror="this.src='photos/pic_placeholder.png'">
      </td>
      <td>
        <div class="name" style="cursor:pointer;">
          ${latest.fullName}<br>
          <span>${latest.email}</span>
        </div>
      </td>
      <td></td>
      <td class="peerInteract"><span>0</span></td>
      <td class="lastActive">${normalizeLastActiveForDisplay(latest.lastActive)}</td>
      <td>${latest.createdDate}</td>
    `;

    tr.querySelector(".name").addEventListener("click", () => {
      openPerPeerPage(latest);
    });

    tbody.appendChild(tr);
  });
}

window.openPerPeerPage = openPerPeerPage;


/**
 * Create a table row for a user
 * @param {Object} user - Formatted user data
 * @param {Object} options - Options for rendering
 * @returns {HTMLElement} Table row element
 */
function createUserRow(user, options = {}) {
  const row = document.createElement('tr');
  row.setAttribute('data-user-id', user.id);
  row.setAttribute('data-user-type', user.userType);

  const showActions = options.showActions !== false;
  const onClick = options.onClick || null;

  row.innerHTML = `
    <td class="table_user">
      <img src="${resolveAvatarUrl(user.avatarUrl)}" alt="${user.fullName}" onerror="this.src='photos/pic_placeholder.png'">
    </td>
    <td class="name" ${onClick ? 'style="cursor: pointer;"' : ''}>
      ${user.fullName}<br>
      <span>${user.email}</span>
    </td>
    <td></td>
    <td>${user.displayName}</td>
    ${options.showType !== false ? `
    <td>
      <div class="${getUserTypeBadgeClass(user.userType)}">
        ${getUserTypeDisplayName(user.userType)}
      </div>
    </td>
    ` : ''}
    <td class="lastActive">${normalizeLastActiveForDisplay(user.lastActive)}</td>
    <td>${user.createdDate}</td>
    ${showActions ? `
    <td class="action">
      <div class="dpDots">
        <button class="menu-dots" onclick="toggleDpDots(this)">⋮</button>
        <div class="dropdown-content">
          <a href="#" onclick="window.editUser('${user.id}')">Edit</a>
          <a href="#" class="remove" onclick="window.removeUser('${user.id}', '${user.fullName}')">Remove User</a>
        </div>
      </div>
    </td>
    ` : '<td></td>'}
  `;

  // Add click event to name cell if onClick provided
  if (onClick) {
    const nameCell = row.querySelector('.name');
    nameCell.addEventListener('click', () => onClick(user));
  }

  return row;
}

/**
 * Search and filter users
 * @param {Array} users - Array of users
 * @param {string} searchTerm - Search term
 * @param {string} typeFilter - User type filter
 * @returns {Array} Filtered users
 */
export function searchAndFilterUsers(users, searchTerm = '', typeFilter = 'All') {
  let filtered = [...users];

  // Filter by type
  if (typeFilter && typeFilter !== 'All') {
    const filterMap = {
      'Peers': 'peer',
      'Users': 'student',
      'GCO': 'gco',
      'Admin': 'admin'
    };
    const userType = filterMap[typeFilter] || typeFilter.toLowerCase();
    filtered = filtered.filter(user => user.rawData.userType === userType);
  }

  // Search by name, email, or student ID
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    filtered = filtered.filter(user => 
      user.fullName.toLowerCase().includes(term) ||
      user.email.toLowerCase().includes(term) ||
      user.studentId.toLowerCase().includes(term) ||
      user.displayName.toLowerCase().includes(term)
    );
  }

  return filtered;
}

/**
 * Initialize user management for a page
 * @param {Object} config - Configuration object
 */
export async function initializeUserManagement(config) {
  const {
    allowedUserTypes = ['student', 'peer'],
    tableBodyId = 'userTableBody',
    searchInputId = 'userSearch',
    filterSelectId = 'userTypeFilter',
    showActions = true,
    onUserClick = null
  } = config;

  try {
    // Fetch all users
    const allUsers = await fetchAllUsers();
    
    // Filter by allowed types
    const filteredUsers = filterUsersByType(allUsers, allowedUserTypes);
    
    // Format users
    let formattedUsers = filteredUsers.map(formatUserData);
    
    // Sort by creation date (newest first)
    formattedUsers.sort((a, b) => {
      const dateA = a.rawData.createdAt?.toDate?.() || new Date(0);
      const dateB = b.rawData.createdAt?.toDate?.() || new Date(0);
      return dateB - dateA;
    });

    // Store formatted users globally for search/filter
    window.currentUsers = formattedUsers;
    window.openUsersPopup = openUsersPopup;
    window.closeUsersPopup = closeUsersPopup;


    // Populate table
    populateUserTable(tableBodyId, formattedUsers, { 
      showActions, 
      onClick: onUserClick 
    });

    watchUserPresence(formattedUsers);

    // Setup search
    const searchInput = document.getElementById(searchInputId);
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value;
        const filterSelect = document.getElementById(filterSelectId);
        const typeFilter = filterSelect ? filterSelect.value : 'All';
        
        const filtered = searchAndFilterUsers(window.currentUsers, searchTerm, typeFilter);
        populateUserTable(tableBodyId, filtered, { showActions, onClick: onUserClick });
      });
    }

    // Setup filter
    const filterSelect = document.getElementById(filterSelectId);
    if (filterSelect) {
      filterSelect.addEventListener('change', (e) => {
        const typeFilter = e.target.value;
        const searchInput = document.getElementById(searchInputId);
        const searchTerm = searchInput ? searchInput.value : '';
        
        const filtered = searchAndFilterUsers(window.currentUsers, searchTerm, typeFilter);
        populateUserTable(tableBodyId, filtered, { showActions, onClick: onUserClick });
      });
    }

    console.log(`User management initialized with ${formattedUsers.length} users`);
    
  } catch (error) {
    console.error("Error initializing user management:", error);
    alert("Failed to load users. Please refresh the page.");
  }
}


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

      // Helper to extract timestamp & state robustly
      let timestamp = null;
      let state = null;

      if (typeof data === 'number') {
        timestamp = data;
      } else if (typeof data === 'string' && !isNaN(Number(data))) {
        timestamp = Number(data);
      } else if (typeof data === 'object') {
        // iterate entries; keys could be numeric timestamps or 'state'; values might be numbers
        Object.entries(data).forEach(([k, v]) => {
          if (k === 'state') {
            state = v;
          }
          // value is numeric timestamp
          if (typeof v === 'number' && (!timestamp || v > timestamp)) {
            timestamp = v;
          }
          // key is numeric timestamp (some RTDB patterns use dynamic keys)
          const keyNum = Number(k);
          if (!isNaN(keyNum) && (!timestamp || keyNum > timestamp)) {
            timestamp = keyNum;
          }
        });
      }

      // Determine display text: prefer timestamp; if none, fall back to state; else Offline
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

      // 3. Update Raw Cache (usersCache)
      try {
        const userIndex = usersCache ? usersCache.findIndex(u => (u.id || u.uid) === uid) : -1;
        if (userIndex !== -1) {
          usersCache[userIndex].lastActive = displayText;
        }
      } catch (e) { console.warn(e); }

      // 4. Update Display List (window.currentUsers)
      try {
        if (window.currentUsers && Array.isArray(window.currentUsers)) {
          const gIndex = window.currentUsers.findIndex(u => (u.id || u.uid) === uid);
          if (gIndex !== -1) {
            window.currentUsers[gIndex].lastActive = displayText;
          }
        }
      } catch (e) { console.warn(e); }

      // 5. Update DOM row(s) (works for both peer and user tables)
      updateUserRowInDOM(uid, displayText);

    }, (err) => {
      console.error("RTDB presence listener error for uid=" + uid, err);
    });
  });
}

/**
 * Helper to update specific row(s) in DOM based on data-user-id
 */
function updateUserRowInDOM(userId, newStatusText) {
  // Update all matching rows (peer or user tables may have multiple)
  const rows = document.querySelectorAll(`tr[data-user-id="${userId}"]`);
  if (!rows || rows.length === 0) return;

  rows.forEach(row => {
    // If there is an explicit .lastActive cell, update that; else fallback to index-based logic
    const lastActiveCell = row.querySelector('.lastActive');
    if (lastActiveCell) {
      lastActiveCell.textContent = normalizeLastActiveForDisplay(newStatusText);
      lastActiveCell.style.color = '';
      lastActiveCell.style.fontWeight = '';
      return;
    }

    // --- Detect if this is a Peer Row or User Row ---
    const isPeerRow = !!row.querySelector('.peerInteract');

    // Target index depends on table type
    const targetIndex = isPeerRow ? 4 : 5;
    const cells = row.querySelectorAll('td');

    if (cells.length > targetIndex) {
        cells[targetIndex].textContent = normalizeLastActiveForDisplay(newStatusText);

        // Reset styling
        cells[targetIndex].style.color = ''; 
        cells[targetIndex].style.fontWeight = '';
    }
  });
}

/**
 * Refresh user list
 */
export async function refreshUserList(config) {
  await fetchAllUsers(true); // Force refresh
  await initializeUserManagement(config);
}

// Make functions available globally for HTML onclick handlers
window.editUser = function(userId) {
  console.log("Edit user:", userId);
  // TODO: Implement edit functionality
  alert(`Edit user functionality for ID: ${userId}`);
};

window.removeUser = function(userId, userName) {
  console.log("Remove user:", userId, userName);
  // TODO: Implement remove functionality
  if (confirm(`Are you sure you want to remove ${userName}?`)) {
    alert(`Remove user functionality for ID: ${userId}`);
  }
};

window.toggleDpDots = function(button) {
  const dpDots = button.nextElementSibling;
  
  // Close other dropdowns
  document.querySelectorAll('.dropdown-content.show').forEach(menu => {
    if (menu !== dpDots) menu.classList.remove('show');
  });
  
  // Toggle current dropdown
  dpDots.classList.toggle('show');
};

// Close dropdowns when clicking outside
document.addEventListener('click', function(event) {
  if (!event.target.closest('.dpDots')) {
    document.querySelectorAll('.dropdown-content.show').forEach(menu => {
      menu.classList.remove('show');
    });
  }
});

export async function openUsersPopup(uid) {
  const popup = document.getElementById("usersInfoPopup");
  if (!popup) return;

  try {
    // allow calling without uid if window.selectedUser exists
    const effectiveUid = uid || (window.selectedUser && (window.selectedUser.uid || window.selectedUser.id));
    if (!effectiveUid) {
      console.warn("openUsersPopup: no uid provided and window.selectedUser is not set");
      return;
    }

    const data = await getUserForPopup(effectiveUid);
    if (!data) return;

    // Left side
    popup.querySelector(".popup-profile-img").src =
      resolveAvatarUrl(data.avatarUrl) || "photos/pic_placeholder.png";

    popup.querySelector(".popup-left h2").textContent =
      `${data.lname || ""}, ${data.fname || ""}`;

    const dateEls = popup.querySelectorAll(".date-created-left strong");

    // Try to use cached RTDB-derived lastActive if available (so popup shows current last-active)
    const cached = usersCache ? usersCache.find(u => (u.id || u.uid) === effectiveUid) : null;
    if (dateEls[0]) dateEls[0].textContent = cached ? (cached.lastActive || 'N/A') : (data.lastActive ? String(data.lastActive) : 'N/A');
    if (dateEls[1]) dateEls[1].textContent = data.createdAt ? (data.createdAt.toDate ? data.createdAt.toDate().toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric'}) : String(data.createdAt)) : 'N/A';

    // Right side fields
    setPopupDetail(popup, "First Name", data.fname);
    setPopupDetail(popup, "Last Name", data.lname);
    setPopupDetail(popup, "Student Email", data.email);
    setPopupDetail(popup, "Preferred Name", data.username);
    setPopupDetail(popup, "Student ID", data.studentId);
    setPopupDetail(popup, "Program", data.program);

    popup.style.display = "block";
  } catch (err) {
    console.error("Failed to open users popup:", err);
  }
}

export function closeUsersPopup() {
  const popup = document.getElementById("usersInfoPopup");
  if (popup) popup.style.display = "none";
}

function setPopupDetail(popup, label, value) {
  const item = Array.from(popup.querySelectorAll(".detail-item"))
    .find(d => d.querySelector("label").textContent === label);
  if (item) item.querySelector("p").textContent = value || "N/A";
}

function formatPopupDate(ts) {
  if (!ts) return "N/A";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
}

document.addEventListener("click", (e) => {
  const popup = document.getElementById("usersInfoPopup");
  if (!popup) return;

  // Popup is open AND user clicked the dark background
  if (
    popup.style.display === "block" &&
    e.target === popup
  ) {
    closeUsersPopup();
  }
});


export default {
  fetchAllUsers,
  filterUsersByType,
  formatUserData,
  populateUserTable,
  searchAndFilterUsers,
  initializeUserManagement,
  refreshUserList
};