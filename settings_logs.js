// settings_logs.js

import { db, auth } from "./auth.js";
// Firestore Imports
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// RTDB Imports
import {
  getDatabase,
  ref,
  get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/**
 * Fetches Terms and Conditions from Firestore
 * Path: /TermsAndPrivacy/TermsAndConditions
 */
async function fetchTermsAndConditions() {
    try {
        const docRef = doc(db, "TermsAndPrivacy", "TermsAndConditions");
        const docSnap = await getDoc(docRef);
        const termsContainer = document.querySelector('#termsModal .terms-box');

        if (docSnap.exists() && termsContainer) {
            const data = docSnap.data();
            termsContainer.innerHTML = data.content || "No terms content available.";
        } else {
            console.error("Terms document does not exist.");
            if(termsContainer) termsContainer.innerHTML = "Terms currently unavailable.";
        }
    } catch (error) {
        console.error("Error fetching Terms and Conditions:", error);
    }
}

/**
 * Fetches Privacy Policy from Firestore
 * Path: /TermsAndPrivacy/PrivacyPolicy
 */
async function fetchPrivacyPolicy() {
    try {
        const docRef = doc(db, "TermsAndPrivacy", "PrivacyPolicy");
        const docSnap = await getDoc(docRef);
        const privacyContainer = document.querySelector('#privacyModal .terms-box');

        if (docSnap.exists() && privacyContainer) {
            const data = docSnap.data();
            privacyContainer.innerHTML = data.content || "No privacy policy content available.";
        } else {
            console.error("Privacy document does not exist.");
            if(privacyContainer) privacyContainer.innerHTML = "Privacy Policy currently unavailable.";
        }
    } catch (error) {
        console.error("Error fetching Privacy Policy:", error);
    }
}

// --- UI HELPER: DATE INPUTS ---
/**
 * Disables/Enables date inputs based on radio selection
 */
function setupDateDisablers(container, radioGroupName) {
    const radios = container.querySelectorAll(`input[name="${radioGroupName}"]`);
    const inputs = container.querySelectorAll('input[type="date"]');

    const toggleInputs = () => {
        const customRadio = container.querySelector(`input[name="${radioGroupName}"][value="custom"]`);
        const isCustom = customRadio.checked;
        
        inputs.forEach(input => {
            input.disabled = !isCustom;
            if (!isCustom) input.value = ''; // Clear value if disabled
        });
    };

    // Attach listeners and run initial check
    radios.forEach(radio => {
        radio.addEventListener('change', toggleInputs);
    });
    toggleInputs();
}

// --- PEER TO PEER LOGIC (RTDB) ---

// Global caches for users to avoid re-fetching
let allPeersMap = {};
let allStudentsMap = {};
let rtdbMessagesCache = null; // Cache RTDB data to avoid multiple reads

/**
 * Initializes logic for Peer to Peer Export using RTDB
 */
async function initializePeerToPeerLogic() {
    const p2pContent = document.getElementById('peerToPeerContent');
    
    // Dropdowns
    const peerSelect = p2pContent.querySelector('.exportChatRow:nth-child(1) .exportChatGroup:nth-child(1) select');
    const studentSelect = p2pContent.querySelector('.exportChatRow:nth-child(1) .exportChatGroup:nth-child(2) select');
    const exportBtn = p2pContent.querySelector('.exportChatBtn');

    // 1. Setup Date Disablers
    setupDateDisablers(p2pContent, 'dateRange');

    // 2. Fetch Users (Peers and Students) from Firestore
    try {
        // Fetch Peers
        const peerQuery = query(collection(db, "account_details"), where("userType", "==", "peer"));
        const peerSnapshot = await getDocs(peerQuery);
        peerSelect.innerHTML = '<option value="">Select</option>';
        peerSnapshot.forEach(doc => {
            allPeersMap[doc.id] = doc.data();
            const u = doc.data();
            const option = document.createElement('option');
            option.value = doc.id;
            option.textContent = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || "Unknown Peer";
            peerSelect.appendChild(option);
        });

        // Fetch Students
        const studentQuery = query(collection(db, "account_details"), where("userType", "==", "student"));
        const studentSnapshot = await getDocs(studentQuery);
        studentSnapshot.forEach(doc => {
            allStudentsMap[doc.id] = doc.data();
        });

    } catch (error) {
        console.error("Error fetching users for export:", error);
        alert("Could not load user list.");
    }

    // 3. Peer Selection Handler -> Filter Students from RTDB
    peerSelect.addEventListener('change', async (e) => {
        const selectedPeerId = e.target.value;
        studentSelect.innerHTML = '<option value="">Select</option>'; // Reset

        if (!selectedPeerId) return;

        try {
            const dbRtdb = getDatabase();
            const msgsRef = ref(dbRtdb, 'messages');
            const snapshot = await get(msgsRef);

            if (snapshot.exists()) {
                rtdbMessagesCache = snapshot.val(); // Cache data for export
                const allMessagesData = snapshot.val();
                const matchingStudentIds = new Set();

                // Iterate through RTDB messages to find students who chatted with this peer
                Object.keys(allMessagesData).forEach(convId => {
                    const convData = allMessagesData[convId];
                    // Check if this conversation involves the selected peer
                    if (convData && convData.peerId === selectedPeerId && convData.studentId) {
                        matchingStudentIds.add(convData.studentId);
                    }
                });

                // Populate Student Dropdown
                matchingStudentIds.forEach(studentId => {
                    const studentData = allStudentsMap[studentId];
                    if (studentData) {
                        const option = document.createElement('option');
                        option.value = studentId;
                        // Display LastName, FirstName instead of UID
                        const lname = studentData.lname || '';
                        const fname = studentData.fname || '';
                        option.textContent = (lname && fname) ? `${lname}, ${fname}` : studentId;
                        studentSelect.appendChild(option);
                    }
                });

                if (matchingStudentIds.size === 0) {
                    const option = document.createElement('option');
                    option.textContent = "No chats found for this peer";
                    studentSelect.appendChild(option);
                }

            } else {
                rtdbMessagesCache = {};
            }
        } catch (error) {
            console.error("Error fetching RTDB messages:", error);
            alert("Error checking for chat history.");
        }
    });

    // 4. Export Handler (CSV)
    exportBtn.addEventListener('click', async () => {
        const selectedPeerId = peerSelect.value;
        const selectedStudentId = studentSelect.value;

        if (!selectedPeerId || !selectedStudentId) {
            alert("Please select both a Peer and a Student.");
            return;
        }

        // Determine Date Range
        const dateRange = getSelectedDateRange(p2pContent, 'dateRange');
        if (!dateRange) return;

        // 5. Find Specific Conversation
        let targetConversation = null;

        // Ensure RTDB cache
        if (!rtdbMessagesCache) {
            try {
                const dbRtdb = getDatabase();
                const snapshot = await get(ref(dbRtdb, 'messages'));
                if (snapshot.exists()) rtdbMessagesCache = snapshot.val();
                else rtdbMessagesCache = {};
            } catch (e) {
                console.error(e);
                alert("Failed to read messages from RTDB.");
                return;
            }
        }

        // Find conversation object that matches peer+student
        for (const convId of Object.keys(rtdbMessagesCache || {})) {
            const conv = rtdbMessagesCache[convId];
            if (!conv) continue;
            if ((conv.peerId === selectedPeerId && conv.studentId === selectedStudentId) ||
                (conv.peerId === selectedStudentId && conv.studentId === selectedPeerId)) {
                targetConversation = conv;
                break;
            }
        }

        if (!targetConversation) {
            alert("Could not find conversation data.");
            return;
        }

        // 6. Flatten messages and filter by timestamp
        const rawMessages = targetConversation.messages;
        const flattenedMessages = [];

        if (Array.isArray(rawMessages)) {
            const rangeStartMs = dateRange.start ? dateRange.start.getTime() : null;
            const rangeEndMs = dateRange.end ? dateRange.end.getTime() : null;

            rawMessages.forEach(slot => {
                if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return;
                Object.values(slot).forEach(msgObj => {
                    if (!msgObj || typeof msgObj !== 'object') return;
                    const ts = Number(msgObj.timestamp || msgObj.time || msgObj.date || 0);
                    if (!ts) return;

                    const afterStart = (rangeStartMs === null) || (ts >= rangeStartMs);
                    const beforeEnd  = (rangeEndMs === null) || (ts <= rangeEndMs);
                    if (afterStart && beforeEnd) {
                        flattenedMessages.push(msgObj);
                    }
                });
            });
        }

        // 7. Sort messages
        flattenedMessages.sort((a, b) => (Number(a.timestamp || 0) - Number(b.timestamp || 0)));

        // 8. Prepare Data for CSV
        const peerDoc = allPeersMap[selectedPeerId] || null;
        const studentDoc = allStudentsMap[selectedStudentId] || null;
        
        const peerDisplay = peerDoc ? `${peerDoc.lastName || peerDoc.lname || ''}, ${peerDoc.firstName || peerDoc.fname || ''}`.trim() : selectedPeerId;
        const studentDisplay = studentDoc ? `${studentDoc.lastName || studentDoc.lname || ''}, ${studentDoc.firstName || studentDoc.fname || ''}`.trim() : selectedStudentId;

        // Header Row
        const csvRows = [
            ["Moderation", "Name", "Date", "Messages"]
        ];

        flattenedMessages.forEach(msg => {
            const ts = Number(msg.timestamp || 0);
            const dateObj = new Date(ts);
            const dateStr = dateObj.toLocaleString(); // Readable format
            
            // Determine Name based on senderId
            let senderName = "Unknown";
            const senderId = msg.senderId || msg.uid || msg.sender;
            
            if (senderId === selectedPeerId) senderName = peerDisplay;
            else if (senderId === selectedStudentId) senderName = studentDisplay;
            else senderName = senderId || "Unknown";

            // Get Fields
            const moderation = msg.moderation || msg.moderationStatus || "N/A";
            const messageText = msg.text || msg.message || msg.content || "";

            csvRows.push([moderation, senderName, dateStr, messageText]);
        });

        // 9. Trigger CSV Download
        const safePeerId = (peerDisplay || selectedPeerId).replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
        const safeStudentId = (studentDisplay || selectedStudentId).replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
        downloadCSV(csvRows, `export_p2p_${safePeerId}_${safeStudentId}.csv`);
    });
}

// --- SUPPORT GROUP LOGIC (Firestore) ---
/**
 * Initializes logic for the Export Chat Modal (Support Group Tab)
 */
async function initializeSupportGroupLogic() {
    const sgContent = document.getElementById('supportGroupContent');
    
    // Selectors
    const sgSelect = sgContent.querySelector('.exportChatRow:nth-child(1) .exportChatGroup:nth-child(1) select');
    const gcSelect = sgContent.querySelector('.exportChatRow:nth-child(1) .exportChatGroup:nth-child(2) select');
    const exportBtn = sgContent.querySelector('.exportChatBtn');

    // 1. Setup Date Disablers
    setupDateDisablers(sgContent, 'dateRange2');

    // 2. Fetch Support Groups
    try {
        const querySnapshot = await getDocs(collection(db, "supportgroup"));
        sgSelect.innerHTML = '<option value="">Select</option>';
        
        querySnapshot.forEach((docSnapshot) => {
            const data = docSnapshot.data();
            const option = document.createElement('option');
            option.value = docSnapshot.id;
            option.textContent = data.supportgroup_name || "Unnamed Group";
            sgSelect.appendChild(option);
        });
    } catch (error) {
        console.error("Error fetching support groups:", error);
    }

    // 3. Handle Support Group Selection
    sgSelect.addEventListener('change', async (e) => {
        const selectedGroupId = e.target.value;
        gcSelect.innerHTML = '<option value="">Select</option>';

        if (!selectedGroupId) return;

        try {
            const groupDocRef = doc(db, "supportgroup", selectedGroupId);
            const groupDocSnap = await getDoc(groupDocRef);

            if (groupDocSnap.exists()) {
                const groupData = groupDocSnap.data();
                const groupchats = groupData.groupchats || []; 

                groupchats.forEach((chat) => {
                    const option = document.createElement('option');
                    option.value = chat.groupchatId; 
                    option.textContent = chat.name || "Unnamed Chat";
                    gcSelect.appendChild(option);
                });
            }
        } catch (error) {
            console.error("Error fetching group chats:", error);
        }
    });

    // 4. Export Handler (Support Group CSV)
    exportBtn.addEventListener('click', async () => {
        const selectedGroupId = sgSelect.value;
        const selectedChatId = gcSelect.value;
        
        if (!selectedGroupId || !selectedChatId) {
            alert("Please select both a Support Group and a Group Chat.");
            return;
        }

        const dateRange = getSelectedDateRange(sgContent, 'dateRange2');
        if (!dateRange) return;

        try {
            const messagesRef = collection(db, "supportgroup", selectedGroupId, "groupchats", selectedChatId, "messages");
            const constraints = [orderBy('timestamp', 'asc')];
            const q = query(messagesRef, ...constraints);
            const querySnapshot = await getDocs(q);

            const rangeStartMs = dateRange.start ? dateRange.start.getTime() : null;
            const rangeEndMs = dateRange.end ? dateRange.end.getTime() : null;

            const csvRows = [
                ["Moderation", "Name", "Date", "Messages"]
            ];

            querySnapshot.forEach(docSnap => {
                const data = docSnap.data();
                let ts = null;

                // Normalize timestamp
                if (data.timestamp != null) {
                    const cand = data.timestamp;
                    if (typeof cand === 'number') ts = Number(cand);
                    else if (cand && typeof cand.toDate === 'function') ts = cand.toDate().getTime();
                    else {
                        const maybeDate = new Date(cand);
                        if (!isNaN(maybeDate.getTime())) ts = maybeDate.getTime();
                    }
                }

                if (!ts) return;

                // Date Filter
                const afterStart = rangeStartMs === null || ts >= rangeStartMs;
                const beforeEnd  = rangeEndMs === null || ts <= rangeEndMs;
                if (!afterStart || !beforeEnd) return;

                // Map Fields
                const dateStr = new Date(ts).toLocaleString();
                const moderation = data.moderation || data.moderationStatus || "N/A";
                
                // Name: Prefer senderName if stored, else senderId
                let name = data.senderName || data.senderId || "Unknown";
                // Try to lookup name from account_details if not present in message doc (Optional optimization)
                // For now, stick to what is in the message doc to keep exports fast.
                
                const messageText = data.text || data.message || data.content || "";

                csvRows.push([moderation, name, dateStr, messageText]);
            });

            const sgOption = sgSelect.options[sgSelect.selectedIndex];
            const gcOption = gcSelect.options[gcSelect.selectedIndex];
            const supportGroupName = sgOption ? sgOption.textContent : selectedGroupId;
            const groupChatName    = gcOption ? gcOption.textContent : selectedChatId;

            const safeGroup = (supportGroupName || selectedGroupId).replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
            const safeChat  = (groupChatName  || selectedChatId).replace(/\s+/g, "_").replace(/[^\w\-]/g, "");
            
            downloadCSV(csvRows, `export_sg_${safeGroup}_${safeChat}.csv`);

        } catch (error) {
            console.error("Error fetching messages for export:", error);
            alert("Failed to export chat. Check console for details.");
        }
    });
}

// --- COMMON HELPERS ---

function getSelectedDateRange(container, radioGroupName) {
    const radios = container.querySelectorAll(`input[name="${radioGroupName}"]`);
    let selectedValue = null;
    for (const radio of radios) {
        if (radio.checked) selectedValue = radio.value;
    }

    const now = new Date();
    let startDate = null;
    let endDate = new Date(); 

    if (selectedValue === 'today') {
        startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (selectedValue === 'past15') {
        startDate = new Date(now.setDate(now.getDate() - 15));
    } else if (selectedValue === 'past30') {
        startDate = new Date(now.setDate(now.getDate() - 30));
    } else if (selectedValue === 'custom') {
        const startStr = container.querySelector('.exportChatGroup:nth-child(1) input').value;
        const endStr = container.querySelector('.exportChatGroup:nth-child(2) input').value;
        if (startStr) startDate = new Date(startStr);
        if (endStr) endDate = new Date(endStr);
        
        if (!startDate || !endDate) {
            alert("Please select a valid custom date range.");
            return null;
        }
    } else {
        alert("Please select a date range.");
        return null;
    }

    return { start: startDate, end: endDate };
}

/**
 * Helper to escape CSV strings (handles commas, quotes, newlines)
 */
function escapeCSV(str) {
    if (str === undefined || str === null) return "";
    str = str.toString();
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

/**
 * Downloads data as a CSV file
 */
function downloadCSV(rows, filename) {
    const csvContent = rows.map(e => e.map(escapeCSV).join(",")).join("\n");
    
    // Create a blob with BOM for Excel UTF-8 compatibility
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Main initialization function for the Settings & Logs page
 */
export async function initializeSettingsLogs() {
    await fetchTermsAndConditions();
    await fetchPrivacyPolicy();
    
    // Initialize Peer to Peer Logic (RTDB)
    await initializePeerToPeerLogic();

    // Initialize Support Group Logic (Firestore)
    await initializeSupportGroupLogic();
}