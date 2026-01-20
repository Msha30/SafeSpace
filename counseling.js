import { app, auth } from "./auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  setDoc,
  doc,
  getDoc
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

// Open details popup (uid + formId)
export async function openDetailsPopup(uid, formId) {
  const popup = document.getElementById("detailsPopup");
  if (!popup) return;

  try {
    // Fetch cached data
    const [accData, formData] = await Promise.all([
      getAccountData(uid),
      getFormData(formId)
    ]);

    const data = { ...accData, ...formData };

    // Left side
    const img = popup.querySelector(".popup-profile-img");
    img.src = data.avatarUrl || "photos/pic_placeholder.png";

    const nameElem = popup.querySelector(".popup-left h2");
    nameElem.textContent = `${data.lname || ""}, ${data.fname || ""}`;

    const dateElem = popup.querySelector(".date-created-left strong");
    if (data.createdAt) dateElem.textContent = formatDate(data.createdAt);

    // Right side details
    const setDetail = (label, value) => {
      const elem = Array.from(popup.querySelectorAll(".detail-item"))
        .find(d => d.querySelector("label").textContent === label);
      if (elem) elem.querySelector("p").textContent = value || "N/A";
    };

    setDetail("First Name", data.fname);
    setDetail("Last Name", data.lname);
    setDetail("Program", data.program);
    setDetail("Student ID", data.studentId);
    setDetail("Age", data.age || data.ageForm || "N/A");
    setDetail("Sex assigned at birth", data.assignedSex || data.sex || "N/A");
    setDetail("Gender Identity", data.genderId || data.genderIdentity || "N/A");
    setDetail("Preferred mode of platform", data.preferredPlatform || "N/A");
    setDetail("Preferred Counselor", data.preferredCounselor || "N/A");
    setDetail("Is it urgent?", data.urgent || "N/A");

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
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

// Create session card
async function createSessionCard(data, formId) {
  const urgent = data.urgent?.trim().toLowerCase() === "yes";
  const avatarUrl = await getAvatarUrl(data.createdBy);

  const card = document.createElement("div");
  card.classList.add("card-session");

  card.innerHTML = `
      <h3>${formatDate(data.createdAt)} - ${formatPlatform(data.preferredPlatform)}</h3>
      <div class="session-mode-left">
        <img src="${avatarUrl || 'photos/pic_placeholder.png'}" alt="Avatar">
        <div class="session-details-left">
          <div class="time">Pending Schedule</div>
          <div class="name">${data.fname || "N/A"} ${data.lname || "N/A"}</div>
          <div class="info">${data.studentId || "N/A"}</div>
          <div class="info">${urgent ? `<strong><span class="urgent">Urgent</span></strong>` : "Not Urgent"}</div>
          <div class="info">Prefers <strong>${data.preferredCounselor || "N/A"}</strong></div>
        </div>
      </div>
      <div class="session-btn-right">
        <button class="btn start">Take Session</button>
        <button class="btn details">See Details</button>
      </div>
  `;

  card.querySelector(".btn.details").addEventListener("click", () => {
    openDetailsPopup(data.createdBy, formId);
  });

  return card;
}

// Load all counseling forms
export async function loadCounselingForms() {
  const container = document.getElementById("sessions-container");
  if (!container) return;

  container.innerHTML = "";

  try {
    const snapshot = await getDocs(collection(db, "CounselingForm"));
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const formId = docSnap.id;
      const cardElement = await createSessionCard(data, formId);
      container.appendChild(cardElement);

      // Cache form data immediately for instant popup later
      formCache.set(formId, data);
    }
  } catch (err) {
    console.error("Failed to load counseling forms:", err);
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
