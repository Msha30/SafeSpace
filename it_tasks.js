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

/**
 * Initialize IT Tasks system
 */
export async function initializeITTasks() {
  console.log("Initializing IT Tasks...");
  
  // Setup listeners for each report type
  REPORT_TYPES.forEach(type => {
    setupTaskListener(type.id);
  });
  
  // Update task counts in overview cards
  updateTaskCounts();
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
      
      // Update counts
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
  const pageId = reportType.toLowerCase();
  const page = document.getElementById(pageId);
  if (!page) return;
  
  // Group tasks by status
  const todoTasks = tasks.filter(t => t.task_status === "To_Do");
  const pendingTasks = tasks.filter(t => t.task_status === "Pending");
  const completedTasks = tasks.filter(t => t.task_status === "Completed");
  
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
    const textarea = modal.querySelector('.done-modal-textarea');
    const completionNotes = textarea ? textarea.value.trim() : '';
    
    const taskRef = doc(db, "IT_Reports", reportType, "tasks", taskId);
    await updateDoc(taskRef, {
      task_status: "Completed",
      task_completed_by: currentUser.uid,
      task_completed_date: serverTimestamp(),
      task_completion_notes: completionNotes
    });
    
    window.closeDoneModal();
    alert("Task completed successfully");
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
  
  const modal = document.getElementById('pendingModal'); // Reuse pending modal for viewing
  if (!modal) return;
  
  const descElem = document.getElementById('pendingModalTaskDescription');
  if (descElem) {
    descElem.textContent = task.task_desc || "No description";
  }
  
  // Show completion info
  const creatorInfo = await getUserInfo(task.task_creator);
  const completerInfo = await getUserInfo(task.task_completed_by);
  
  const creatorNameElem = modal.querySelectorAll('.pending-modal-info-value')[0];
  if (creatorNameElem) {
    creatorNameElem.textContent = creatorInfo.name || "Unknown";
  }
  
  const creatorDateElem = modal.querySelectorAll('.pending-modal-info-value')[2];
  if (creatorDateElem && task.task_created_date) {
    creatorDateElem.textContent = formatDate(task.task_created_date);
  }
  
  const completerNameElem = modal.querySelectorAll('.pending-modal-info-value-green')[0];
  if (completerNameElem) {
    completerNameElem.textContent = completerInfo.name || "IT Admin";
  }
  
  const completerDateElem = modal.querySelectorAll('.pending-modal-info-value-green')[1];
  if (completerDateElem && task.task_completed_date) {
    completerDateElem.textContent = formatDate(task.task_completed_date);
  }
  
  modal.classList.add('active');
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
