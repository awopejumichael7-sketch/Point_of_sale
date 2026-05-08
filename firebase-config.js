/**
 * NexaPOS — Firebase Configuration
 * Replace the placeholder values with your actual Firebase project credentials.
 * Get them from: https://console.firebase.google.com
 */

// ─── Firebase SDK (compat version for simplicity) ───
// Include these in HTML before this script:
// <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-storage-compat.js"></script>
// <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-auth-compat.js"></script>

//const firebaseConfig = {
//  apiKey: "AIzaSyC_qDSpaFEItsWmD2OpFnWP8UuK8GdJ2Vc",
  //  authDomain: "pointofsale-8e170.firebaseapp.com",
  //  projectId: "pointofsale-8e170",
//    storageBucket: "pointofsale-8e170.firebasestorage.app",
 //   messagingSenderId: "906227114724",
 //   appId: "1:906227114724:web:b08f10ea3e62ed8e6882f1",
    
//};

// ─── Firebase State ───
let firebaseApp = null;
let db = null;
let storage = null;
let auth = null;
let firebaseAvailable = false;

/**
 * Initialize Firebase. Falls back to LocalStorage-only mode if Firebase
 * is not configured or unavailable.
 */
function initFirebase() {
  try {
    if (
      typeof firebase !== 'undefined' &&
      firebaseConfig.apiKey !== 'YOUR_API_KEY'
    ) {
      if (!firebase.apps.length) {
        firebaseApp = firebase.initializeApp(firebaseConfig);
      } else {
        firebaseApp = firebase.apps[0];
      }
      db = firebase.firestore();
      storage = firebase.storage();
      auth = firebase.auth();
      firebaseAvailable = true;
      console.log('[NexaPOS] Firebase initialized successfully.');
    } else {
      console.warn('[NexaPOS] Firebase not configured — using LocalStorage mode.');
      firebaseAvailable = false;
    }
  } catch (err) {
    console.warn('[NexaPOS] Firebase init failed, using LocalStorage:', err.message);
    firebaseAvailable = false;
  }
}

// Initialize on load
initFirebase();
