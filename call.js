// call.js - Enhanced version with multi-type calling support
import { app, auth } from "./auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  updateDoc,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const db = getFirestore(app);

// ICE SERVERS CONFIG
export async function getIceServersFromMetered(apiKey) {
  try {
    const res = await fetch(
      `https://safespace_connection.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
    );
    if (!res.ok) {
      throw new Error(`Metered TURN error ${res.status}`);
    }
    const iceServers = await res.json();
    return iceServers;
  } catch (err) {
    console.error("Failed to fetch iceServers from Metered:", err);
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

const STATIC_ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject"
  }
];

export function getPeerConfiguration(iceServers = null) {
  return {
    iceServers: iceServers || STATIC_ICE_SERVERS,
    iceCandidatePoolSize: 10
  };
}

export function createPeerConnectionWithStream(localStream, iceServers, callbacks = {}) {
  const config = getPeerConfiguration(iceServers);
  const pc = new RTCPeerConnection(config);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  if (callbacks.ontrack) {
    pc.ontrack = callbacks.ontrack;
  }

  if (callbacks.onicecandidate) {
    pc.onicecandidate = callbacks.onicecandidate;
  }

  if (callbacks.onconnectionstatechange) {
    pc.onconnectionstatechange = () => {
      callbacks.onconnectionstatechange(pc.connectionState);
    };
  }

  return pc;
}

export async function getCallStream(mode = "video") {
  const constraints = {
    audio: mode === "audio" || mode === "video",
    video: mode === "video" ? {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 }
    } : false
  };
  
  if (mode === "audio" || mode === "video") {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  
  return null; // For face-to-face, no media stream needed
}

export async function createCallDoc({ callId, callerId, createdBy, submissionId, type }) {
  const ref = doc(db, "calls", callId);

  await setDoc(ref, {
    callerId,
    createdBy,
    submissionId,
    type,
    status: "ringing",
    createdAt: serverTimestamp()
  });

  return ref;
}

export function listenForAnswer(callRef, callbacks) {
  const unsub = onSnapshot(callRef, snap => {
    const data = snap.data();
    if (!data) return;

    if (data.answer && callbacks.onAnswer) {
      callbacks.onAnswer(data.answer);
    }

    if (data.status && callbacks.onStatusChange) {
      callbacks.onStatusChange(data.status);
    }
  });
  return unsub;
}

export function listenForRemoteAnswerCandidates(callRef, callbacks) {
  const col = collection(callRef, "answerCandidates");
  const q = query(col, orderBy("createdAt", "asc"));

  const unsub = onSnapshot(q, snap => {
    snap.docChanges().forEach(change => {
      if (change.type === "added") {
        const data = change.doc.data();
        
        if (data.candidate && callbacks.onCandidate) {
          callbacks.onCandidate(data.candidate);
        }
      }
    });
  });
  return unsub;
}

// HIGH-LEVEL START CALL (COUNSELOR SIDE)
export async function startCall({
  submissionId,
  mode = "video", // "video", "audio", or "face-to-face"
  meteredApiKey,
  dom,
  onStatusChange,
  onError
}) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    const err = new Error("You must be logged in to start a call.");
    if (onError) onError(err);
    throw err;
  }

  let callDocRef = null;
  let pc = null;
  let localStream = null;
  let remoteAnswerCandidatesUnsub = null;
  let answerUnsub = null;

  try {
    // 1) Get submission to find the student (createdBy)
    const submissionRef = doc(db, "CounselingForm_Submissions", submissionId);
    const submissionSnap = await getDoc(submissionRef);
    if (!submissionSnap.exists()) {
      throw new Error("Submission not found.");
    }

    const submission = submissionSnap.data();
    const createdBy = submission.createdBy;
    if (!createdBy) {
      throw new Error("Submission has no createdBy field.");
    }

    console.log(`[call.js] Starting ${mode} call to student:`, createdBy);

    // 2) Handle different call modes
    if (mode === "face-to-face") {
      // For face-to-face, just create call document without WebRTC
      const callId = `call_${submissionId}_${Date.now()}`;
      callDocRef = await createCallDoc({
        callId,
        callerId: currentUser.uid,
        createdBy,
        submissionId,
        type: mode
      });

      console.log("[call.js] Face-to-face session created:", callId);
      if (onStatusChange) onStatusChange("in_session");

      // Return cleanup function for face-to-face
      return function endSession() {
        console.log("[call.js] Ending face-to-face session...");
        
        if (callDocRef) {
          updateDoc(callDocRef, { status: "ended" }).catch(console.error);
        }
      };
    }

    // 3) Get local media for audio/video calls
    localStream = await getCallStream(mode);

    if (dom) {
      if (mode === "video" && dom.localVideo) {
        dom.localVideo.srcObject = localStream;
        dom.localVideo.muted = true;
      }
      
      // For audio calls, hide video elements
      if (mode === "audio") {
        if (dom.localVideo) dom.localVideo.style.display = 'none';
        if (dom.remoteVideo) dom.remoteVideo.style.display = 'none';
      }
    }

    // 4) Get ICE servers (optional)
    let iceServers = null;
    if (meteredApiKey) {
      iceServers = await getIceServersFromMetered(meteredApiKey);
    }

    // 5) Create PeerConnection
    pc = createPeerConnectionWithStream(localStream, iceServers, {
      ontrack(event) {
        console.log("[call.js] Remote track received");
        const remoteStream = event.streams[0];
        if (dom && dom.remoteVideo && mode === "video") {
          dom.remoteVideo.srcObject = remoteStream;
        }
      },
      onicecandidate(event) {
        if (!event.candidate || !callDocRef) return;
        
        console.log("[call.js] New ICE candidate");
        
        addDoc(collection(callDocRef, "offerCandidates"), {
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex
          },
          createdAt: serverTimestamp()
        }).catch(err => {
          console.error("Error writing offer candidate:", err);
          if (onError) onError(err);
        });
      },
      onconnectionstatechange(state) {
        console.log("[call.js] Connection state:", state);
        if (state === "connected") {
          if (onStatusChange) onStatusChange("connected");
        } else if (state === "disconnected" || state === "failed") {
          if (onStatusChange) onStatusChange("ended");
        }
      }
    });

    // 6) Create call document
    const callId = `call_${submissionId}_${Date.now()}`;
    callDocRef = await createCallDoc({
      callId,
      callerId: currentUser.uid,
      createdBy,
      submissionId,
      type: mode
    });

    console.log("[call.js] Call document created:", callId);
    if (onStatusChange) onStatusChange("ringing");

    // 7) Listen for answer candidates from Android
    remoteAnswerCandidatesUnsub = listenForRemoteAnswerCandidates(callDocRef, {
      onCandidate(candidateData) {
        console.log("[call.js] Received answer candidate from Android");
        
        const candidate = new RTCIceCandidate({
          candidate: candidateData.candidate,
          sdpMid: candidateData.sdpMid,
          sdpMLineIndex: candidateData.sdpMLineIndex
        });
        
        pc.addIceCandidate(candidate)
          .then(() => console.log("[call.js] Answer candidate added"))
          .catch(err => {
            console.error("Error adding answer candidate:", err);
            if (onError) onError(err);
          });
      }
    });

    // 8) Create offer
    console.log("[call.js] Creating offer...");
    const offer = await pc.createOffer({
      offerToReceiveVideo: mode === "video",
      offerToReceiveAudio: true
    });
    
    await pc.setLocalDescription(offer);

    const offerData = {
      type: offer.type,
      sdp: offer.sdp
    };

    await updateDoc(callDocRef, {
      offer: offerData
    });

    console.log("[call.js] Offer sent to Firestore");

    // 9) Listen for answer from Android
    answerUnsub = listenForAnswer(callDocRef, {
      onAnswer(answerData) {
        if (pc.currentRemoteDescription) {
          console.log("[call.js] Already have remote description, ignoring");
          return;
        }
        
        console.log("[call.js] Received answer from Android");
        const answerDesc = new RTCSessionDescription(answerData);
        pc.setRemoteDescription(answerDesc)
          .then(() => console.log("[call.js] Answer set successfully"))
          .catch(err => {
            console.error("Error setting remote description:", err);
            if (onError) onError(err);
          });
      },
      onStatusChange(status) {
        if (onStatusChange) onStatusChange(status);
      }
    });

    // 10) Return cleanup function
    return function hangup() {
      console.log("[call.js] Hanging up...");
      
      // 1. Unsubscribe from Firestore listeners
      if (remoteAnswerCandidatesUnsub) remoteAnswerCandidatesUnsub();
      if (answerUnsub) answerUnsub();
      
      // 2. Stop all tracks from peer connection senders (THIS IS THE FIX!)
      if (pc) {
        // Get all senders and stop their tracks
        pc.getSenders().forEach(sender => {
          if (sender.track) {
            console.log("[call.js] Stopping track from sender:", sender.track.kind);
            sender.track.stop();
          }
        });
        
        // Close the peer connection
        pc.close();
        pc = null;
      }
      
      // 3. Stop all tracks from local stream (redundant but safe)
      if (localStream) {
        localStream.getTracks().forEach(track => {
          console.log("[call.js] Stopping track from localStream:", track.kind);
          track.stop();
        });
        localStream = null;
      }

      // 4. Clear video elements
      if (dom && dom.localVideo) {
        dom.localVideo.srcObject = null;
      }
      if (dom && dom.remoteVideo) {
        dom.remoteVideo.srcObject = null;
      }

      // 5. Delete call document and subcollections
      if (callDocRef) {
        deleteCallDocument(callDocRef).catch(console.error);
      }
      
      console.log("[call.js] Cleanup complete - camera should be off");
    };
    
    async function deleteCallDocument(callDocRef) {
      try {
        // 1. Delete offerCandidates subcollection
        const offerCandidatesRef = collection(callDocRef, "offerCandidates");
        const offerSnapshot = await getDocs(offerCandidatesRef);
        const offerDeletes = offerSnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(offerDeletes);
        
        // 2. Delete answerCandidates subcollection
        const answerCandidatesRef = collection(callDocRef, "answerCandidates");
        const answerSnapshot = await getDocs(answerCandidatesRef);
        const answerDeletes = answerSnapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(answerDeletes);
        
        // 3. Delete the call document itself
        await deleteDoc(callDocRef);
        
        console.log("[call.js] Call document and subcollections deleted");
      } catch (err) {
        console.error("[call.js] Error deleting call document:", err);
      }
    }

  } catch (err) {
    console.error("[call.js] startCall error:", err);
    
    // Cleanup on error
    if (remoteAnswerCandidatesUnsub) remoteAnswerCandidatesUnsub();
    if (answerUnsub) answerUnsub();
    
    // Stop all tracks from peer connection
    if (pc) {
      pc.getSenders().forEach(sender => {
        if (sender.track) sender.track.stop();
      });
      pc.close();
    }
    
    // Stop all tracks from local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    
    if (onError) onError(err);
    throw err;
  }
}