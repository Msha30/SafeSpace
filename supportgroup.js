// supportgroup.js
import { db, auth } from "./auth.js";
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  doc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ---------------- Config ---------------- */
const SUPPORTGROUP_COLLECTION = "supportgroup";

/* ---------------- DOM refs ---------------- */
const supportGroupsContainer = document.querySelector(".support-groups");
const modal = document.getElementById("createSupportGroupModal");
const nameInput = document.getElementById("createSupportGroupNameInput");
const fileInput = document.getElementById("supportGroupImageUpload");
const circlePreview = document.getElementById("circlePreview");
const squarePreview = document.getElementById("squarePreview");

/* ---------------- State ---------------- */
const openedGroupListeners = new Map(); // groupId -> unsubscribe function for doc listener
let selectedImageFile = null;

/* ---------------- Helpers ---------------- */
function escapeHtml(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createCardElement(group) {
  if (!group || !group.id) {
    console.warn("Skipping group - missing id or invalid object:", group);
    return null;
  }

  const imgSrc = group.supportgroup_pfp_URL || "photos/suppGroup_placeholder.png";
  const card = document.createElement("div");
  card.className = "support-card";
  card.dataset.groupId = group.id;

  const name = escapeHtml(group.supportgroup_name || "Untitled");
  const memberCount = Array.isArray(group.member_list) ? group.member_list.length : 0;

  card.innerHTML = `
    <img src="${imgSrc}" alt="${name}">
    <div class="support-info">
      <h4>${name}</h4>
      <span class="member-count">${memberCount} Members</span>
    </div>
  `;

  card.addEventListener("click", () => openGroupPage(group.id));
  return card;
}

/* ---------------- Render ---------------- */
function renderSupportGroups(groups = []) {
  if (!supportGroupsContainer) return;
  supportGroupsContainer.innerHTML = "";

  if (!groups || groups.length === 0) {
    supportGroupsContainer.innerHTML = `<div class="empty">No support groups yet. Click + to create one.</div>`;
    return;
  }

  groups.forEach(group => {
    const card = createCardElement(group);
    if (card) supportGroupsContainer.appendChild(card);
  });
}

/* ---------------- Firebase live listener ---------------- */
export function initSupportGroups() {
  if (!supportGroupsContainer) {
    console.warn("initSupportGroups: .support-groups container not found");
    return;
  }

  const q = query(collection(db, SUPPORTGROUP_COLLECTION), orderBy("createdAt", "desc"));

  onSnapshot(q, snapshot => {
    const groups = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSupportGroups(groups);
  }, err => console.error("Supportgroup listener error:", err));
}

/* ---------------- Create support group ---------------- */
export async function createSupportGroup() {
  const name = (nameInput?.value || "").trim();
  const user = auth.currentUser;

  if (!name) return alert("Support group name is required");
  if (!user) return alert("You must be logged in to create a support group");

  try {
    await addDoc(collection(db, SUPPORTGROUP_COLLECTION), {
      supportgroup_name: name,
      createdBy: user.uid,
      createdAt: new Date(),
      supportgroup_description: "",
      supportgroup_pfp_URL: "",
      member_list: []
    });

    // UX: reset modal inputs
    if (nameInput) nameInput.value = "";
    if (fileInput) fileInput.value = "";
    if (circlePreview) circlePreview.src = "photos/pic_placeholder.png";
    if (squarePreview) squarePreview.src = "photos/suppGroup_placeholder.png";
    if (modal) modal.style.display = "none";

    alert("Support group created successfully (live listener will update the list).");
  } catch (err) {
    console.error("createSupportGroup failed", err);
    alert("Failed to create support group");
  }
}

/* ---------------- Modal helpers ---------------- */
export function openCreateGroupModal() {
  if (!modal) return;
  modal.style.display = "flex";
}

export function closeCreateGroupModal() {
  if (!modal) return;
  modal.style.display = "none";
  if (nameInput) nameInput.value = "";
  if (fileInput) fileInput.value = "";
  selectedImageFile = null;
  if (circlePreview) circlePreview.src = "photos/pic_placeholder.png";
  if (squarePreview) squarePreview.src = "photos/suppGroup_placeholder.png";
}

/* ---------------- Image upload (preview-only for now) ---------------- */
export function triggerImageUpload() {
  if (!fileInput) return;
  fileInput.click();
}

export function handleImageUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  selectedImageFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    if (circlePreview) circlePreview.src = e.target.result;
    if (squarePreview) squarePreview.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/* ---------------- Open group page, attach live doc listener, and wire edits ---------------- */
function openGroupPage(groupId) {
  if (!groupId) return;
  const pageId = `sg-page-${groupId}`;
  let page = document.getElementById(pageId);

  // If page exists, show it and return
  if (page) {
    showOnlyThisPage(pageId);
    return;
  }

  // Create page DOM
  page = document.createElement("div");
  page.className = "page";
  page.id = pageId;

  page.innerHTML = `
    <div class="row">
      <div class="left">
        <h3 id="sg-title-${groupId}">Support Group</h3>
        <div class="info-section">
          <div class="info-row-group">
            <div class="info-block">
              <div class="info-row">
                <span class="span-1">Profile Picture</span>
                <a href="#" class="edit-link edit-1">Edit</a>
              </div>
              <div class="info-images">
                <img src="photos/suppGroup_placeholder.png" alt="Profile Circle" class="profile-circle">
                <img src="photos/suppGroup_placeholder.png" alt="Profile Square" class="profile-square">
              </div>
            </div>

            <div class="info-block">
              <div class="info-row">
                <span class="span-2">Cover Photo</span>
                <a href="#" class="edit-link edit-2">Edit</a>
              </div>
              <div class="info-images">
                <img src="photos/rectangle_placeholder.png" alt="Cover Photo">
              </div>
            </div>
          </div>

          <div class="info-row">
            <span class="span-3">Description</span>
            <a href="#" class="edit-link edit-3" id="desc-edit-${groupId}">Edit</a>
          </div>
          <div class="info-description" id="desc-container-${groupId}">
            <p id="desc-text-${groupId}">N/A</p>
          </div>
        </div>
      </div>

      <div class="right">
        <div class="card">
          <h3>Group Chat</h3>
          <table class="user">
            <tbody id="groupchat-list-${groupId}">
              <tr><td>No group chats yet</td></tr>
            </tbody>
          </table>
        </div>

        <div class="card">
          <h3>Members</h3>
          <table class="user">
            <tbody id="members-list-${groupId}">
              <tr><td>No members</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Insert page after the main support-group block if present, else append to body
  const supportGroupRoot = document.getElementById("support-group");
  if (supportGroupRoot && supportGroupRoot.parentNode) {
    supportGroupRoot.parentNode.appendChild(page);
  } else {
    document.body.appendChild(page);
  }

  // Show only this page
  showOnlyThisPage(pageId);

  // Wire the description edit button to the editor
  const editBtn = page.querySelector(`#desc-edit-${groupId}`);
  if (editBtn) {
    editBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      // Use module's initSupportGroupEdits so Save will write to Firestore
      initSupportGroupEdits(pageId);
      // then toggle the editor immediately (initSupportGroupEdits will set up handlers; we simulate clicking)
      const theEdit = page.querySelector(".edit-3");
      if (theEdit) theEdit.click();
    });
  }

  // Attach edit handlers (edit1/edit2 placeholders, edit3 will save)
  initSupportGroupEdits(pageId);

  // Attach a live Firestore doc listener for this group (only one per group)
  if (!openedGroupListeners.has(groupId)) {
    const docRef = doc(db, SUPPORTGROUP_COLLECTION, groupId);
    const unsub = onSnapshot(docRef, snap => {
      if (!snap.exists()) return;
      const data = snap.data();

      // Update title
      const titleElem = document.getElementById(`sg-title-${groupId}`);
      if (titleElem) titleElem.textContent = data.supportgroup_name || "Untitled";

      // Update description
      const descText = document.getElementById(`desc-text-${groupId}`);
      if (descText) descText.textContent = data.supportgroup_description || "N/A";

      // Update pfp imgs
      const pfp = data.supportgroup_pfp_URL || "photos/suppGroup_placeholder.png";
      page.querySelectorAll(".profile-circle, .profile-square").forEach(img => img.src = pfp);

      // Update members list
      renderMembersList(groupId, Array.isArray(data.member_list) ? data.member_list : []);
      
      const title = `
				<a href="#" onclick="showPage('support-group')" style="text-decoration:none; color:inherit;">
					Support Group
				</a>
				<img src="icons/ic_arrow right.svg" 
					style="width:14px; vertical-align:middle; margin:0 5px; cursor:pointer;" 
					onclick="showPage('support-group)">
				${titleElem.textContent}
			`;
      document.getElementById("pageTitle").innerHTML = title;

    }, err => {
      console.error("group doc listener error", err);
    });

    openedGroupListeners.set(groupId, unsub);
  }
}

/* ---------------- Utility: show only this page ---------------- */
function showOnlyThisPage(pageId) {
  document.querySelectorAll(".page").forEach(p => {
    p.style.display = "none";
  });
  const page = document.getElementById(pageId);
  if (page) page.style.display = "block";
}

/* ---------------- Render members ---------------- */
function renderMembersList(groupId, memberList = []) {
  const tbody = document.getElementById(`members-list-${groupId}`);
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!Array.isArray(memberList) || memberList.length === 0) {
    tbody.innerHTML = `<tr><td>No members</td></tr>`;
    return;
  }

  memberList.forEach(uid => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="table_user"><img src="photos/pic_placeholder.png"></td>
      <td id="name">${escapeHtml(uid)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* ---------------- Edit handlers integration ----------------
   - edit1 / edit2: placeholder local preview only
   - edit3: description edit/save wired to update Firestore
*/
function initSupportGroupEdits(pageId) {
  const page = document.getElementById(pageId);
  if (!page) return;

  // Derive groupId from pageId (expects 'sg-page-<groupId>')
  const groupId = pageId.startsWith("sg-page-") ? pageId.slice("sg-page-".length) : pageId;

  // --- edit-1 (pfp placeholder) ---
  const edit1 = page.querySelector(".edit-1");
  if (edit1) {
    const newEdit1 = edit1.cloneNode(true);
    edit1.parentNode.replaceChild(newEdit1, edit1);

    newEdit1.addEventListener("click", function (e) {
      e.preventDefault();
      // placeholder: allow local preview and update overview card image only
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = function (event) {
        const file = event.target.files[0];
        if (file && file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = function (ev) {
            const imageSrc = ev.target.result;
            const circleImg = page.querySelector(".profile-circle");
            const squareImg = page.querySelector(".profile-square");
            if (circleImg) circleImg.src = imageSrc;
            if (squareImg) squareImg.src = imageSrc;

            // Update overview card image visually (no Firestore update yet)
            const card = document.querySelector(`.support-card[data-group-id="${groupId}"]`);
            if (card) {
              const img = card.querySelector("img");
              if (img) img.src = imageSrc;
            }
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    });
  }

  // --- edit-2 (cover placeholder) ---
  const edit2 = page.querySelector(".edit-2");
  if (edit2) {
    const newEdit2 = edit2.cloneNode(true);
    edit2.parentNode.replaceChild(newEdit2, edit2);

    newEdit2.addEventListener("click", function (e) {
      e.preventDefault();
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = function (event) {
        const file = event.target.files[0];
        if (file && file.type.startsWith("image/")) {
          const reader = new FileReader();
          reader.onload = function (ev) {
            const coverImg = page.querySelector(".info-block:nth-child(2) .info-images img");
            if (coverImg) coverImg.src = ev.target.result;
          };
          reader.readAsDataURL(file);
        }
      };
      input.click();
    });
  }

  // --- edit-3 (description) ---
  const edit3 = page.querySelector(".edit-3");
  if (edit3) {
    const newEdit3 = edit3.cloneNode(true);
    edit3.parentNode.replaceChild(newEdit3, edit3);

    newEdit3.addEventListener("click", async function (e) {
      e.preventDefault();

      const descriptionDiv = page.querySelector(".info-description");
      const editLink = this;

      // If currently "Edit" -> switch to editable mode
      if (editLink.textContent.trim() === "Edit") {
        // make editable
        descriptionDiv.setAttribute("contenteditable", "true");
        editLink.textContent = "Save";

        // small keyboard helper (optional)
        const handleKeydown = function (ev) {
          if (ev.ctrlKey && ev.key === "b") {
            ev.preventDefault();
            document.execCommand("bold", false, null);
          }
          if (ev.ctrlKey && ev.key === "i") {
            ev.preventDefault();
            document.execCommand("italic", false, null);
          }
        };
        descriptionDiv.addEventListener("keydown", handleKeydown);

        // Focus editable area
        descriptionDiv.focus();

        // Store a reference so we can remove listener later if needed
        descriptionDiv._kg_keydown = handleKeydown;

      } else {
        // Save flow
        // remove editable
        descriptionDiv.setAttribute("contenteditable", "false");
        editLink.textContent = "Edit";

        // grab plain text (trim), but preserve line breaks
        const newValue = (descriptionDiv.innerText || "").trim();

        // remove keydown if we attached one
        if (descriptionDiv._kg_keydown) {
          descriptionDiv.removeEventListener("keydown", descriptionDiv._kg_keydown);
          delete descriptionDiv._kg_keydown;
        }

        // perform update to Firestore
        try {
          const curUser = auth.currentUser;
          if (!curUser) {
            alert("You must be signed in to save the description.");
            return;
          }

          // debug log
          console.log("[SupportGroup] saving description", { groupId, newValue });

          const docRef = doc(db, SUPPORTGROUP_COLLECTION, groupId);
          await updateDoc(docRef, {
            supportgroup_description: newValue
          });

          // update overview immediately (doc listener will also reflect it)
          const descTextEl = page.querySelector(`#desc-text-${groupId}`);
          if (descTextEl) {
            descTextEl.textContent = newValue || "N/A";
          } else {
            // replace content with a p tag if needed
            descriptionDiv.innerHTML = `<p id="desc-text-${groupId}">${escapeHtml(newValue || "N/A")}</p>`;
          }

          alert("Description saved");
        } catch (err) {
          console.error("[SupportGroup] Failed to save description", err);
          alert("Failed to save description: " + (err.message || err));
        }
      }
    });
  }
}

/* ---------------- Optional: teardown ---------------- */
export function closeAllGroupListeners() {
  openedGroupListeners.forEach(unsub => {
    try { unsub(); } catch (e) { /* ignore */ }
  });
  openedGroupListeners.clear();
}