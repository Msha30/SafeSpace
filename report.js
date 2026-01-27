// report.js (ES module)
import { db, auth } from "./auth.js";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { logGCO } from "./logger.js";

const SUPABASE_URL = "https://saqbiryyijzntzizkncv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhcWJpcnl5aWp6bnR6aXprbmN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxNjg3NjgsImV4cCI6MjA3OTc0NDc2OH0.wr-zLfv5jLsPv-iXJb8fDRCTfIntnwYfTc4DgV4bNds";
const SUPABASE_BUCKET = "ProfilePictures"; // change if you have a reports bucket

// --- 1. GLOBAL STATE ---
// Ensure global uploadedFiles exists
if (typeof window.uploadedFiles === "undefined") {
  window.uploadedFiles = [];
}

// --- 2. UI HELPER FUNCTIONS (Attached to window for inline onclick handlers) ---

/**
 * Handles file input changes and adds them to the global array
 */
window.handleFileUpload2 = function(files) {
  if (!files || files.length === 0) return;
  
  // Convert FileList to Array and add to global state
  Array.from(files).forEach(file => {
    window.uploadedFiles.push(file);
  });

  window.renderFiles2();
};

/**
 * Removes a file from the array by index
 */
window.removeFile2 = function(index) {
  window.uploadedFiles.splice(index, 1);
  window.renderFiles2();
};

/**
 * Renders the uploaded files into the .file-boxes2 container
 */
window.renderFiles2 = function() {
  const container = document.querySelector('.file-boxes2');
  const addButton = document.querySelector('.add-file2');
  
  // Remove old file previews (keep the add button)
  const oldPreviews = container.querySelectorAll('.file-preview-wrap');
  oldPreviews.forEach(el => el.remove());

  // Insert new previews before the add button
  window.uploadedFiles.forEach((file, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'file2 file-preview-wrap';
    
    // Create preview
    let previewContent = '';
    if (file.type.startsWith('image/')) {
      const imgUrl = URL.createObjectURL(file);
      previewContent = `<img src="${imgUrl}" onclick="window.openViewer2('${imgUrl}')" style="width:100%; height:100%; object-fit:cover; border-radius:4px;">`;
    } else if (file.type.startsWith('video/')) {
      const vidUrl = URL.createObjectURL(file);
      previewContent = `<video src="${vidUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:4px;"></video>`;
    } else {
      previewContent = `<span style="font-size:24px; display:flex; align-items:center; justify-content:center; height:100%;">📄</span>`;
    }

    // Remove button (X)
    const removeBtn = `<div onclick="window.removeFile2(${index})" style="position:absolute; top:2px; right:2px; background:red; color:white; border-radius:50%; width:16px; height:16px; font-size:10px; cursor:pointer; display:flex; align-items:center; justify-content:center;">&times;</div>`;

    wrapper.innerHTML = `
      ${removeBtn}
      <div style="width:100%; height:100%; position:relative; overflow:hidden; border-radius:4px; background:#f0f0f0;">
        ${previewContent}
      </div>
    `;

    container.insertBefore(wrapper, addButton);
  });
};

/**
 * Opens the full screen image viewer
 */
window.openViewer2 = function(url) {
  const modal = document.getElementById('fileViewer2');
  const grid = document.getElementById('fileViewerGrid2');
  
  grid.innerHTML = `
    <img src="${url}" style="max-width:100%; max-height:80vh; border-radius:8px;">
  `;
  
  modal.style.display = 'flex';
};

/**
 * Closes the file viewer
 */
window.closeViewer2 = function() {
  document.getElementById('fileViewer2').style.display = 'none';
};

/**
 * Opens the confirmation popup
 */
window.showReportConfirm = function() {
  document.getElementById('reportConfirmPopup').style.display = 'flex';
};

/**
 * Closes the confirmation popup
 */
window.closeReportConfirm = function() {
  document.getElementById('reportConfirmPopup').style.display = 'none';
};

/**
 * Confirms the report and calls the submission logic
 */
window.confirmReport = async function() {
  // Disable buttons to prevent double submission
  const btn = document.querySelector('.reportBtnConfirm');
  if(btn) {
    btn.disabled = true;
    btn.textContent = "Submitting...";
  }

  try {
    await submitReport();
    window.closeReportConfirm();
  } catch (error) {
    console.error(error);
    alert("Error submitting report. Check console.");
  } finally {
    if(btn) {
      btn.disabled = false;
      btn.textContent = "Submit Report";
    }
  }
};

// --- 3. DRAG AND DROP LOGIC ---
const dropArea2 = document.getElementById('dropArea2');

if (dropArea2) {
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea2.addEventListener(eventName, preventDefaults, false);
  });

  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }

  dropArea2.addEventListener('drop', handleDrop, false);

  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    window.handleFileUpload2(files);
  }
}

// --- 4. BACKEND LOGIC (Your provided logic with tweaks) ---

/**
 * Upload a file to Supabase storage. Returns { publicUrl }.
 * Requires sessionStorage.idToken to contain Firebase ID token (Bearer).
 */
export async function uploadToSupabase(file, bucket = SUPABASE_BUCKET, path) {
  if (!file) throw new Error("uploadToSupabase: missing file");
  if (!path) throw new Error("uploadToSupabase: missing path");

  const idToken = sessionStorage.getItem("idToken");
  if (!idToken) throw new Error("uploadToSupabase: missing idToken in sessionStorage");

  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`;

  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_ANON_KEY,
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": file.type || "application/octet-stream"
    },
    body: file
  });

  if (!res.ok) {
    let json = null;
    try { json = await res.json(); } catch (_) { /* ignore */ }
    throw new Error(`Supabase upload failed: ${json?.message || res.statusText}`);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}`;
  return { publicUrl };
}

/**
 * Returns the selected radio value from #reports (name="type").
 * Graceful fallback: uses radio label textContent when value is empty.
 */
function getSelectedReportType() {
  const checked = document.querySelector('#reports input[name="type"]:checked');
  if (!checked) return null;
  // If radio has a value attribute, use it; otherwise attempt to read nearby label text
  if (checked.value && checked.value.trim() !== "") return checked.value.trim();
  // try parent label text
  const parent = checked.closest('label');
  if (parent) return parent.textContent.trim();
  return null;
}

function getReportDescription() {
  const ta = document.querySelector('#reports textarea.report');
  return ta ? ta.value.trim() : "";
}

function clearUploadedFilesAndUI() {
  if (Array.isArray(window.uploadedFiles)) window.uploadedFiles.length = 0;
  // Use the global render function to clear UI
  window.renderFiles2();
}

/**
 * submitReport()
 * - creates a task in IT_Reports/{reportType}/tasks
 * - uploads attached files sequentially to Supabase under reports/{taskId}/taskid_{n}.ext
 * - updates task doc with task_pic array of public URLs
 */
export async function submitReport() {
  try {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      alert("You must be logged in to submit a report.");
      return;
    }

    const reportTypeRaw = getSelectedReportType();
    if (!reportTypeRaw) {
      alert("Please select a report type.");
      return;
    }

    const reportTypeId = String(reportTypeRaw).replace(/[\/\\#\[\]\s]+/g, "_").trim() || "general";
    const description = getReportDescription();

    if (!description) {
        alert("Please enter a description.");
        return;
    }

    // create task doc in subcollection
    const tasksColRef = collection(db, "IT_Reports", reportTypeId, "tasks");
    const taskDocRef = await addDoc(tasksColRef, {
      task_creator: currentUser.uid,
      task_desc: description,
      task_pic: [],
      task_status: "To_Do",
      task_created_date: serverTimestamp()
    });

    const taskId = taskDocRef.id;
    const uploadedUrls = [];

    // upload each file sequentially (deterministic naming)
    const files = Array.isArray(window.uploadedFiles) ? window.uploadedFiles.slice() : [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const origName = file.name || "";
        let ext = "";
        const idx = origName.lastIndexOf(".");
        if (idx !== -1) ext = origName.substring(idx); // includes dot
        else {
          const mime = file.type || "";
          if (mime.includes("/")) ext = "." + mime.split("/")[1];
        }

        const fileName = `taskid_${i + 1}${ext}`;
        const path = `reports/${taskId}/${fileName}`;

        const { publicUrl } = await uploadToSupabase(file, SUPABASE_BUCKET, path);
        uploadedUrls.push(publicUrl);
      } catch (err) {
        console.error(`Failed to upload file #${i + 1}:`, err);
        // continue with other files
      }
    }

    // update task doc with URLs and task_id
    await updateDoc(taskDocRef, {
      task_pic: uploadedUrls,
      task_id: taskId
    });

    // clear UI
    clearUploadedFilesAndUI();
    const textarea = document.querySelector('#reports textarea.report');
    if (textarea) textarea.value = "";
    
    // Uncheck radios
    const checkedRadio = document.querySelector('#reports input[name="type"]:checked');
    if(checkedRadio) checkedRadio.checked = false;

    alert("Report submitted successfully.");
    await logGCO("report", `Submitted ${reportTypeId} report`);
    console.log("Report created:", { reportTypeId, taskId, uploadedUrls });
    return { reportTypeId, taskId, uploadedUrls };
  } catch (err) {
    console.error("Failed to submit report:", err);
    alert("Failed to submit report. See console for details.");
    throw err;
  }
}