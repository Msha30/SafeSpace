import { app, auth } from "./auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  setDoc,
  doc,
  getDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const db = getFirestore(app);

// Caches
const avatarCache = new Map();
const accountCache = new Map();
const formCache = new Map();

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
    if (img) img.src = accData.avatarUrl || "photos/pic_placeholder.png";

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
// Create session card from submission (submissionId)
async function createSessionCardFromData(submissionId, submission) {
  // submission is the object from snapshot.docs[i].data()
  if (!submission) return null;

  // Fetch account data of the submission creator (cached)
  const accData = await getAccountData(submission.createdBy);
  const avatarUrl = accData.avatarUrl || (submission.createdBy ? await getAvatarUrl(submission.createdBy) : null);

  const card = document.createElement("div");
  card.classList.add("card-session");

  const urgent = (submission.urgent || "").toString().trim().toLowerCase() === "yes";

  card.innerHTML = `
      <h3>${formatDate(submission.createdAt)} - ${formatPlatform(submission.preferredPlatform)}</h3>
      <div class="session-mode-left">
        <img src="${avatarUrl || 'photos/pic_placeholder.png'}" alt="Avatar">
        <div class="session-details-left">
          <div class="time">Pending Schedule</div>
          <div class="name">${accData.fname || submission.fname || "N/A"} ${accData.lname || submission.lname || "N/A"}</div>
          <div class="info">${accData.studentId || submission.studentId || "N/A"}</div>
        </div>
      </div>
      <div class="session-btn-right">
        <button class="btn start">Take Session</button>
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

  return card;
}


let _submissionsListenerUnsub = null;
let _submissionsCache = []; // array of { id, data }
let _currentSort = 'newest'; // default

export async function loadCounselingForms() {
  const container = document.getElementById("sessions-container");
  if (!container) return;

  // attach sort select handler
  const sortSelect = document.querySelector('#guidance-counseling .btn-white');
  if (sortSelect && !sortSelect._listenerAttached) {
    // set initial value if needed
    sortSelect.value = _currentSort;
    sortSelect.addEventListener('change', (ev) => {
      _currentSort = ev.target.value || 'newest';
      renderSubmissionsFromCache();
    });
    sortSelect._listenerAttached = true;
  }

  // clear container while we attach listener
  container.innerHTML = `<div class="loading">Loading...</div>`;

  // if already listening, unsubscribe first to avoid duplicate listeners
  if (typeof _submissionsListenerUnsub === 'function') {
    _submissionsListenerUnsub();
    _submissionsListenerUnsub = null;
  }

  try {
    const collRef = collection(db, "CounselingForm_Submissions");

    // Realtime listener: update cache and render on every change
    _submissionsListenerUnsub = onSnapshot(collRef, (snapshot) => {
      _submissionsCache = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        data: docSnap.data()
      }));
      // render according to current sort
      renderSubmissionsFromCache();
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

  // sort comparator by createdAt millis
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