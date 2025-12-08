// overview.js
import { db } from "./auth.js";
import {
    collection,
    query,
    where,
    getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

window.addEventListener("DOMContentLoaded", () => {
    loadCachedCounts();
    loadUserCounts();
});

function loadCachedCounts() {
    const studentElem = document.getElementById("student_count");
    const peerElem = document.getElementById("peers_count");

    const cached = JSON.parse(sessionStorage.getItem("overviewCounts") || "{}");

    if (studentElem && cached.students !== undefined) {
        studentElem.textContent = cached.students;
    }
    if (peerElem && cached.peers !== undefined) {
        peerElem.textContent = cached.peers;
    }
}

async function loadUserCounts() {
    const studentElem = document.getElementById("student_count");
    const peerElem = document.getElementById("peers_count");

    try {
        const ref = collection(db, "account_details");

        const qStudent = query(ref, where("userType", "==", "student"));
        const snapStudent = await getDocs(qStudent);

        const qPeer = query(ref, where("userType", "==", "peer"));
        const snapPeer = await getDocs(qPeer);

        const counts = {
            students: snapStudent.size,
            peers: snapPeer.size
        };

        // Update UI
        if (studentElem) studentElem.textContent = counts.students;
        if (peerElem) peerElem.textContent = counts.peers;

        // Save to cache
        sessionStorage.setItem("overviewCounts", JSON.stringify(counts));

    } catch (err) {
        console.error("Overview count error:", err);
    }
}
