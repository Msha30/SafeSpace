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


    // update task doc with URLs and task_id
    await updateDoc(taskDocRef, {
      task_pic: uploadedUrls,
      task_id: taskId
    });

    // clear UI
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