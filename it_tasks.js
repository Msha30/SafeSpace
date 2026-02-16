// it_tasks.js - IT Admin Task Management
import { db, auth } from "./auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { logAdmin } from "./logger.js";

// Constants
const REPORT_TYPES = [
  { id: "Technical", label: "Technical" },
  { id: "Editing", label: "Editing" },
  { id: "Account", label: "Account" },
  { id: "Removal", label: "Removal" },
  { id: "Chat_History", label: "Chat History" },
  { id: "Update", label: "Update" },
  { id: "Other", label: "Other" }
];

// Cache for tasks
let tasksCache = new Map();
let activeListeners = new Map();
let lastSeenTimestamps = new Map(); // Track when user last viewed each task type

/**
 * Initialize IT Tasks system
 */
export async function initializeITTasks() {
  console.log("Initializing IT Tasks...");
  
  // Load last seen timestamps from localStorage
  loadLastSeenTimestamps();
  
  // Setup listeners for each report type
  REPORT_TYPES.forEach(type => {
    setupTaskListener(type.id);
  });
  
  // Update task counts and NEW badges in overview cards
  updateTaskCounts();
  
  // Wire up overview card clicks to navigate to task pages
  wireOverviewCards();
}

/**
 * Setup real-time listener for a specific report type
 */
function setupTaskListener(reportType) {
  try {
    const tasksRef = collection(db, "IT_Reports", reportType, "tasks");
    const q = query(tasksRef, orderBy("task_created_date", "desc"));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const tasks = [];
      snapshot.forEach((doc) => {
        tasks.push({
          id: doc.id,
          reportType,
          ...doc.data()
        });
      });
      
      // Update cache
      tasksCache.set(reportType, tasks);
      
      // Update UI if on that page
      const currentPage = getCurrentTaskPage();
      if (currentPage === reportType.toLowerCase()) {
        renderTasksForType(reportType, tasks);
      }
      
      // Update counts and badges
      updateTaskCounts();
    }, (error) => {
      console.error(`Error listening to ${reportType} tasks:`, error);
    });
    
    activeListeners.set(reportType, unsubscribe);
  } catch (error) {
    console.error(`Failed to setup listener for ${reportType}:`, error);
  }
}

/**
 * Load last seen timestamps from localStorage
 */
function loadLastSeenTimestamps() {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  
  const key = `lastSeenTasks_${currentUser.uid}`;
  const stored = localStorage.getItem(key);
  
  if (stored) {
    try {
      const data = JSON.parse(stored);
      lastSeenTimestamps = new Map(Object.entries(data));
    } catch (e) {
      console.error("Failed to parse last seen timestamps:", e);
    }
  }
}

/**
 * Save last seen timestamp for a report type
 */
function saveLastSeenTimestamp(reportType) {
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  
  lastSeenTimestamps.set(reportType, Date.now());
  
  const key = `lastSeenTasks_${currentUser.uid}`;
  const data = Object.fromEntries(lastSeenTimestamps);
  localStorage.setItem(key, JSON.stringify(data));
  
  // Update badge immediately
  updateTaskCounts();
}

/**
 * Wire up overview cards to navigate to task pages
 */
function wireOverviewCards() {
  const overviewPage = document.getElementById('tasks');
  if (!overviewPage) return;
  
  const cards = overviewPage.querySelectorAll('.task-card');
  
  cards.forEach((card, index) => {
    if (index >= REPORT_TYPES.length) return;
    
    const reportType = REPORT_TYPES[index];
    const pageId = reportType.id.toLowerCase().replace(/_/g, '-');
    
    // Remove old click listeners by cloning
    const newCard = card.cloneNode(true);
    card.parentNode.replaceChild(newCard, card);
    
    newCard.style.cursor = 'pointer';
    newCard.addEventListener('click', () => {
      navigateToTaskPage(pageId, reportType.id);
    });
  });
}

/**
 * Navigate to a specific task page
 */
function navigateToTaskPage(pageId, reportType) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => {
    p.style.display = 'none';
    p.classList.remove('active');
  });
  
  // Show the target page
  const page = document.getElementById(pageId);
  if (page) {
    page.style.display = 'block';
    page.classList.add('active');
    
    // Update page title
    const pageTitle = document.getElementById('pageTitle');
    if (pageTitle) {
      const typeName = REPORT_TYPES.find(t => t.id === reportType)?.label || reportType;
      pageTitle.innerHTML = `
        <a href="#" onclick="showPage('tasks')" style="text-decoration:none; color:inherit;">
          Tasks
        </a>
        <img src="icons/ic_arrow right.svg" 
            style="width:14px; vertical-align:middle; margin:0 5px; cursor:pointer;" 
            onclick="showPage('tasks')">
        ${typeName}
      `;
    }
    
    // Mark as seen
    saveLastSeenTimestamp(reportType);
    
    // Render tasks for this type
    const tasks = tasksCache.get(reportType) || [];
    renderTasksForType(reportType, tasks);
  }
}

/**
 * Get current task page from URL or DOM
 */
function getCurrentTaskPage() {
  const activePage = document.querySelector('.page.active');
  if (activePage) {
    return activePage.id;
  }
  return null;
}

/**
 * Render tasks for a specific type on its page
 */
function renderTasksForType(reportType, tasks) {
  const pageId = reportType.toLowerCase().replace(/_/g, '-');
  const page = document.getElementById(pageId);
  if (!page) return;
  
  const currentUser = auth.currentUser;
  if (!currentUser) return;
  
  // Group tasks by status
  const todoTasks = tasks.filter(t => t.task_status === "To_Do");
  
  // Filter pending to show only tasks started by current user
  const pendingTasks = tasks.filter(t => 
    t.task_status === "Pending" && t.task_started_by === currentUser.uid
  );
  
  // Filter completed to show only tasks completed by current user
  const completedTasks = tasks.filter(t => 
    t.task_status === "Completed" && t.task_completed_by === currentUser.uid
  );
  
  // Render each section
  renderTaskSection(page, "To Do", todoTasks, "todo");
  renderTaskSection(page, "Pending", pendingTasks, "pending");
  renderTaskSection(page, "Complete", completedTasks, "complete");
}

/**
 * Render a task section (To Do, Pending, or Complete)
 */
function renderTaskSection(page, sectionTitle, tasks, sectionType) {
  const sections = page.querySelectorAll('.task-section-group');
  let targetSection = null;
  
  // Find the right section by title
  sections.forEach(section => {
    const h4 = section.querySelector('h4');
    if (h4 && h4.textContent.trim() === sectionTitle) {
      targetSection = section;
    }
  });
  
  if (!targetSection) return;
  
  const grid = targetSection.querySelector('.task-grid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  if (tasks.length === 0) {
    grid.innerHTML = `
      <div class="task-box" style="text-align:center; color:#888;">
        <p>No ${sectionTitle.toLowerCase()} tasks</p>
      </div>
    `;
    return;
  }
  
  tasks.forEach(task => {
    const taskBox = createTaskBox(task, sectionType);
    grid.appendChild(taskBox);
  });
}

/**
 * Create a task box element
 */
function createTaskBox(task, sectionType) {
  const box = document.createElement('div');
  box.className = 'task-box';
  box.dataset.taskId = task.id;
  box.dataset.reportType = task.reportType;
  
  const description = task.task_desc || "No description";
  const isCompleted = sectionType === 'complete';
  
  if (isCompleted) {
    box.innerHTML = `
      <p>
        <span style="color: #6d6d6d; font-style: italic; font-weight: bold;">
          ${escapeHtml(description)}
        </span>
      </p>
      <div class="task-actions">
        <button class="btn-details" onclick="window.openCompleteModal('${task.id}', '${task.reportType}')">
          See Details
        </button>
      </div>
    `;
  } else if (sectionType === 'pending') {
    box.innerHTML = `
      <p>${escapeHtml(description)}</p>
      <div class="task-actions">
        <button class="btn-details" onclick="window.openPendingModal('${task.id}', '${task.reportType}')">
          See Details
        </button>
        <button class="btn-done" onclick="window.openPendingDoneModal('${task.id}', '${task.reportType}')">
          Done
        </button>
      </div>
    `;
  } else {
    // To Do
    box.innerHTML = `
      <p>${escapeHtml(description)}</p>
      <div class="task-actions">
        <button class="btn-start" onclick="window.openModal('${task.id}', '${task.reportType}')">
          Start Task
        </button>
      </div>
    `;
  }
  
  return box;
}

/**
 * Update task counts in overview cards
 */
async function updateTaskCounts() {
  const overviewPage = document.getElementById('tasks');
  if (!overviewPage) return;
  
  const cards = overviewPage.querySelectorAll('.task-card');
  
  REPORT_TYPES.forEach((type, index) => {
    const tasks = tasksCache.get(type.id) || [];
    const todoCount = tasks.filter(t => t.task_status === "To_Do").length;
    
    if (cards[index]) {
      const countElem = cards[index].querySelector('p');
      if (countElem) {
        countElem.textContent = `${todoCount} task${todoCount !== 1 ? 's' : ''}`;
      }
      
      // Check if there are new tasks
      const hasNewTasks = checkForNewTasks(type.id, tasks);
      
      // Add or remove NEW badge
      let badge = cards[index].querySelector('.badge');
      if (hasNewTasks && !badge) {
        badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'NEW';
        cards[index].appendChild(badge);
      } else if (!hasNewTasks && badge) {
        badge.remove();
      }
    }
  });
}

/**
 * Check if there are new tasks since last seen
 */
function checkForNewTasks(reportType, tasks) {
  const lastSeen = lastSeenTimestamps.get(reportType);
  if (!lastSeen) {
    // Never seen before, check if there are any tasks
    return tasks.length > 0;
  }
  
  // Check if any task was created after last seen
  return tasks.some(task => {
    if (!task.task_created_date) return false;
    
    try {
      const createdDate = task.task_created_date.toDate ? 
        task.task_created_date.toDate() : 
        new Date(task.task_created_date);
      
      return createdDate.getTime() > lastSeen;
    } catch (e) {
      return false;
    }
  });
}

/**
 * Open To-Do task modal
 */
window.openModal = async function(taskId, reportType) {
  const task = await getTaskById(taskId, reportType);
  if (!task) return;
  
  const modal = document.getElementById('taskModal');
  if (!modal) return;
  
  const descElem = document.getElementById('modalTaskDescription');
  if (descElem) {
    descElem.textContent = task.task_desc || "No description";
  }
  
  // Get creator info
  const creatorInfo = await getUserInfo(task.task_creator);
  const creatorNameElem = modal.querySelector('.todo-modal-info-value');
  if (creatorNameElem) {
    creatorNameElem.textContent = creatorInfo.name || "Unknown";
  }
  
  // Format date
  const dateElem = modal.querySelectorAll('.todo-modal-info-value')[1];
  if (dateElem && task.task_created_date) {
    dateElem.textContent = formatDate(task.task_created_date);
  }
  
  // Wire up start button
  const startBtn = modal.querySelector('.todo-modal-button');
  if (startBtn) {
    startBtn.onclick = () => startTask(taskId, reportType);
  }
  
  modal.classList.add('active');
};

/**
 * Close To-Do modal
 */
window.closeModal = function() {
  const modal = document.getElementById('taskModal');
  if (modal) {
    modal.classList.remove('active');
  }
};

/**
 * Start a task (move to Pending)
 */
async function startTask(taskId, reportType) {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert("You must be logged in to start a task");
      return;
    }
    
    const taskRef = doc(db, "IT_Reports", reportType, "tasks", taskId);
    await updateDoc(taskRef, {
      task_status: "Pending",
      task_started_by: currentUser.uid,
      task_started_date: serverTimestamp()
    });
    
    window.closeModal();
    alert("Task started successfully");
    await logAdmin("task", `Started ${reportType} task`);
  } catch (error) {
    console.error("Error starting task:", error);
    alert("Failed to start task");
  }
}

/**
 * Open Pending task details modal
 */
window.openPendingModal = async function(taskId, reportType) {
  const task = await getTaskById(taskId, reportType);
  if (!task) return;
  
  const modal = document.getElementById('pendingModal');
  if (!modal) return;
  
  const descElem = document.getElementById('pendingModalTaskDescription');
  if (descElem) {
    descElem.textContent = task.task_desc || "No description";
  }
  
  // Creator info
  const creatorInfo = await getUserInfo(task.task_creator);
  const creatorNameElem = modal.querySelectorAll('.pending-modal-info-value')[0];
  if (creatorNameElem) {
    creatorNameElem.textContent = creatorInfo.name || "Unknown";
  }
  
  const creatorDateElem = modal.querySelectorAll('.pending-modal-info-value')[2];
  if (creatorDateElem && task.task_created_date) {
    creatorDateElem.textContent = formatDate(task.task_created_date);
  }
  
  // Starter info
  const starterInfo = await getUserInfo(task.task_started_by);
  const starterNameElem = modal.querySelectorAll('.pending-modal-info-value-green')[0];
  if (starterNameElem) {
    starterNameElem.textContent = starterInfo.name || "Unknown";
  }
  
  const starterDateElem = modal.querySelectorAll('.pending-modal-info-value-green')[1];
  if (starterDateElem && task.task_started_date) {
    starterDateElem.textContent = formatDate(task.task_started_date);
  }
  
  modal.classList.add('active');
};

/**
 * Close Pending modal
 */
window.closePendingModal = function() {
  const modal = document.getElementById('pendingModal');
  if (modal) {
    modal.classList.remove('active');
  }
};

/**
 * Open Pending Done modal (to complete task)
 */
window.openPendingDoneModal = async function(taskId, reportType) {
  const task = await getTaskById(taskId, reportType);
  if (!task) return;
  
  const modal = document.getElementById('doneModal');
  if (!modal) return;
  
  // Store task info on modal for submission
  modal.dataset.taskId = taskId;
  modal.dataset.reportType = reportType;
  
  const descElem = document.getElementById('doneModalTaskDescription');
  if (descElem) {
    descElem.textContent = task.task_desc || "No description";
  }
  
  // Creator info
  const creatorInfo = await getUserInfo(task.task_creator);
  const creatorNameElem = modal.querySelectorAll('.done-modal-info-value')[0];
  if (creatorNameElem) {
    creatorNameElem.textContent = creatorInfo.name || "Unknown";
  }
  
  const creatorDateElem = modal.querySelectorAll('.done-modal-info-value')[2];
  if (creatorDateElem && task.task_created_date) {
    creatorDateElem.textContent = formatDate(task.task_created_date);
  }
  
  // Starter info
  const starterInfo = await getUserInfo(task.task_started_by);
  const starterNameElem = modal.querySelectorAll('.done-modal-info-value-green')[0];
  if (starterNameElem) {
    starterNameElem.textContent = starterInfo.name || "Unknown";
  }
  
  const starterDateElem = modal.querySelectorAll('.done-modal-info-value-green')[1];
  if (starterDateElem && task.task_started_date) {
    starterDateElem.textContent = formatDate(task.task_started_date);
  }
  
  // Clear textarea and file input
  const textarea = modal.querySelector('.done-modal-textarea');
  if (textarea) textarea.value = '';
  
  const fileInput = document.getElementById('doneFileInput');
  if (fileInput) fileInput.value = '';
  
  const fileNameDiv = document.getElementById('selectedFileName');
  if (fileNameDiv) fileNameDiv.innerHTML = '';
  
  // Wire up submit button
  const submitBtn = modal.querySelector('.done-modal-submit');
  if (submitBtn) {
    submitBtn.onclick = () => completeTask(taskId, reportType);
  }
  
  modal.classList.add('active');
};

/**
 * Close Done modal
 */
window.closeDoneModal = function() {
  const modal = document.getElementById('doneModal');
  if (modal) {
    modal.classList.remove('active');
  }
};

/**
 * Complete a task
 */
async function completeTask(taskId, reportType) {
  try {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert("You must be logged in to complete a task");
      return;
    }

    const modal = document.getElementById('doneModal');
    const textarea = modal ? modal.querySelector('.done-modal-textarea') : null;
    const completionNotes = textarea ? textarea.value.trim() : '';

    // Fetch the task so we can use its fields (e.g. task_desc) safely
    const task = await getTaskById(taskId, reportType);
    // If task couldn't be fetched, continue but guard when building the log message
    const taskDesc = task && task.task_desc ? String(task.task_desc) : '';

    const taskRef = doc(db, "IT_Reports", reportType, "tasks", taskId);
    await updateDoc(taskRef, {
      task_status: "Completed",
      task_completed_by: currentUser.uid,
      task_completed_date: serverTimestamp(),
      task_completion_notes: completionNotes
    });

    window.closeDoneModal();
    alert("Task completed successfully");

    // Build a safe log message (use task description if available, otherwise fallback to notes)
    const excerptSource = taskDesc || completionNotes || '(no description)';
    const excerpt = excerptSource.length > 50 ? excerptSource.substring(0, 50) + '...' : excerptSource;
    await logAdmin("task", `Completed ${reportType} task: ${excerpt}`);

  } catch (error) {
    console.error("Error completing task:", error);
    alert("Failed to complete task");
  }
}

/**
 * Open Complete task modal
 */
window.openCompleteModal = async function(taskId, reportType) {
  const task = await getTaskById(taskId, reportType);
  if (!task) return;
  
  // Create or get complete modal (we'll make a new one)
  let modal = document.getElementById('completeModal');
  
  // If modal doesn't exist, create it
  if (!modal) {
    modal = createCompleteModal();
    document.body.appendChild(modal);
  }
  
  // Populate modal with task data
  const descElem = modal.querySelector('.complete-modal-description');
  if (descElem) {
    descElem.textContent = task.task_desc || "No description";
  }
  
  // Creator info
  const creatorInfo = await getUserInfo(task.task_creator);
  const creatorName = modal.querySelector('.complete-info-creator-name');
  if (creatorName) {
    creatorName.textContent = creatorInfo.name || "Unknown";
  }
  
  const creatorDate = modal.querySelector('.complete-info-creator-date');
  if (creatorDate && task.task_created_date) {
    creatorDate.textContent = formatDate(task.task_created_date);
  }
  
  // Starter info
  const starterInfo = await getUserInfo(task.task_started_by);
  const starterName = modal.querySelector('.complete-info-starter-name');
  if (starterName) {
    starterName.textContent = starterInfo.name || "Unknown";
  }
  
  const starterDate = modal.querySelector('.complete-info-starter-date');
  if (starterDate && task.task_started_date) {
    starterDate.textContent = formatDate(task.task_started_date);
  }
  
  // Completer info
  const completerInfo = await getUserInfo(task.task_completed_by);
  const completerName = modal.querySelector('.complete-info-completer-name');
  if (completerName) {
    completerName.textContent = completerInfo.name || "IT Admin";
  }
  
  const completerDate = modal.querySelector('.complete-info-completer-date');
  if (completerDate && task.task_completed_date) {
    completerDate.textContent = formatDate(task.task_completed_date);
  }
  
  // Completion notes
  const notesElem = modal.querySelector('.complete-notes-content');
  if (notesElem) {
    notesElem.textContent = task.task_completion_notes || "No completion notes provided.";
  }
  
  // Show attached files if any
  const filesContainer = modal.querySelector('.complete-files-container');
  if (filesContainer && task.task_pic && Array.isArray(task.task_pic) && task.task_pic.length > 0) {
    filesContainer.style.display = 'block';
    const filesList = modal.querySelector('.complete-files-list');
    if (filesList) {
      filesList.innerHTML = '';
      task.task_pic.forEach((url, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'complete-file-item';
        fileItem.innerHTML = `
          <a href="${url}" target="_blank" style="color: #0847b2; text-decoration: underline;">
            📎 Attachment ${index + 1}
          </a>
        `;
        filesList.appendChild(fileItem);
      });
    }
  } else if (filesContainer) {
    filesContainer.style.display = 'none';
  }
  
  modal.classList.add('active');
};

/**
 * Create Complete Modal HTML structure
 */
function createCompleteModal() {
  const modal = document.createElement('div');
  modal.id = 'completeModal';
  modal.className = 'complete-modal-overlay';
  
  modal.innerHTML = `
    <div class="complete-modal-content">
      <button class="complete-close-modal" onclick="window.closeCompleteModal()">&times;</button>
      <div class="complete-modal-header">Completed Task Details</div>
      <div class="complete-modal-body">
        <h3 class="complete-modal-description"></h3>
        
        <div class="complete-modal-info-grid">
          <div class="complete-modal-info-row">
            <div class="complete-modal-info-block">
              <div class="complete-modal-info-label">Task Created by</div>
              <div class="complete-info-creator-name complete-modal-info-value">Unknown</div>
            </div>
            
            <div class="complete-modal-info-block">
              <div class="complete-modal-info-label">Task Started by</div>
              <div class="complete-info-starter-name complete-modal-info-value-green">Unknown</div>
            </div>
          </div>

          <div class="complete-modal-info-row">
            <div class="complete-modal-info-block">
              <div class="complete-modal-info-label">Task Created on</div>
              <div class="complete-info-creator-date complete-modal-info-value">N/A</div>
            </div>
            
            <div class="complete-modal-info-block">
              <div class="complete-modal-info-label">Task Started on</div>
              <div class="complete-info-starter-date complete-modal-info-value-green">N/A</div>
            </div>
          </div>
          
          <div class="complete-modal-info-row">
            <div class="complete-modal-info-block">
              <div class="complete-modal-info-label">Task Completed by</div>
              <div class="complete-info-completer-name complete-modal-info-value-blue">Unknown</div>
            </div>
            
            <div class="complete-modal-info-block">
              <div class="complete-modal-info-label">Task Completed on</div>
              <div class="complete-info-completer-date complete-modal-info-value-blue">N/A</div>
            </div>
          </div>
        </div>
        
        <div class="complete-notes-section">
          <div class="complete-notes-label">Completion Notes:</div>
          <div class="complete-notes-content"></div>
        </div>
        
        <div class="complete-files-container" style="display: none;">
          <div class="complete-files-label">Attached Files:</div>
          <div class="complete-files-list"></div>
        </div>
      </div>
    </div>
  `;
  
  // Add click outside to close
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      window.closeCompleteModal();
    }
  });
  
  return modal;
}

/**
 * Close Complete Modal
 */
window.closeCompleteModal = function() {
  const modal = document.getElementById('completeModal');
  if (modal) {
    modal.classList.remove('active');
  }
};

/**
 * Get task by ID
 */
async function getTaskById(taskId, reportType) {
  try {
    const taskRef = doc(db, "IT_Reports", reportType, "tasks", taskId);
    const taskSnap = await getDoc(taskRef);
    
    if (taskSnap.exists()) {
      return {
        id: taskSnap.id,
        reportType,
        ...taskSnap.data()
      };
    }
    return null;
  } catch (error) {
    console.error("Error fetching task:", error);
    return null;
  }
}

/**
 * Get user info from account_details
 */
async function getUserInfo(uid) {
  if (!uid) return { name: "Unknown" };
  
  try {
    const userRef = doc(db, "account_details", uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const data = userSnap.data();
      const name = data.name || `${data.lname || ''}, ${data.fname || ''}`.trim() || "Unknown";
      return { name, ...data };
    }
    return { name: "Unknown" };
  } catch (error) {
    console.error("Error fetching user:", error);
    return { name: "Unknown" };
  }
}

/**
 * Format date for display
 */
function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  
  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    return "Invalid Date";
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
 * Cleanup listeners
 */
export function cleanupITTasks() {
  activeListeners.forEach(unsubscribe => {
    try {
      unsubscribe();
    } catch (error) {
      console.error("Error unsubscribing:", error);
    }
  });
  activeListeners.clear();
  tasksCache.clear();
}

/**
 * Global showPage function for navigation
 */
window.showPage = function(pageId, element) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => {
    p.style.display = 'none';
    p.classList.remove('active');
  });
  
  // Show target page
  const page = document.getElementById(pageId);
  if (page) {
    page.style.display = 'block';
    page.classList.add('active');
  }
  
  // Update sidebar
  if (element) {
    document.querySelectorAll('.sidebar a').forEach(a => {
      a.classList.remove('active');
      const img = a.querySelector('img.icon');
      if (img) {
        img.src = img.src.replace('ic_sba_', 'ic_sb_');
      }
    });
    
    element.classList.add('active');
    const activeImg = element.querySelector('img.icon');
    if (activeImg) {
      activeImg.src = activeImg.src.replace('ic_sb_', 'ic_sba_');
    }
  }
  
  // Update page title
  const pageTitle = document.getElementById('pageTitle');
  if (pageTitle && element) {
    pageTitle.textContent = element.textContent.trim();
  }
  
  // Re-wire overview cards if going back to tasks page
  if (pageId === 'tasks') {
    setTimeout(() => {
      wireOverviewCards();
      updateTaskCounts();
    }, 100);
  }
};

// File upload handlers for Done modal
window.showFileName = function() {
  const input = document.getElementById('doneFileInput');
  const fileNameDiv = document.getElementById('selectedFileName');
  
  if (input.files.length > 0) {
    const file = input.files[0];
    fileNameDiv.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 15px; background: #f8f9fa; border-radius: 6px; border: 1px solid #e0e0e0;">
        <span style="cursor: pointer; color: #0847b2; text-decoration: underline; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(file.name)}</span>
        <button onclick="window.removeFile()" style="background: none; border: none; color: #dc3545; font-size: 20px; cursor: pointer; font-weight: bold; margin-left: 10px; padding: 0 5px;">&times;</button>
      </div>
    `;
  } else {
    fileNameDiv.innerHTML = '';
  }
};

window.removeFile = function() {
  document.getElementById('doneFileInput').value = '';
  document.getElementById('selectedFileName').innerHTML = '';
};

// Modal overlay close handlers
window.closeModalOnOverlay = function(event) {
  if (event.target.id === 'taskModal') {
    window.closeModal();
  }
};

window.closePendingModalOnOverlay = function(event) {
  if (event.target.id === 'pendingModal') {
    window.closePendingModal();
  }
};

window.closeDoneModalOnOverlay = function(event) {
  if (event.target.id === 'doneModal') {
    window.closeDoneModal();
  }
};

export default {
  initializeITTasks,
  cleanupITTasks
};