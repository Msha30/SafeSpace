// gcodetails.js
import { db, auth } from "./auth.js";
import {
  collection,
  getDocs,
  getDoc,
  doc,
  query,
  where,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Global state
let gcoReportsData = [];
let currentGCOFilter = 'all';

/* ============================
   Helper: Get user info
============================ */
async function getUserInfo(uid) {
  if (!uid) return { fname: '', lname: '', email: '' };
  
  try {
    const userDoc = await getDoc(doc(db, "account_details", uid));
    if (userDoc.exists()) {
      return userDoc.data();
    }
  } catch (error) {
    console.error("Error fetching user info:", error);
  }
  
  return { fname: '', lname: '', email: '' };
}

/* ============================
   Helper: Format name
============================ */
function formatName(userData) {
  // Check if 'name' field exists (used by counselors)
  if (userData.name) {
    return userData.name;
  }
  
  // Otherwise use fname/lname (used by students)
  const lname = userData.lname || '';
  const fname = userData.fname || '';
  
  if (!lname && !fname) return 'Unknown';
  
  return `${lname}${lname && fname ? ', ' : ''}${fname}`.trim();
}

/* ============================
   Helper: Format date
============================ */
function formatDate(timestamp) {
  if (!timestamp) return 'N/A';
  
  let date;
  
  if (typeof timestamp === 'object' && timestamp.toDate) {
    // Firestore Timestamp
    date = timestamp.toDate();
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else {
    return 'N/A';
  }
  
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  });
}

/* ============================
   Fetch GCO Video Call Reports
============================ */
async function fetchGCOVideoCalls() {
  const reports = [];
  
  try {
    const q = query(
      collection(db, "CounselingForm_Submissions"),
      where("preferredPlatform", "==", "Video Call"),
      where("status", "==", "completed")
    );
    
    const snapshot = await getDocs(q);
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      
      // Get student info
      const studentInfo = await getUserInfo(data.createdBy);
      
      // Get counselor info (completed_by or taken_by)
      const counselorUid = data.completed_by || data.taken_by;
      const counselorInfo = await getUserInfo(counselorUid);
      
      reports.push({
        date: formatDate(data.completed_at || data.createdAt),
        student: formatName(studentInfo),
        type: 'video_call',
        assignedTo: formatName(counselorInfo),
        role: 'GCO Counselor'
      });
    }
  } catch (error) {
    console.error("Error fetching video call reports:", error);
  }
  
  return reports;
}

/* ============================
   Fetch GCO Voice Call Reports
============================ */
async function fetchGCOCalls() {
  const reports = [];
  
  try {
    const q = query(
      collection(db, "CounselingForm_Submissions"),
      where("preferredPlatform", "==", "Call"),
      where("status", "==", "completed")
    );
    
    const snapshot = await getDocs(q);
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      
      const studentInfo = await getUserInfo(data.createdBy);
      const counselorUid = data.completed_by || data.taken_by;
      const counselorInfo = await getUserInfo(counselorUid);
      
      reports.push({
        date: formatDate(data.completed_at || data.createdAt),
        student: formatName(studentInfo),
        type: 'call',
        assignedTo: formatName(counselorInfo),
        role: 'GCO Counselor'
      });
    }
  } catch (error) {
    console.error("Error fetching call reports:", error);
  }
  
  return reports;
}

/* ============================
   Fetch GCO Face-to-Face Reports
============================ */
async function fetchGCOF2F() {
  const reports = [];
  
  try {
    const q = query(
      collection(db, "CounselingForm_Submissions"),
      where("preferredPlatform", "==", "Face to Face"),
      where("status", "==", "completed")
    );
    
    const snapshot = await getDocs(q);
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      
      const studentInfo = await getUserInfo(data.createdBy);
      const counselorUid = data.completed_by || data.taken_by;
      const counselorInfo = await getUserInfo(counselorUid);
      
      reports.push({
        date: formatDate(data.completed_at || data.createdAt),
        student: formatName(studentInfo),
        type: 'f2f',
        assignedTo: formatName(counselorInfo),
        role: 'GCO Counselor'
      });
    }
  } catch (error) {
    console.error("Error fetching F2F reports:", error);
  }
  
  return reports;
}

/* ============================
   Fetch Peer Referral Reports
============================ */
async function fetchPeerReferrals() {
  const reports = [];
  
  try {
    const snapshot = await getDocs(collection(db, "referral_submission"));
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      
      const studentInfo = await getUserInfo(data.studentUid);
      const peerInfo = await getUserInfo(data.submitted_by);
      
      reports.push({
        date: formatDate(data.date_submitted),
        student: formatName(studentInfo),
        type: 'peer_referral',
        assignedTo: formatName(peerInfo),
        role: 'Peer Facilitator'
      });
    }
  } catch (error) {
    console.error("Error fetching peer referrals:", error);
  }
  
  return reports;
}

/* ============================
   Fetch Peer Face-to-Face Reports
============================ */
async function fetchPeerF2F() {
  const reports = [];
  
  try {
    const snapshot = await getDocs(collection(db, "peertopeer_session"));
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      
      // Only include completed sessions (not cancelled)
      if (data.isCancelled === true) continue;
      
      const studentInfo = await getUserInfo(data.studentUid);
      const peerInfo = await getUserInfo(data.peerUid);
      
      reports.push({
        date: formatDate(data.start_time || data.date_submitted),
        student: formatName(studentInfo),
        type: 'peer_f2f',
        assignedTo: formatName(peerInfo),
        role: 'Peer Facilitator'
      });
    }
  } catch (error) {
    console.error("Error fetching peer F2F reports:", error);
  }
  
  return reports;
}

/* ============================
   Fetch All Reports
============================ */
export async function fetchAllGCOReports() {
  console.log("Fetching all GCO reports...");
  
  gcoReportsData = [];
  
  // Fetch all report types in parallel
  const [videoCalls, calls, f2f, referrals, peerF2F] = await Promise.all([
    fetchGCOVideoCalls(),
    fetchGCOCalls(),
    fetchGCOF2F(),
    fetchPeerReferrals(),
    fetchPeerF2F()
  ]);
  
  // Combine all reports
  gcoReportsData = [
    ...videoCalls,
    ...calls,
    ...f2f,
    ...referrals,
    ...peerF2F
  ];
  
  // Sort by date (newest first)
  gcoReportsData.sort((a, b) => {
    const dateA = new Date(a.date);
    const dateB = new Date(b.date);
    return dateB - dateA;
  });
  
  console.log(`Fetched ${gcoReportsData.length} total reports`);
  
  // Update counts
  updateReportCounts();
  
  // Render table
  renderGCOTable(currentGCOFilter);
}

/* ============================
   Update Report Counts
============================ */
function updateReportCounts() {
  const counts = {
    all: gcoReportsData.length,
    video_call: gcoReportsData.filter(r => r.type === 'video_call').length,
    call: gcoReportsData.filter(r => r.type === 'call').length,
    f2f: gcoReportsData.filter(r => r.type === 'f2f').length,
    peer_referral: gcoReportsData.filter(r => r.type === 'peer_referral').length,
    peer_f2f: gcoReportsData.filter(r => r.type === 'peer_f2f').length
  };
  
  // Update count displays
  document.querySelector('[data-filter="all"] .gco-report-count').textContent = counts.all;
  document.querySelector('[data-filter="video_call"] .gco-report-count').textContent = counts.video_call;
  document.querySelector('[data-filter="call"] .gco-report-count').textContent = counts.call;
  document.querySelector('[data-filter="f2f"] .gco-report-count').textContent = counts.f2f;
  document.querySelector('[data-filter="peer_referral"] .gco-report-count').textContent = counts.peer_referral;
  document.querySelector('[data-filter="peer_f2f"] .gco-report-count').textContent = counts.peer_f2f;
}

/* ============================
   Get Report Type Badge
============================ */
function getReportTypeBadge(type) {
  const badges = {
    video_call: '<span class="report-type-badge badge-video-call">GCO Video Call</span>',
    call: '<span class="report-type-badge badge-call">GCO Call</span>',
    f2f: '<span class="report-type-badge badge-f2f">GCO F2F</span>',
    peer_referral: '<span class="report-type-badge badge-referral">Peer Referral</span>',
    peer_f2f: '<span class="report-type-badge badge-peer-f2f">Peer F2F</span>'
  };
  return badges[type] || type;
}

/* ============================
   Render Table
============================ */
export function renderGCOTable(filter) {
  const tbody = document.getElementById('gco-details-tbody');
  
  if (!tbody) {
    console.warn("GCO details tbody not found");
    return;
  }
  
  const data = filter === 'all'
    ? gcoReportsData
    : gcoReportsData.filter(item => item.type === filter);
  
  tbody.innerHTML = data.length
    ? data.map(item => `
        <tr>
          <td>${item.date}</td>
          <td>${item.student}</td>
          <td>${getReportTypeBadge(item.type)}</td>
          <td>${item.assignedTo}</td>
          <td>${item.role}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="5" style="text-align:center;padding:40px;">No reports found</td></tr>`;
}

/* ============================
   Filter Reports
============================ */
export function filterGCOReports(type, card) {
  currentGCOFilter = type;
  
  document.querySelectorAll('.gco-report-card')
    .forEach(c => c.classList.remove('active'));
  
  card.classList.add('active');
  
  const filterNames = {
    all: 'All Reports',
    video_call: 'GCO Video Call',
    call: 'GCO Voice Call',
    f2f: 'GCO Face-to-Face',
    peer_referral: 'Peer Referrals',
    peer_f2f: 'Peer Face-to-Face'
  };
  
  document.getElementById('current-filter').textContent = filterNames[type];
  renderGCOTable(type);
}

/* ============================
   Export Reports
============================ */
export function exportGCOReports() {
  const data = currentGCOFilter === 'all'
    ? gcoReportsData
    : gcoReportsData.filter(d => d.type === currentGCOFilter);
  
  if (data.length === 0) {
    alert('No reports to export');
    return;
  }
  
  let csv = "Consultation Date,Student Name,Consultation Type,Assigned Counselor/Peer,Role\n";
  
  data.forEach(d => {
    const typeLabel = {
      video_call: 'GCO Video Call',
      call: 'GCO Voice Call',
      f2f: 'GCO Face-to-Face',
      peer_referral: 'Peer Referral',
      peer_f2f: 'Peer Face-to-Face'
    }[d.type] || d.type;
    
    csv += `${escapeCSV(d.date)},${escapeCSV(d.student)},${escapeCSV(typeLabel)},${escapeCSV(d.assignedTo)},${escapeCSV(d.role)}\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `GCO_Reports_${currentGCOFilter}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
}

function escapeCSV(str) {
  if (str === undefined || str === null) return "";
  str = str.toString();
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/* ============================
   Initialize Event Listeners
============================ */
export function initGCOReports() {
  // Card click listeners
  document.addEventListener('click', function (e) {
    const card = e.target.closest('.gco-report-card');
    if (!card) return;
    
    filterGCOReports(card.dataset.filter, card);
  });
  
  // Export button
  const exportBtn = document.getElementById('exportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportGCOReports);
  }
  
  // Initial fetch
  fetchAllGCOReports();
}