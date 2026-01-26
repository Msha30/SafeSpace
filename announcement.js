// announcement.js
import { db, auth } from "./auth.js";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// --- CONSTANTS ---
const SUPABASE_URL = "https://saqbiryyijzntzizkncv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNhcWJpcnl5aWp6bnR6aXprbmN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxNjg3NjgsImV4cCI6MjA3OTc0NDc2OH0.wr-zLfv5jLsPv-iXJb8fDRCTfIntnwYfTc4DgV4bNds";
const SUPABASE_BUCKET = "ProfilePictures";
let uploadedFiles = [];

// --- NEW: INIT DROPDOWN ---
export async function initAnnouncementDropdown() {
  const container = document.getElementById("dropdownMenu");
  if (!container) return;

  try {
    const snapshot = await getDocs(collection(db, "supportgroup"));

    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const id = docSnap.id;
      const name = data.supportgroup_name || "Unknown Group";
      const pfp = data.supportgroup_pfp_URL || "photos/suppGroup_placeholder.png";

      const item = document.createElement("div");
      item.className = "dropdown-item";
      item.textContent = name;
      item.onclick = () => selectProfile(name, id, pfp);

      container.appendChild(item);
    });
  } catch (err) {
    console.error("Failed to load support groups for dropdown:", err);
  }
}

// --- NEW: LOAD HISTORY (Read from Firebase) ---
export async function loadAnnouncementHistory() {
  const container = document.querySelector(".blue_bg");
  if (!container) return;

  const q = query(collection(db, "announcements"), orderBy("date_created", "desc"));

  onSnapshot(q, (snapshot) => {
    container.innerHTML = ""; 

    if (snapshot.empty) {
      container.innerHTML = "<p style='padding:20px; text-align:center;'>No announcements yet.</p>";
      return;
    }

    const promises = [];
    snapshot.forEach(docSnap => {
      promises.push(createAnnouncementCard(docSnap.id, docSnap.data()));
    });

    Promise.all(promises).then(cards => {
      cards.forEach(card => {
        if (card) container.appendChild(card); 
      });
    });

  }, (err) => {
    console.error("Failed to load announcements:", err);
  });
}

// Helper to fetch User Name using UID
async function getUserFullName(uid) {
  if (!uid) return "Unknown User";
  try {
    const snap = await getDoc(doc(db, "account_details", uid));
    if (snap.exists()) {
      const u = snap.data();
      
      // CHECK FOR WEB 'NAME' FIELD FIRST
      if (u.name && u.name.trim() !== "") {
        return u.name;
      }
      
      // ELSE CONSTRUCT FROM LNAME/FNAME
      const full = `${u.lname || ""}, ${u.fname || ""}`.trim();
      return full || "User"; 
    }
  } catch (err) {
    console.error("Error fetching user details for:", uid, err);
  }
  return "Unknown User";
}

// Helper to determine Name, Image for CARD HEADER (Entity)
async function getPosterInfo(representedById) {
  let info = {
    name: "Unknown",
    img: "photos/pic_placeholder.png"
  };

  if (representedById === "GCO") {
    info.name = "NUFV Guidance and Counseling Office";
    info.img = "photos/NUFV GCO.jpg";
  } else if (representedById === "PEERS") {
    info.name = "NU FV PEERS - NU Fairview Peer Facilitators";
    info.img = "photos/NUFV Peers.jpg";
  } else {
    // Support Group Lookup
    try {
      const snap = await getDoc(doc(db, "supportgroup", representedById));
      if (snap.exists()) {
        const groupData = snap.data();
        info.name = groupData.supportgroup_name || "Support Group";
        info.img = groupData.supportgroup_pfp_URL || "photos/pic_placeholder.png";
      }
    } catch (err) {
      console.warn("Failed to fetch group info for:", representedById, err);
    }
  }
  return info;
}

async function createAnnouncementCard(announcementId, data) {
  // 1. Get Header Info (Entity represented_by)
  const posterInfo = await getPosterInfo(data.represented_by);
  
  // 2. Get User Name (User created_by)
  const createdByName = await getUserFullName(data.created_by);
  
  // Format Date
  let dateStr = "Unknown Date";
  if (data.date_created) {
    const d = data.date_created.toDate ? data.date_created.toDate() : new Date(data.date_created);
    dateStr = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  // Build Images HTML
  let imagesHtml = "";
  if (Array.isArray(data.photo_urls) && data.photo_urls.length > 0) {
    imagesHtml = '<div class="announcementImages">';
    data.photo_urls.forEach(url => {
      imagesHtml += `<img src="${url}" alt="">`;
    });
    imagesHtml += '</div>';
  }

  // --- FIX: Create Header with "by [Group Name]" ---
  // "One under the card right" interpreted as "Right of Title" inside the header div
  const headerContent = `
    <div class="announcementHeader">
      <img src="${posterInfo.img}" class="avatar">
      <div class="announcementTitle">
      ${data.title}
      </div>
    </div>
  `;

  // Create Card
  const cardDiv = document.createElement("div");
  cardDiv.className = "card3";
  cardDiv.innerHTML = `
    <div class="announcementTopBar">
      ${headerContent}
      <button class="deleteAnnouncementBtn">&times;</button>
    </div>

    <p class="announcementText">
      ${data.description ? data.description.replace(/\n/g, '<br>') : ''}
    </p>
    ${imagesHtml}
  `;
  // attach delete button handler so it opens confirmation with the right id
  const deleteBtn = cardDiv.querySelector('.deleteAnnouncementBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // pass owner uid for permission checks
      openDeleteConfirm(announcementId, data.photo_urls || [], data.created_by);
    });
  }


  // --- FIX: Footer with "Created on ... by [User] | [Group]" ---
  const smallTag = document.createElement("small");
  smallTag.textContent = `Created on ${dateStr} by ${createdByName} | ${posterInfo.name}`;

  // Wrapper
  const wrapper = document.createElement("div");
  wrapper.appendChild(cardDiv);
  wrapper.appendChild(smallTag);

  return wrapper;
}

// --- HELPER: Upload to Supabase ---
export async function uploadToSupabase(file, bucket = SUPABASE_BUCKET, path) {
  if (!file) throw new Error("uploadToSupabase: missing file");
  if (!path) throw new Error("uploadToSupabase: missing path");

  const idToken = sessionStorage.getItem("idToken");
  if (!idToken) throw new Error("uploadToSupabase: missing idToken");

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
    const json = await res.json().catch(() => null);
    throw new Error(`Supabase upload failed: ${json?.message || res.statusText}`);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
  return { publicUrl };
}

// --- UI LOGIC: Handle File Upload ---
export function handleFileUpload(files) {
  const maxFiles = 10;

  for (let file of files) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;

    if (uploadedFiles.length >= maxFiles) {
      alert("Maximum of 10 files only.");
      break;
    }

    uploadedFiles.push(file);
  }

  renderFiles();
}

export function renderFiles() {
  const container = document.querySelector('.file-boxes');
  const dropArea = document.getElementById('dropArea');

  if (!container || !dropArea) return;

  container.querySelectorAll('.file:not(.add-file)').forEach(e => e.remove());

  const previewCount = Math.min(2, uploadedFiles.length);

  for (let i = 0; i < previewCount; i++) {
    const file = uploadedFiles[i];
    const box = document.createElement('div');
    box.className = 'file';

    const reader = new FileReader();
    reader.onload = function (e) {
      let media = "";

      if (file.type.startsWith('image/')) {
        media = `<img src="${e.target.result}" class="file-preview">`;
      } else {
        media = `<video src="${e.target.result}" class="file-preview" controls></video>`;
      }

      box.innerHTML = `
        ${media}
        <button class="remove-file-btn" onclick="removeFile(${i})">×</button>
      `;

      if (i === 1 && uploadedFiles.length > 2) {
        const overlay = document.createElement('div');
        overlay.className = 'file-count-overlay';
        overlay.innerHTML = `<div class="file-count-number">+${uploadedFiles.length - 2}</div>`;
        box.appendChild(overlay);
      }
    };

    reader.readAsDataURL(file);

    box.addEventListener("click", (e) => {
      if (!e.target.classList.contains("remove-file-btn")) {
        openViewer();
      }
    });

    container.insertBefore(box, dropArea);
  }
}

export function removeFile(index) {
  uploadedFiles.splice(index, 1);
  renderFiles();
}

// --- UI LOGIC: Modal & Dropdown ---
export function showPostConfirm() {
  const popup = document.getElementById('postConfirmPopup');
  if (popup) popup.classList.add('active');
}

export function closePostConfirm() {
  const popup = document.getElementById('postConfirmPopup');
  if (popup) popup.classList.remove('active');
}

export function toggleAnnouncementDropdown() {
  const dropdown = document.getElementById('dropdownMenu');
  if (dropdown) dropdown.classList.toggle('show');
}

export function selectProfile(profileName, supportGroupId = null, pfpUrl = null) {
  const nameSpan = document.getElementById('selectedProfile');
  const dropdown = document.getElementById('dropdownMenu');
  
  if (nameSpan) nameSpan.textContent = profileName;
  if (dropdown) dropdown.classList.remove('show');
  
  const profileImg = document.querySelector('.AncProfile .profile-img');
  
  if (profileImg) {
    if (pfpUrl) {
      profileImg.src = pfpUrl;
    } else if (profileName === 'NUFV Guidance and Counseling Office') {
      profileImg.src = 'photos/NUFV GCO.jpg';
      nameSpan.dataset.representedById = "GCO";
    } else if (profileName === 'NU FV PEERS - NU Fairview Peer Facilitators') {
      profileImg.src = 'photos/NUFV Peers.jpg';
      nameSpan.dataset.representedById = "PEERS";
    } else {
      profileImg.src = 'photos/NUFV GCO.jpg';
    }
  }

  if (supportGroupId) {
    nameSpan.dataset.representedById = supportGroupId;
  } 
}

export function openViewer() {
  const modal = document.getElementById('fileViewer');
  const grid = document.getElementById('fileViewerGrid');
  if (!modal || !grid) return;

  grid.innerHTML = '';
  
  uploadedFiles.forEach((file) => {
    const div = document.createElement('div');
    div.style.width = '200px';
    div.style.margin = '10px';
    
    const reader = new FileReader();
    reader.onload = (e) => {
      if (file.type.startsWith('image/')) {
        div.innerHTML = `<img src="${e.target.result}" style="max-width:100%; display:block;">`;
      } else {
        div.innerHTML = `<video src="${e.target.result}" controls style="max-width:100%;"></video>`;
      }
    };
    reader.readAsDataURL(file);
    
    grid.appendChild(div);
  });

  modal.style.display = 'flex';
}

export function closeViewer() {
  const modal = document.getElementById('fileViewer');
  if (modal) modal.style.display = 'none';
}

document.addEventListener('click', function(e) {
  const popup = document.getElementById('postConfirmPopup');
  if (e.target === popup) closePostConfirm();

  if (!e.target.closest('.dropdown-container')) {
    const dropdown = document.getElementById('dropdownMenu');
    if (dropdown) dropdown.classList.remove('show');
  }
});

// initialize delete popup buttons once after DOM is ready
function initDeleteConfirmButtons() {
  const cancelBtn = document.querySelector('.cancel-delete-btn');
  const confirmBtn = document.querySelector('.confirm-delete-btn');
  const popup = document.getElementById('deleteConfirmPopup');

  if (cancelBtn) cancelBtn.addEventListener('click', closeDeleteConfirm);
  if (confirmBtn) confirmBtn.addEventListener('click', confirmDeleteAnnouncement);

  // Close when clicking outside the box inside the overlay
  if (popup) {
    popup.addEventListener('click', (e) => {
      if (e.target === popup) closeDeleteConfirm();
    });
  }
}

document.addEventListener('DOMContentLoaded', initDeleteConfirmButtons);

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closePostConfirm();
    closeViewer();
    closeDeleteConfirm();
  }
});

// --- MAIN LOGIC: Create Announcement ---
export async function confirmPost() {
  const titleInput = document.querySelector('.AncTitle');
  const contentInput = document.querySelector('.AncContent');
  const profileSpan = document.getElementById('selectedProfile');
  const btn = document.querySelector('.post-btn');

  const title = titleInput.value.trim();
  const description = contentInput.value.trim();
  const representedBy = profileSpan.dataset.representedById || profileSpan.textContent.trim();

  if (!title) return alert("Please enter an event title");
  if (!description) return alert("Please enter an event description");
  if (!auth.currentUser) return alert("User not authenticated");

  const originalText = btn.textContent;
  btn.textContent = "Posting...";
  btn.disabled = true;

  try {
    if (uploadedFiles.length > 0) {
      await createFirestoreDocThenUpload(title, description, representedBy);
    } else {
      await saveAnnouncementToFirestore(title, description, representedBy, []);
    }

    alert('Post published successfully!');
    closePostConfirm();
    
    titleInput.value = '';
    contentInput.value = '';
    uploadedFiles = [];
    renderFiles();

  } catch (error) {
    console.error("Announcement Error:", error);
    alert("Failed to post: " + error.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

export async function createFirestoreDocThenUpload(title, description, representedBy) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("No current user");

  const announcementData = {
    title,
    description,
    represented_by: representedBy,
    created_by: currentUser.uid,
    date_created: serverTimestamp(),
    photo_urls: []
  };

  const docRef = await addDoc(collection(db, "announcements"), announcementData);
  const announcementId = docRef.id;

  const uploadedUrls = await uploadAllPhotos(announcementId);

  await updateDoc(docRef, {
    photo_urls: uploadedUrls
  });
}

export async function uploadAllPhotos(announcementId) {
  const uploadPromises = uploadedFiles.map((file, index) => {
    const ext = (file.name.split(".").pop() || "jpg").split(/[?#]/)[0];
    const objectPath = `announcement_pic/${announcementId}/${index}.${ext}`;

    return uploadToSupabase(file, SUPABASE_BUCKET, objectPath)
      .then(result => result.publicUrl);
  });

  return await Promise.all(uploadPromises);
}

export async function saveAnnouncementToFirestore(title, description, representedBy, photoUrls) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("No current user");

  const announcementData = {
    title,
    description,
    represented_by: representedBy,
    created_by: currentUser.uid,
    date_created: serverTimestamp(),
    photo_urls: photoUrls
  };

  await addDoc(collection(db, "announcements"), announcementData);
}
// change pendingDelete shape
let pendingDelete = { id: null, photoUrls: [], owner: null };

// open / close
export function openDeleteConfirm(announcementId, photoUrls = [], owner = null) {
  pendingDelete.id = announcementId;
  pendingDelete.photoUrls = Array.isArray(photoUrls) ? photoUrls : [];
  pendingDelete.owner = owner || null;
  const popup = document.getElementById('deleteConfirmPopup');
  if (popup) popup.classList.add('active');
}

export function closeDeleteConfirm() {
  pendingDelete.id = null;
  pendingDelete.photoUrls = [];
  pendingDelete.owner = null;
  const popup = document.getElementById('deleteConfirmPopup');
  if (popup) popup.classList.remove('active');
}

async function deleteSupabaseObject(publicUrlOrPathOrId) {
  if (!publicUrlOrPathOrId) return;
  
  try {
    // --- 1. Determine the Folder Prefix ---
    let folderPrefix = "";
    const pubPrefix = `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_BUCKET}/`;

    if (typeof publicUrlOrPathOrId === 'string') {
      if (publicUrlOrPathOrId.startsWith(pubPrefix)) {
        const pathPart = publicUrlOrPathOrId.slice(pubPrefix.length);
        const parts = pathPart.split('/');
        folderPrefix = `${parts[0]}/${parts[1]}`; 
      } 
      else if (publicUrlOrPathOrId.startsWith('announcement_pic/')) {
        const parts = publicUrlOrPathOrId.split('/');
        folderPrefix = `${parts[0]}/${parts[1]}`;
      } 
      else {
        folderPrefix = `announcement_pic/${publicUrlOrPathOrId}`;
      }
    } else {
      const maybeId = String(publicUrlOrPathOrId).trim();
      if (maybeId) folderPrefix = `announcement_pic/${maybeId}`;
    }

    if (!folderPrefix) {
      console.warn('deleteSupabaseObject: cannot determine folder prefix.');
      return;
    }

    // Add trailing slash for listing
    const searchPrefix = `${folderPrefix}/`;
    const idToken = sessionStorage.getItem("idToken");
    if (!idToken) throw new Error("Missing idToken for Supabase deletion");

    // --- 2. List all objects in the folder ---
    const listUrl = `${SUPABASE_URL}/storage/v1/object/list/${SUPABASE_BUCKET}`;
    
    const listRes = await fetch(listUrl, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prefix: searchPrefix,
        limit: 1000
      })
    });

    if (!listRes.ok) {
      const errorText = await listRes.text().catch(() => null);
      console.warn(`Failed to list objects for prefix ${searchPrefix}:`, listRes.status, errorText);
      return;
    }

    const files = await listRes.json();

    // --- 3. Delete each object individually ---
    if (Array.isArray(files) && files.length > 0) {
      console.log(`Found ${files.length} files to delete in ${searchPrefix}`);
      
      await Promise.all(files.map(async (fileObj) => {
        // FIX: Handle relative filenames (e.g., "0.png") vs absolute paths
        // fileObj.name might be "0.png" or "announcement_pic/id/0.png"
        let fileName = fileObj.name;
        
        let fullPath = fileName;
        
        // If the name doesn't already start with the folder prefix, it's relative
        if (!fileName.startsWith(folderPrefix)) {
            fullPath = `${folderPrefix}/${fileName}`;
        }

        const encodedPath = encodeURIComponent(fullPath);
        const deleteUrl = `${SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${encodedPath}`;

        const delRes = await fetch(deleteUrl, {
          method: "DELETE",
          headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${idToken}`
          }
        });

        if (!delRes.ok) {
          console.error(`Failed to delete file: ${fullPath}`, delRes.status);
        } else {
          console.log(`Successfully deleted: ${fullPath}`);
        }
      }));
    } else {
      console.log("No files found in folder, cleanup not needed.");
    }

  } catch (err) {
    console.error("deleteSupabaseObject error:", err);
    throw err;
  }
}


export async function confirmDeleteAnnouncement() {
  const confirmBtn = document.querySelector('.confirm-delete-btn');
  if (!pendingDelete.id) return closeDeleteConfirm();

  const originalText = confirmBtn ? confirmBtn.textContent : null;
  if (confirmBtn) {
    confirmBtn.textContent = "Deleting...";
    confirmBtn.disabled = true;
  }

  try {
    if (!auth.currentUser) throw new Error("User not authenticated");
    const currentUid = auth.currentUser.uid;

    // Basic permission check: owner OR GCO/admin
    const ownerUid = pendingDelete.owner;
    let allowed = false;

    // owner can always delete
    if (ownerUid && ownerUid === currentUid) {
      allowed = true;
    } else {
      // check account_details for admin/userType
      const accSnap = await getDoc(doc(db, "account_details", currentUid));
      const acc = accSnap.exists() ? accSnap.data() : {};

      // allow GCO + admins
      if (
        acc.userType === 'gco' ||
        acc.accountType === 'gco' ||
        acc.role === 'gco' ||
        acc.isAdmin === true
      ) {
        allowed = true;
      }
      if (!pendingDelete.owner && acc.userType === 'gco') {
        allowed = true;
      }
    }

    

    if (!allowed) throw new Error("You are not permitted to delete this announcement.");

    // 1) delete supabase images if any
    await deleteSupabaseObject(pendingDelete.id);

    // 2) delete firestore doc
    await deleteDoc(doc(db, "announcements", pendingDelete.id));

    // 3) close popup & notify
    closeDeleteConfirm();
    alert("Announcement deleted.");
  } catch (err) {
    console.error("Failed to delete announcement:", err);
    alert("Failed to delete announcement: " + (err.message || err));
  } finally {
    if (confirmBtn) {
      confirmBtn.textContent = originalText || "Delete";
      confirmBtn.disabled = false;
    }
    pendingDelete.id = null;
    pendingDelete.photoUrls = [];
    pendingDelete.owner = null;
  }
}