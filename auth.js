// ----- Firebase imports -----
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, onAuthStateChanged, signOut, browserSessionPersistence, setPersistence 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ----- Firebase config -----
const firebaseConfig = {
  apiKey: "AIzaSyCGEuf2N9t6P4uh1RQdgx3Z4c5L0IwkXqw",
  authDomain: "safespace-af7ec.firebaseapp.com",
  projectId: "safespace-af7ec",
  storageBucket: "safespace-af7ec.firebasestorage.app",
  messagingSenderId: "991289668478",
  appId: "1:991289668478:web:3801f6f457dcd05669392f",
  measurementId: "G-Y15M17H93J"
};

// ----- Initialize Firebase -----
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ----- Force session-only persistence -----
async function initAuth() {
  await setPersistence(auth, browserSessionPersistence);
}
initAuth();

let loggingOut = false;

// ----- Logout function -----
export async function logout() {
  loggingOut = true;
  try {
    await signOut(auth);
    sessionStorage.clear();
    localStorage.clear();
    window.location.href = "index.html";
  } catch (err) {
    console.error("Sign-out error:", err);
  } finally {
    loggingOut = false;
  }
}

window.logout = logout;

// ----- Protect dashboard & update user name with caching -----
export function protectDashboard(allowedRoles = []) {
  onAuthStateChanged(auth, async (user) => {
    if (loggingOut) return;

    if (!user) {
      window.location.href = "index.html";
      return;
    }

    let data;
    const cached = sessionStorage.getItem("userData");
    if (cached) {
      try { data = JSON.parse(cached); } catch { data = null; }
    }

    if (!data) {
      try {
        const ref = doc(db, "account_details", user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists() || !snap.data().role) {
          await logout();
          return;
        }
        data = snap.data();
        sessionStorage.setItem("userData", JSON.stringify(data));
      } catch (err) {
        console.error(err);
        await logout();
        return;
      }
    }

    if (!allowedRoles.includes(data.role)) {
      await logout();
      return;
    }

    const dropdownSpan = document.getElementById("userDisplayName");
    if (dropdownSpan) dropdownSpan.textContent = data.name || data.role || "User";
  });
}
