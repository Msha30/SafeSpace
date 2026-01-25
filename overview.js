// overview.js
import { db } from "./auth.js";
import { 
  collection, 
  getDocs 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// Import helpers from userManagement.js
import { fetchAllUsers, formatUserData } from "./usermanagement.js";

const programs = [
    "Accountancy, Business and Management (ABM) Strand",
    "Humanities and Social Sciences (HUMSS) Strand",
    "Science, Technology, Engineering and Mathematics (STEM) Strand",
    "BS Hospitality Management",
    "BS Tourism Management",
    "BS Computer Engineering",
    "BS Civil Engineering",
    "BS Information Technology",
    "BS Psychology",
    "AB Communication",
    "BS Architecture",
    "BS Accountancy",
    "BS Business Administration"
];

/**
 * Updates the Programs table on the Overview page
 * Calculates "New Users this Month" and "Total Users" per program
 */
export async function updateProgramsTable() {
    try {
        const users = await fetchAllUsers();

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        programs.forEach((program, index) => {
            const rowNum = index + 1;
            const newUsersCell = document.getElementById(`rw${rowNum}_newusers`);
            const totalUsersCell = document.getElementById(`rw${rowNum}_totalusers`);
            const changeCell = document.getElementById(`rw${rowNum}_change`);

            if (!newUsersCell || !totalUsersCell || !changeCell) return;

            // Filter users by program
            const programUsers = users.filter(u => u.program === program);

            // Count total users
            const totalUsers = programUsers.length;

            // Count new users this month
            const newUsersThisMonth = programUsers.filter(u => {
                const createdAt = u.createdAt?.toDate ? u.createdAt.toDate() : new Date(u.createdAt);
                return createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear;
            }).length;

            // Placeholder for change %, can compute with historical data if available
            const changePercent = 0; 
            const changeClass = changePercent >= 0 ? 'up' : 'down';

            // Update table cells
            newUsersCell.textContent = newUsersThisMonth;
            totalUsersCell.textContent = totalUsers;
            changeCell.textContent = `${changePercent} %`;
            changeCell.className = changeClass; // update class to reflect up/down
        });

    } catch (err) {
        console.error("Failed to update programs table:", err);
    }
}

/**
 * Updates the Student Count and PEERS Count stat cards
 */
export async function updateUserCounts() {
  try {
    // Fetch users and format them to access rawData
    const users = (await fetchAllUsers()).map(formatUserData);

    const students = users.filter(u => u.rawData.userType === 'student');
    const peers = users.filter(u => u.rawData.userType === 'peer');

    const studentCountEl = document.getElementById('student_count');
    const peersCountEl = document.getElementById('peers_count');

    if (studentCountEl) studentCountEl.textContent = students.length;
    if (peersCountEl) peersCountEl.textContent = peers.length;
  } catch (err) {
    console.error("Failed to update stats counts:", err);
  }
}

/**
 * Master function to refresh all Overview data
 */
export async function refreshProgramsDashboard() {
    await updateProgramsTable();
    await updateUserCounts();
}