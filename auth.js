// ----- Firebase imports -----
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, onAuthStateChanged, signOut, browserSessionPersistence,
  setPersistence, signInWithEmailAndPassword, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ----- Firebase config -----
const firebaseConfig = {
  apiKey: "AIzaSyCGEuf2N9t6P4uh1RQdgx3Z4c5L0IwkXqw",
  authDomain: "safespace-af7ec.firebaseapp.com",
  projectId: "safespace-af7ec",
  storageBucket: "safespace-af7ec.firebasestorage.app",
  messagingSenderId: "991289668478",
  appId: "1:991289668478:web:3801f6f457dcd05669392f",
  measurementId: "G-Y15M17H93J",
  databaseURL: "https://safespace-af7ec-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// ----- Initialize Firebase -----
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const rtdb = getDatabase(app);

// ----- Force session-only persistence -----
(async () => { await setPersistence(auth, browserSessionPersistence); })();

// ----- Role redirects -----
const roleRedirects = { "admin": "IT Admin.html", "gco": "GCO.html" };

// ----- Helpers -----

// Get cached token or refresh if needed
export async function getIdTokenCached(forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdToken(forceRefresh);
  sessionStorage.setItem("idToken", token);
  return token;
}

// Fetch wrapper that attaches Firebase token
export async function fetchWithAuth(url, options = {}) {
  const token = sessionStorage.getItem("idToken") || await getIdTokenCached();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...options, headers });
}

// ----- Login -----
export async function loginUser(email, password) {
  try {
    // 1) Firebase sign-in
    const userCred = await signInWithEmailAndPassword(auth, email, password);
    const user = userCred.user;

    // 2) Get Firebase ID token
    const idToken = await user.getIdToken();
    sessionStorage.setItem("idToken", idToken);

    // 3) Call Vercel assign-role endpoint
    const assignResp = await fetch("https://safe-space-backend.vercel.app/api/assign-role.js", {
      method: "POST",
      headers: { "Authorization": `Bearer ${idToken}` }
    });
    const assignData = await assignResp.json();
    console.log("assign-role response:", assignData);

    // 4) Fetch Firestore account_details
    const ref = doc(db, "account_details", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists() || !snap.data().role) {
      throw new Error("No role assigned to this user.");
    }

    const data = snap.data();
    sessionStorage.setItem("userData", JSON.stringify(data));

    // 5) Redirect based on role
    const redirectPage = roleRedirects[data.role];
    if (!redirectPage) throw new Error("Invalid assigned role.");
    window.location.href = redirectPage;

  } catch (err) {
    alert(err.message);
    console.error("Login error:", err);
  }
}

// ----- Logout -----
export async function logout() {
  await signOut(auth);
  sessionStorage.clear();
  localStorage.clear();
  window.location.href = "index.html";
}
window.logout = logout;

// ----- Protect Dashboard -----
export function protectDashboard(allowedRoles = []) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    let data = JSON.parse(sessionStorage.getItem("userData") || "null");

    if (!data) {
      const ref = doc(db, "account_details", user.uid);
      const snap = await getDoc(ref);
      if (!snap.exists()) { await logout(); return; }
      data = snap.data();
      sessionStorage.setItem("userData", JSON.stringify(data));
    }

    if (!allowedRoles.includes(data.role)) { await logout(); return; }

    const nameElem = document.getElementById("userDisplayName");
    if (nameElem) nameElem.textContent = data.name || data.role || "User";

    // Refresh token in sessionStorage
    await getIdTokenCached();
  });
}

// ----- Password Reset -----
export async function sendResetEmail(email) {
  try { await sendPasswordResetEmail(auth, email); alert(`Password reset email sent to ${email}`); } 
  catch (err) { alert(err.message); }
}
export async function resendResetEmail(email) { if (!email) return alert("Enter email first"); return sendResetEmail(email); }

window.sendResetEmail = sendResetEmail;
window.resendResetEmail = resendResetEmail;
window.loginUser = loginUser;