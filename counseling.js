import { app, auth } from "./auth.js";
import * as Call from "./call.js";
import {
  getFirestore,
  collection,
  getDocs,
  deleteDoc,
  addDoc,
  setDoc,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  runTransaction,
  serverTimestamp,
  query, 
  where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const db = getFirestore(app);

// Caches
const avatarCache = new Map();
const accountCache = new Map();
const formCache = new Map();

let activeCallCleanup = null;
let activeCallId = null;

// Fetch avatar with cache
async function getAvatarUrl(uid) {
  if (!uid) return null;
  if (avatarCache.has(uid)) return avatarCache.get(uid);

  try {
    const snap = await getDoc(doc(db, "account_details", uid));
    const avatarUrl = snap.exists() ? snap.data().avatarUrl : null;
    avatarCache.set(uid, avatarUrl);
    return avatarUrl;
  } catch (err) {
    console.error("Failed to fetch avatar for", uid, err);
    return null;
  }
}

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

// Fetch account data with cache
async function getAccountData(uid) {
  if (!uid) return {};
  if (accountCache.has(uid)) return accountCache.get(uid);

  try {
    const snap = await getDoc(doc(db, "account_details", uid));
    const data = snap.exists() ? snap.data() : {};
    accountCache.set(uid, data);
    return data;
  } catch (err) {
    console.error("Failed to fetch account data for", uid, err);
    return {};
  }
}

// Fetch form data with cache
async function getFormData(formId) {
  if (!formId) return {};
  if (formCache.has(formId)) return formCache.get(formId);

  try {
    const snap = await getDoc(doc(db, "CounselingForm", formId));
    const data = snap.exists() ? snap.data() : {};
    formCache.set(formId, data);
    return data;
  } catch (err) {
    console.error("Failed to fetch form data for", formId, err);
    return {};
  }
}

function tsToMillis(ts) {
  if (!ts) return 0;
  // Firestore Timestamp has toDate()
  if (typeof ts.toDate === "function") {
    return ts.toDate().getTime();
  }
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === "number") return ts;
  // fallback: try Date parse
  const parsed = Date.parse(ts);
  return isNaN(parsed) ? 0 : parsed;
}

export async function openDetailsPopup(uid, formId) {
  const popup = document.getElementById("detailsPopup");
  if (!popup) return;

  try {
    // Fetch submission
    const submissionSnap = await getDoc(doc(db, "CounselingForm_Submissions", formId));
    const isSubmission = submissionSnap.exists();
    const submission = isSubmission ? submissionSnap.data() : null;

    // Determine account UID
    const accUid = (submission && submission.createdBy) ? submission.createdBy : uid;
    const accData = await getAccountData(accUid);

    // Fallback for template
    const formData = isSubmission ? {} : await getFormData(formId);

    // LEFT SIDE: profile & name
    const img = popup.querySelector(".popup-profile-img");
    if (img) img.src = resolveAvatarUrl(accData.avatarUrl) || "photos/pic_placeholder.png";

    const nameElem = popup.querySelector(".popup-left h2");
    if (nameElem) nameElem.textContent = `${accData.lname || ""}${accData.lname && accData.fname ? ", " : ""}${accData.fname || ""}`.trim();

    const dateElem = popup.querySelector(".date-created-left strong");
    const createdAt = (submission && submission.createdAt) ? submission.createdAt : (formData && formData.createdAt) ? formData.createdAt : accData.createdAt;
    if (dateElem) dateElem.textContent = createdAt ? formatDate(createdAt) : "N/A";

    // RIGHT SIDE
    const rightContainer = popup.querySelector(".popup-right");
    if (!rightContainer) return;
    rightContainer.innerHTML = ""; // clear old content

    // Combine all fields into a flat array
    const fields = [
      { label: "First Name", value: accData.fname },
      { label: "Middle Name", value: accData.mname || "" },
      { label: "Last Name", value: accData.lname },
      { label: "Program", value: accData.program },
      { label: "Student ID", value: accData.studentId }
    ];

    // Include submission questions after account info
    if (isSubmission) {
      const questions = Array.isArray(submission.questions) ? submission.questions : [];
      questions.forEach(q => {
        let answer = q.answer;
        if (Array.isArray(answer)) answer = answer.join(", ");
        fields.push({ label: q.text || q.id || "Question", value: answer || "" });
      });
    }

    // Now build rows: 2 items per row
    for (let i = 0; i < fields.length; i += 2) {
      const row = document.createElement("div");
      row.classList.add("detail-row");

      // Left item
      const left = document.createElement("div");
      left.classList.add("detail-item");
      const leftLabel = document.createElement("label");
      leftLabel.textContent = fields[i].label;
      const leftP = document.createElement("p");
      leftP.textContent = fields[i].value || "N/A";
      left.appendChild(leftLabel);
      left.appendChild(leftP);
      row.appendChild(left);

      // Right item if exists
      if (fields[i + 1]) {
        const right = document.createElement("div");
        right.classList.add("detail-item");
        const rightLabel = document.createElement("label");
        rightLabel.textContent = fields[i + 1].label;
        const rightP = document.createElement("p");
        rightP.textContent = fields[i + 1].value || "N/A";
        right.appendChild(rightLabel);
        right.appendChild(rightP);
        row.appendChild(right);
      }

      rightContainer.appendChild(row);
    }

    popup.style.display = "block";

  } catch (err) {
    console.error("Failed to load details:", err);
  }
}

// Close popup
export function closeDetailsPopup() {
  const popup = document.getElementById("detailsPopup");
  if (popup) popup.style.display = "none";
}

window.addEventListener("click", (e) => {
  const popup = document.getElementById("detailsPopup");
  if (popup && e.target === popup) popup.style.display = "none";
});

window.openDetailsPopup = openDetailsPopup;
window.closeDetailsPopup = closeDetailsPopup;

// Helpers
function formatDate(timestamp) {
  if (!timestamp) return "N/A";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatPlatform(platform) {
  if (!platform) return "N/A";
  const value = platform.replace(/\s+/g, " ").trim().toLowerCase();
  switch (value) {
    case "call": return "Voice Call";
    case "face to face": return "In-Person";
    case "video call": return "Video Call";
    default: return "N/A";
  }
}

function toLocalDatetimeInputValue(dateLike) {
  if (!dateLike) return "";
  const ms = tsToMillis(dateLike);
  if (!ms) return "";
  const d = new Date(ms);
  // format YYYY-MM-DDTHH:MM (no seconds) for datetime-local
  const YYYY = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, "0");
  const DD = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${YYYY}-${MM}-${DD}T${hh}:${mm}`;
}

function formatTimeRange(assigned_sched) {
  if (!assigned_sched || (!assigned_sched.start && !assigned_sched.end)) return "Pending Schedule";
  const sMs = tsToMillis(assigned_sched.start);
  const eMs = tsToMillis(assigned_sched.end);
  if (!sMs || !eMs) return "Pending Schedule";
  const sDate = new Date(sMs);
  const eDate = new Date(eMs);
  const sStr = sDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const eStr = eDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${sStr} - ${eStr}`;
}

// START CALL stub - replace with your call integration
async function startCall(submissionId) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    alert("You must be logged in to start the call.");
    return;
  }

  try {
    // 1. Get submission data to determine call type
    const docRef = doc(db, "CounselingForm_Submissions", submissionId);
    const submissionSnap = await getDoc(docRef);
    
    if (!submissionSnap.exists()) {
      alert("Submission not found.");
      return;
    }

    const submission = submissionSnap.data();
    const preferredPlatform = (submission.preferredPlatform || "").toLowerCase().trim();
    
    // Determine call mode based on preferred platform
    let mode = "video"; // default
    if (preferredPlatform.includes("call") && !preferredPlatform.includes("video")) {
      mode = "audio";
    } else if (preferredPlatform.includes("face to face") || preferredPlatform.includes("in-person")) {
      mode = "face-to-face";
    }

    console.log("[counseling.js] Starting call with mode:", mode);

    // 2. Update submission status
    await updateDoc(docRef, {
      status: "in_progress",
      started_by: currentUser.uid,
      started_at: serverTimestamp()
    });

    // 3. Handle Face-to-Face differently
    if (mode === "face-to-face") {
      showFaceToFaceOverlay(submissionId);
      return;
    }

    // 4. SHOW THE VIDEO/AUDIO CALL OVERLAY
    const overlay = document.getElementById("videoCallOverlay");
    const statusText = document.getElementById("callStatus");
    const localVideo = document.getElementById("callLocalVideo");
    const remoteVideo = document.getElementById("callRemoteVideo");
    
    if (overlay) {
      overlay.style.display = "flex";
      
      // Add appropriate class for styling
      overlay.classList.remove('audio-call', 'video-call');
      overlay.classList.add(mode === "audio" ? 'audio-call' : 'video-call');
    }
    
    if (statusText) statusText.textContent = "Connecting...";

    // 5. Start the WebRTC call
    const meteredApiKey = undefined;

    const hangup = await Call.startCall({
      submissionId,
      mode,
      meteredApiKey,
      dom: { localVideo, remoteVideo },
      onStatusChange(status) {
        console.log("Call status:", status);
        if (statusText) {
          if (status === "ringing") statusText.textContent = "Ringing...";
          if (status === "connected") statusText.textContent = "Connected";
          if (status === "ended") {
            statusText.textContent = "Call Ended";
            showCallCompleteButton(submissionId);
          }
        }
      },
      onError(err) {
        console.error("Call error:", err);
        alert("Call error: " + err.message);
        if (overlay) overlay.style.display = "none";
        activeCallCleanup = null;
        activeCallId = null;
      }
    });

    // Store cleanup function globally
    activeCallCleanup = hangup;
    activeCallId = submissionId;

    // 6. Wire up the Hang Up button
    const btnHangup = document.getElementById("btnHangup");
    if (btnHangup) {
      const newBtn = btnHangup.cloneNode(true);
      btnHangup.parentNode.replaceChild(newBtn, btnHangup);
      
      newBtn.addEventListener("click", () => {
        if (activeCallCleanup) {
          activeCallCleanup();
          activeCallCleanup = null;
        }
        showCallCompleteButton(submissionId);
      });
    }

  } catch (err) {
    console.error("Failed to start call:", err);
    alert("Failed to start call. See console.");
    document.getElementById("videoCallOverlay").style.display = "none";
    activeCallCleanup = null;
    activeCallId = null;
  }
}

function showFaceToFaceOverlay(submissionId) {
  const overlay = document.getElementById("faceToFaceOverlay");
  if (!overlay) {
    // Create overlay if it doesn't exist
    const newOverlay = document.createElement("div");
    newOverlay.id = "faceToFaceOverlay";
    newOverlay.className = "face-to-face-overlay";
    newOverlay.innerHTML = `
      <div class="face-to-face-content">
        <div class="face-to-face-icon">
          <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
        </div>
        <h2>Face-to-Face Session</h2>
        <p>Session is currently in progress</p>
        <div class="face-to-face-timer" id="sessionTimer">00:00</div>
        <button id="btnEndSession" class="btn-end-session">End Session</button>
      </div>
    `;
    document.body.appendChild(newOverlay);
  }
  
  const faceOverlay = document.getElementById("faceToFaceOverlay");
  faceOverlay.style.display = "flex";
  
  // Start timer
  startSessionTimer();
  
  // End session button
  const btnEnd = document.getElementById("btnEndSession");
  if (btnEnd) {
    btnEnd.onclick = () => {
      stopSessionTimer();
      showCallCompleteButton(submissionId);
    };
  }
}

let timerInterval = null;
let timerSeconds = 0;

function startSessionTimer() {
  timerSeconds = 0;
  const timerEl = document.getElementById("sessionTimer");
  
  timerInterval = setInterval(() => {
    timerSeconds++;
    const mins = Math.floor(timerSeconds / 60).toString().padStart(2, '0');
    const secs = (timerSeconds % 60).toString().padStart(2, '0');
    if (timerEl) timerEl.textContent = `${mins}:${secs}`;
  }, 1000);
}

function stopSessionTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function showCallCompleteButton(submissionId) {
  const videoOverlay = document.getElementById("videoCallOverlay");
  const faceOverlay = document.getElementById("faceToFaceOverlay");
  
  // Hide hangup button, show complete button
  const btnHangup = document.getElementById("btnHangup");
  if (btnHangup) btnHangup.style.display = "none";
  
  const btnEndSession = document.getElementById("btnEndSession");
  if (btnEndSession) btnEndSession.style.display = "none";
  
  // Create complete button if it doesn't exist
  let completeBtn = document.getElementById("btnCompleteCall");
  if (!completeBtn) {
    completeBtn = document.createElement("button");
    completeBtn.id = "btnCompleteCall";
    completeBtn.className = "btn-complete-call";
    completeBtn.textContent = "Mark as Complete";
    
    // Add to appropriate overlay
    if (videoOverlay && videoOverlay.style.display !== "none") {
      const controlsWrapper = videoOverlay.querySelector(".call-controls-wrapper");
      if (controlsWrapper) controlsWrapper.appendChild(completeBtn);
    } else if (faceOverlay && faceOverlay.style.display !== "none") {
      const content = faceOverlay.querySelector(".face-to-face-content");
      if (content) content.appendChild(completeBtn);
    }
  }
  
  completeBtn.style.display = "block";
  completeBtn.onclick = async () => {
    await completeCall(submissionId);
    
    // Hide overlays
    if (videoOverlay) videoOverlay.style.display = "none";
    if (faceOverlay) faceOverlay.style.display = "none";
    
    // Reset
    if (completeBtn) completeBtn.remove();
    if (btnHangup) btnHangup.style.display = "block";
    if (btnEndSession) btnEndSession.style.display = "block";
    
    activeCallCleanup = null;
    activeCallId = null;
  };
}

// Key fix: Add activeCallCleanup() call in completeCall function

async function completeCall(submissionId) {
  try {
    // CRITICAL FIX: Stop all media tracks BEFORE marking as complete
    if (activeCallCleanup) {
      console.log("[counseling.js] Stopping media tracks...");
      activeCallCleanup();
      activeCallCleanup = null;
    }
    
    const docRef = doc(db, "CounselingForm_Submissions", submissionId);
    
    await updateDoc(docRef, {
      status: "completed",
      completed_at: serverTimestamp(),
      completed_by: auth.currentUser.uid
    });
    
    // Delete specific call for this submission
    const callsRef = collection(db, "calls");
    const q = query(callsRef, where("submissionId", "==", submissionId));
    const callsSnapshot = await getDocs(q);
    
    for (const callDoc of callsSnapshot.docs) {
      await deleteCallDocument(callDoc.ref);
    }
    
    console.log("[counseling.js] Call completed and cleaned up");
    alert("Session marked as complete!");
    
    // Reset active call ID
    activeCallId = null;
    
  } catch (err) {
    console.error("Error completing call:", err);
    alert("Failed to complete session. Please try again.");
  }
}

// Helper function to delete call document and subcollections
async function deleteCallDocument(callDocRef) {
  try {
    // 1. Delete offerCandidates subcollection
    const offerCandidatesRef = collection(callDocRef, "offerCandidates");
    const offerSnapshot = await getDocs(offerCandidatesRef);
    const offerDeletes = offerSnapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(offerDeletes);
    
    // 2. Delete answerCandidates subcollection
    const answerCandidatesRef = collection(callDocRef, "answerCandidates");
    const answerSnapshot = await getDocs(answerCandidatesRef);
    const answerDeletes = answerSnapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(answerDeletes);
    
    // 3. Delete the call document itself
    await deleteDoc(callDocRef);
    
    console.log("[counseling.js] Call document deleted");
  } catch (err) {
    console.error("[counseling.js] Error deleting call document:", err);
  }
}

// Create session card from submission (submissionId)
export async function createSessionCardFromData(submissionId, submission) {
  // submission is the object from snapshot.docs[i].data()
  if (!submission) return null;

  const currentUid = auth.currentUser ? auth.currentUser.uid : null;

  // if submission is taken by someone else -> do not render for this user
  if (submission.taken_by && submission.taken_by !== currentUid) {
    return null;
  }

  // Fetch account data of the submission creator (cached)
  const accData = await getAccountData(submission.createdBy);
  const avatarUrl = resolveAvatarUrl(accData.avatarUrl) || (submission.createdBy ? await getAvatarUrl(submission.createdBy) : null);

  const card = document.createElement("div");
  card.classList.add("card-session");

  const urgent = (submission.urgent || "").toString().trim().toLowerCase() === "yes";

  // compute time text from assigned_sched if present
  const timeText = (submission.assigned_sched) ? formatTimeRange(submission.assigned_sched) : "Pending Schedule";

  // show Assigned Schedule instead of Preferred Schedule when assigned exists
  const scheduleLine = submission.assigned_sched
    ? `Assigned Schedule: <strong>${formatDate(submission.assigned_sched.start)} ${timeText}</strong>`
    : `Preferred Schedule: <strong>${submission.preferredSchedule || "N/A"}</strong>`;

  // determine button + wrapper alignment
  let actionButtonHtml = '';
  let actionBtnWrapperClass = '';

  if (!submission.taken_by) {
    // not taken
    actionBtnWrapperClass = 'session-btn-right';
    // keep class 'btn start' but use data-action to disambiguate behavior
    actionButtonHtml = `<button class="btn start" data-action="take">Take Session</button>`;
  } else if (submission.taken_by === currentUid) {
    // taken by current user
    actionBtnWrapperClass = 'session-btn-left';
    actionButtonHtml = `<button class="btn start" data-action="start">Start Call</button>`;
  } else {
    // safety fallback (should not happen due to early return)
    return null;
  }

  card.innerHTML = `
      <h3>${formatDate(submission.createdAt)} - ${formatPlatform(submission.preferredPlatform)}</h3>
      <div class="session-mode-left">
        <img src="${resolveAvatarUrl(avatarUrl) || 'photos/pic_placeholder.png'}" alt="Avatar">
        <div class="session-details-left">
          <div class="time">${timeText}</div>
          <div class="name">${accData.fname || submission.fname || "N/A"} ${accData.lname || submission.lname || "N/A"}</div>
          <div class="info">${accData.studentId || submission.studentId || "N/A"}</div>
          <div class="info schedule-line">${scheduleLine}</div>
        </div>
      </div>
      <div class="${actionBtnWrapperClass}">
        ${actionButtonHtml}
        <button class="btn details">See Details</button>
      </div>
  `;

  // details button opens popup using the submission id (we still pass createdBy for lookup)
  const detailsBtn = card.querySelector(".btn.details");
  if (detailsBtn) {
    detailsBtn.addEventListener("click", () => {
      openDetailsPopup(submission.createdBy || accData.uid, submissionId);
    });
  }

  // Single handler for the action button (button always has class 'btn start')
  const actionBtn = card.querySelector(".btn.start");
  if (actionBtn) {
    actionBtn.addEventListener("click", (ev) => {
      const action = actionBtn.dataset.action;
      if (action === "take") {
        openTakeSessionPopup(submissionId, submission);
      } else if (action === "start") {
        startCall(submissionId);
      } else {
        console.warn("Unknown action on session button:", action);
      }
    });
  }

  return card;
}

async function openTakeSessionPopup(submissionId, submission) {
  // create modal overlay
  const overlay = document.createElement("div");
  overlay.classList.add("take-session-overlay");
  overlay.style.position = "fixed";
  overlay.style.left = 0;
  overlay.style.top = 0;
  overlay.style.right = 0;
  overlay.style.bottom = 0;
  overlay.style.background = "rgba(0,0,0,0.4)";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.zIndex = 9999;

  // --- compute presets from submission.assigned_sched if present ---
  let presetDate = "";
  let presetStartTime = "";
  let presetEndTime = "";

  if (submission && submission.assigned_sched && submission.assigned_sched.start) {
    const sMs = tsToMillis(submission.assigned_sched.start);
    if (sMs) {
      const sd = new Date(sMs);
      const YYYY = sd.getFullYear();
      const MM = String(sd.getMonth() + 1).padStart(2, "0");
      const DD = String(sd.getDate()).padStart(2, "0");
      presetDate = `${YYYY}-${MM}-${DD}`;

      const sh = String(sd.getHours()).padStart(2, "0");
      const sm = String(sd.getMinutes()).padStart(2, "0");
      presetStartTime = `${sh}:${sm}`;
    }
  }

  if (submission && submission.assigned_sched && submission.assigned_sched.end) {
    const eMs = tsToMillis(submission.assigned_sched.end);
    if (eMs) {
      const ed = new Date(eMs);
      const eh = String(ed.getHours()).padStart(2, "0");
      const em = String(ed.getMinutes()).padStart(2, "0");
      presetEndTime = `${eh}:${em}`;
    }
  }

  // Build modal (date on top, two time inputs below)
overlay.innerHTML = `
  <div class="take-session-modal">
    <h3>Assign Schedule</h3>

    <label for="ts_date">Date</label>
    <input id="ts_date" type="date" value="${presetDate}">

    <div class="time-row">
      <div class="time-field">
        <label for="ts_time_start">Start time</label>
        <input id="ts_time_start" type="time" value="${presetStartTime}">
      </div>

      <div class="time-field">
        <label for="ts_time_end">End time</label>
        <input id="ts_time_end" type="time" value="${presetEndTime}">
      </div>
    </div>

    <div class="note">
      Note: Choose a single date, then pick the start and end time for that date.
    </div>

    <div class="modal-actions">
      <button id="ts_cancel">Cancel</button>
      <button id="ts_submit">Submit</button>
    </div>
  </div>
`;


  document.body.appendChild(overlay);
  const dateInput = overlay.querySelector("#ts_date");

  // Today's date in YYYY-MM-DD (local)
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  // Disallow past dates
  dateInput.min = todayStr;

  // If presetDate exists but is in the past, force it to today
  if (presetDate && presetDate < todayStr) {
    dateInput.value = todayStr;
  }

  // close handler
  overlay.querySelector("#ts_cancel").addEventListener("click", () => {
    if (document.body.contains(overlay)) document.body.removeChild(overlay);
  });

  // submit handler
  overlay.querySelector("#ts_submit").addEventListener("click", async () => {
    const dateVal = overlay.querySelector("#ts_date").value;            // YYYY-MM-DD
    const startTimeVal = overlay.querySelector("#ts_time_start").value; // HH:MM
    const endTimeVal = overlay.querySelector("#ts_time_end").value;     // HH:MM

    if (!dateVal) {
      alert("Please choose a date.");
      return;
    }
    if (!startTimeVal || !endTimeVal) {
      alert("Please enter both start and end times.");
      return;
    }

    // compose full ISO-ish strings compatible with Date constructor
    // Append seconds to avoid timezone oddities: "YYYY-MM-DDTHH:MM:00"
    const startIso = `${dateVal}T${startTimeVal}:00`;
    const endIso = `${dateVal}T${endTimeVal}:00`;

    const startDate = new Date(startIso);
    const endDate = new Date(endIso);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      alert("Invalid date or time.");
      return;
    }

    if (startDate.getTime() > endDate.getTime()) {
      alert("Start must be before or equal to End.");
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert("You must be logged in to take a session.");
      return;
    }

    const sY = startDate.getFullYear(), sM = startDate.getMonth(), sD = startDate.getDate();
    const slotRef = doc(db, "CounselingForm_Submissions", submissionId);

    try {
      // transaction ensures single taker
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(slotRef);

        if (!snap.exists()) {
          throw new Error("Session does not exist.");
        }

        const data = snap.data();

        // If already taken by someone else -> abort
        if (data.taken_by && data.taken_by !== currentUser.uid) {
          throw new Error("Session already taken by another user.");
        }

        // Update to taken by current user and set assigned_sched
        tx.update(slotRef, {
          taken_by: currentUser.uid,
          taken_when: serverTimestamp(),
          assigned_sched: {
            start: startDate,
            end: endDate,
            date: `${sY}-${String(sM+1).padStart(2,'0')}-${String(sD).padStart(2,'0')}`
          },
          status: "taken"
        });
      });

      // onSnapshot will refresh UI. notify and close modal
      alert("Session successfully taken.");
      if (document.body.contains(overlay)) document.body.removeChild(overlay);

    } catch (err) {
      console.error("Failed to take session:", err);
      alert(err.message || "Failed to take session. See console.");
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
    }
  });

  // click outside modal to close
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) {
      if (document.body.contains(overlay)) document.body.removeChild(overlay);
    }
  });
}

let _submissionsListenerUnsub = null;
let _submissionsCache = []; // array of { id, data }
let _currentSort = 'newest'; // default
let _currentScheduleSort = 'newest';

export async function loadCounselingForms() {
  const container = document.getElementById("sessions-container");
  if (!container) return;

  // --- LOGIC FOR THE SESSIONS LIST DROPDOWN (First row_nav) ---
  const sessionsSortSelect = document.querySelector('#guidance-counseling .row-nav:first-of-type .btn-white');
  if (sessionsSortSelect && !sessionsSortSelect._listenerAttached) {
    sessionsSortSelect.value = _currentSort;
    sessionsSortSelect.addEventListener('change', (ev) => {
      _currentSort = ev.target.value || 'newest';
      renderSubmissionsFromCache(); // Re-render sessions list only
    });
    sessionsSortSelect._listenerAttached = true;
  }

  // --- NEW LOGIC FOR THE SCHEDULE DROPDOWN (Second row_nav) ---
  // We target the row_nav that sits immediately before #schedule
  const scheduleRowNav = document.getElementById("schedule").previousElementSibling;
  if (scheduleRowNav) {
    const scheduleSortSelect = scheduleRowNav.querySelector('.btn-white');
    if (scheduleSortSelect && !scheduleSortSelect._scheduleListenerAttached) {
      scheduleSortSelect.value = _currentScheduleSort; // Set initial value
      scheduleSortSelect.addEventListener('change', (ev) => {
        _currentScheduleSort = ev.target.value || 'newest';
        renderSchedule(); // Re-render schedule row only
      });
      scheduleSortSelect._scheduleListenerAttached = true;
    }
  }

  // clear container while we attach listener
  container.innerHTML = `<div class="loading">Loading...</div>`;

  // if already listening, unsubscribe first
  if (typeof _submissionsListenerUnsub === 'function') {
    _submissionsListenerUnsub();
    _submissionsListenerUnsub = null;
  }

  try {
    const collRef = collection(db, "CounselingForm_Submissions");

    _submissionsListenerUnsub = onSnapshot(collRef, (snapshot) => {
      _submissionsCache = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        data: docSnap.data(),
      }));

      // Render both views
      renderSubmissionsFromCache();
      renderSchedule(); 
    }, (err) => {
      console.error("Counseling submissions listener error:", err);
      container.innerHTML = `<div class="error">Failed to load submissions</div>`;
    });
  } catch (err) {
    console.error("Failed to attach submissions listener:", err);
    container.innerHTML = `<div class="error">Failed to load submissions</div>`;
  }
}
async function renderSubmissionsFromCache() {
  const container = document.getElementById("sessions-container");
  if (!container) return;

  container.innerHTML = "";

  // Copy array so sort won't mutate original
  const items = _submissionsCache.slice();

  // Sort comparator by createdAt millis
  items.sort((a, b) => {
    const ta = tsToMillis(a.data.createdAt);
    const tb = tsToMillis(b.data.createdAt);
    if (_currentSort === 'oldest') return ta - tb;
    // 'newest' or 'all' default newest first
    return tb - ta;
  });

  if (items.length === 0) {
    container.innerHTML = `<div class="empty">No submissions yet.</div>`;
    return;
  }

  // Build cards sequentially, but we need to await account fetch inside createSessionCardFromData
  for (const item of items) {
    
    // --- NEW: Check if the session is completed ---
    // If the status is "completed", skip this iteration so it doesn't show up.
    if (item.data.status === "completed") {
      console.log("Skipping completed submission:", item.id);
      continue; 
    }

    try {
      const cardElement = await createSessionCardFromData(item.id, item.data);
      if (cardElement) container.appendChild(cardElement);
      // cache item form data for quick popup
      formCache.set(item.id, item.data);
    } catch (err) {
      console.error("Failed to render submission card", item.id, err);
    }
  }
}

function renderSchedule() {
  const container = document.getElementById("schedule");
  if (!container) return;

  // 1. Clear existing schedule cards
  container.innerHTML = "";

  // 2. Calculate the Current Week (Monday to Sunday)
  const today = new Date();
  const day = today.getDay() || 7; // Get current day (1-7), making Sunday 7
  const monday = new Date(today);
  monday.setDate(today.getDate() - day + 1); // Set to Monday
  monday.setHours(0, 0, 0, 0); // Normalize time to 00:00:00

  // Generate array of dates for Mon-Sun of this week
  const daysOfWeek = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    daysOfWeek.push(d);
  }

  // 3. Filter assigned requests from cache
  let assignedItems = _submissionsCache.filter((item) => {
    const data = item.data;

    // --- NEW: SECURITY CHECK ---
    // Ensure the user is logged in
    const currentUid = auth.currentUser ? auth.currentUser.uid : null;
    if (!currentUid) return false;

    // Filter A: Must have assigned_sched and must not be completed
    if (!data.assigned_sched || !data.assigned_sched.start || data.status === "completed") {
      return false;
    }

    // Filter B: MUST be assigned (taken) by the current user
    // If taken_by exists and it's NOT the current user, hide it.
    if (data.taken_by && data.taken_by !== currentUid) {
        return false;
    }

    // --- DATE RANGE CHECK ---
    const startMs = tsToMillis(data.assigned_sched.start);
    const itemDate = new Date(startMs);

    // Check if item falls within the current week range
    const startOfWeekMs = daysOfWeek[0].getTime();
    const endOfWeekMs = new Date(daysOfWeek[6]).setHours(23, 59, 59, 999);

    return startMs >= startOfWeekMs && startMs <= endOfWeekMs;
  });

  // 4. Sort items based on the schedule dropdown selection (Newest/Oldest)
  assignedItems.sort((a, b) => {
    const tA = tsToMillis(a.data.assigned_sched.start);
    const tB = tsToMillis(b.data.assigned_sched.start);
    return _currentScheduleSort === "newest" ? tB - tA : tA - tB;
  });

  // 5. Handle "Reverse Week Thingy"
  const displayDays = _currentScheduleSort === "newest" ? [...daysOfWeek].reverse() : daysOfWeek;
  const dayNames = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const displayDayNames = _currentScheduleSort === "newest" ? [...dayNames].reverse() : dayNames;

  // 6. Build the Calendar UI
  displayDays.forEach((dateObj, index) => {
    const dayCard = document.createElement("div");
    dayCard.className = "card-schedule";

    const dateNum = dateObj.getDate();
    const dayName = displayDayNames[index];

    // Header
    dayCard.innerHTML = `
      <h4 class="sched-date">${dateNum}</h4>
      <h5 style="padding-left: 30px;">${dayName}</h5>
    `;

    // Find items that match this specific day
    const daysItems = assignedItems.filter((item) => {
      const startMs = tsToMillis(item.data.assigned_sched.start);
      const itemDate = new Date(startMs);
      return (
        itemDate.getDate() === dateObj.getDate() &&
        itemDate.getMonth() === dateObj.getMonth() &&
        itemDate.getFullYear() === dateObj.getFullYear()
      );
    });

    // Append items OR Placeholder
    if (daysItems.length === 0) {
      // --- PLACEHOLDER ---
      const schedDiv = document.createElement("div");
      schedDiv.className = "sched";
      schedDiv.style.border = "1px dashed #ccc";
      schedDiv.style.background = "#fcfcfc";
      schedDiv.innerHTML = `<p class="sched-type" style="color:#999; font-weight:normal; font-style:italic;">No Scheduled Counseling</p>`;
      dayCard.appendChild(schedDiv);
    } else {
      // --- RENDER ITEMS ---
      daysItems.forEach((item) => {
        const schedDiv = document.createElement("div");
        schedDiv.className = "sched";

        const platform = formatPlatform(item.data.preferredPlatform);
        const timeRange = formatTimeRange(item.data.assigned_sched);

        schedDiv.innerHTML = `
          <p class="sched-type">${platform}</p>
          <p class="sched-time">${timeRange}</p>
        `;

        schedDiv.style.cursor = "pointer";
        schedDiv.onclick = () => openDetailsPopup(item.data.createdBy, item.id);

        dayCard.appendChild(schedDiv);
      });
    }

    container.appendChild(dayCard);
  });
}


// ------------------- REQUEST FORM SERIALIZE & SAVE TO FIREBASE -------------------

export async function saveRequestFormToFirebase() {
    const title = document.querySelector('.request-form-title')?.value || "";
    const description = document.querySelector('.request-form-description')?.value || "";

    const questions = [];
    document.querySelectorAll('.request-question-card').forEach((card, index) => {
        const text = card.querySelector('.request-question-input')?.value || "";
        const type = card.querySelector('.request-question-type')?.value || "short";
        const desc = card.querySelector('.request-question-subtext')?.value || "";

        let options = [];
        if (type === 'multiple' || type === 'checkbox' || type === 'dropdown') {
            card.querySelectorAll('.request-answer-area input[type="text"]').forEach(optInput => {
                const val = optInput.value.trim();
                if (val !== '') options.push(val);
            });
        }

        questions.push({
            id: `q${index + 1}`,
            text: text,
            type: type,
            description: desc,
            ...(options.length > 0 && { options })
        });
    });

    const currentUser = auth.currentUser;
    if (!currentUser) {
        return alert("You must be logged in to save the form!");
    }

    const formData = {
        title,
        description,
        questions,
        createdAt: new Date(),
        savedBy: currentUser.uid
    };

    try {
        const docRef = doc(db, 'CounselingForm', 'RequestForm_Format'); // fixed doc ID
        await setDoc(docRef, formData, { merge: true }); // merge updates existing
        console.log("Form saved as 'RequestForm_Format' by", currentUser.uid);
        showSavedFormPopup();
        formCache.set('RequestForm_Format', formData);
    } catch (err) {
        console.error("Error saving form:", err);
    }
}

// Replace your old saveRequestForm call in the request popup
document.querySelector('.request-btn-save')?.addEventListener('click', () => {
    closeRequestFormPopup();
    saveRequestFormToFirebase();
});

export async function loadRequestFormFromFirebase() {
    try {
        const docRef = doc(db, 'CounselingForm', 'RequestForm_Format');
        const snap = await getDoc(docRef);
        if (!snap.exists()) return; // nothing saved yet

        const data = snap.data();

        // Set title and description
        const titleInput = document.querySelector('.request-form-title');
        if (titleInput) titleInput.value = data.title || "";

        const descInput = document.querySelector('.request-form-description');
        if (descInput) descInput.value = data.description || "";

        // Clear existing questions in UI
        const container = document.getElementById('requestQuestionsContainer');
        if (!container) return;
        container.innerHTML = "";

        // Add questions
        if (Array.isArray(data.questions)) {
            data.questions.forEach((q, index) => {
                addNewRequestQuestion(); // create a new card
                const card = container.lastElementChild;

                // Set question fields
                card.querySelector('.request-question-input').value = q.text || "";
                card.querySelector('.request-question-type').value = q.type || "short";
                card.querySelector('.request-question-subtext').value = q.description || "";

                // Update answer area based on type
                changeRequestQuestionType(card.querySelector('.request-question-type'));

                // Populate options if applicable
                if (q.options && Array.isArray(q.options)) {
                    const answerArea = card.querySelector('.request-answer-area');
                    answerArea.innerHTML = ""; // clear placeholder

                    q.options.forEach((opt, idx) => {
                        const optionDiv = document.createElement('div');
                        optionDiv.className = 'request-option-input';

                        if (q.type === 'multiple' || q.type === 'checkbox') {
                            const iconClass = q.type === 'multiple' ? 'request-radio-icon' : 'request-checkbox-icon';
                            optionDiv.innerHTML = `
                                <span class="${iconClass}"></span>
                                <input type="text" value="${opt}" onfocus="addRequestOptionOnFocus(this)">
                                <button class="request-option-remove" onclick="removeRequestOption(this)">×</button>
                            `;
                        } else if (q.type === 'dropdown') {
                            optionDiv.innerHTML = `
                                <span class="request-option-number">${idx + 1}.</span>
                                <input type="text" value="${opt}" onfocus="addRequestOptionOnFocus(this)">
                                <button class="request-option-remove" onclick="removeRequestOption(this)">×</button>
                            `;
                        }

                        answerArea.appendChild(optionDiv);
                    });
                }
            });
        }

    } catch (err) {
        console.error("Failed to load request form from Firebase:", err);
    }
}