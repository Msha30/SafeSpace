// userManagement.js
import { db } from "./auth.js";
import { 
  collection, 
  getDocs, 
  query, 
  where, 
  orderBy,
  doc,
  updateDoc,
  deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Cache for users to avoid repeated fetches
let usersCache = null;
let lastFetchTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const programs = [
    "Accountancy, Business and Management (ABM) Strand",
    "Humanities and Social Sciences (HUMSS) Strand",
    "Science, Technology, Engineering and Mathematics (STEM) Strand",
    "BS Hospitality Management",
    "BS Tourism Management",
    "BS Computer Engineering",
    "BS Civil Engineering",
    "BS Information Technology",
    "BS Psychology",
    "AB Communication",
    "BS Architecture",
    "BS Accountancy",
    "BS Business Administration"
];

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
  
  if (user.lastActive) {
    try {
      const date = user.lastActive.toDate ? user.lastActive.toDate() : new Date(user.lastActive);
      lastActive = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    } catch (e) {
      console.error("Error formatting lastActive:", e);
    }
  }

  return {
    id: user.id || user.uid,
    uid: user.uid,
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
      <img src="${user.avatarUrl}" alt="${user.fullName}" onerror="this.src='photos/pic_placeholder.png'">
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
    <td>${user.lastActive}</td>
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

    // Populate table
    populateUserTable(tableBodyId, formattedUsers, { 
      showActions, 
      onClick: onUserClick 
    });

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


export async function updateProgramsTable() {
    try {
        const users = await fetchAllUsers();

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        programs.forEach((program, index) => {
            const rowNum = index + 1;
            const newUsersCell = document.getElementById(`rw${rowNum}_newusers`);
            const totalUsersCell = document.getElementById(`rw${rowNum}_totalusers`);
            const changeCell = document.getElementById(`rw${rowNum}_change`);

            if (!newUsersCell || !totalUsersCell || !changeCell) return;

            // Filter users by program
            const programUsers = users.filter(u => u.program === program);

            // Count total users
            const totalUsers = programUsers.length;

            // Count new users this month
            const newUsersThisMonth = programUsers.filter(u => {
                const createdAt = u.createdAt?.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
                return createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear;
            }).length;

            // Placeholder for change %, can compute with historical data if available
            const changePercent = 0; 
            const changeClass = changePercent >= 0 ? 'up' : 'down';

            // Update table cells
            newUsersCell.textContent = newUsersThisMonth;
            totalUsersCell.textContent = totalUsers;
            changeCell.textContent = `${changePercent} %`;
            changeCell.className = changeClass; // update class to reflect up/down
        });

    } catch (err) {
        console.error("Failed to update programs table:", err);
    }
}

/**
 * Update user count displays
 * @param {Array} users - Array of users
 */
export function updateUserCounts(users) {
  try {
    const students = users.filter(u => u.rawData.userType === 'student');
    const peers = users.filter(u => u.rawData.userType === 'peer');
    
    const studentCountEl = document.getElementById('student_count');
    const peersCountEl = document.getElementById('peers_count');
    
    if (studentCountEl) studentCountEl.textContent = students.length;
    if (peersCountEl) peersCountEl.textContent = peers.length;
  } catch (err) {
      console.error("Failed to update stats counts:", err);
  }
}

export async function refreshProgramsDashboard() {
    await updateProgramsTable();
    await updateUserCounts();
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

export default {
  fetchAllUsers,
  filterUsersByType,
  formatUserData,
  populateUserTable,
  searchAndFilterUsers,
  initializeUserManagement,
  updateUserCounts,
  refreshUserList
};