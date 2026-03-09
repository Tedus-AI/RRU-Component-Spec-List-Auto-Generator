/* ============================================
   Firebase Configuration
   沿用 Volume-Evaluation-Tool 的 Firebase Project
   ============================================ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCXRb5WNCl7otxPwjMCVsutvT0VHQEseUU",
  authDomain: "g-quick-volume-evaluation.firebaseapp.com",
  projectId: "g-quick-volume-evaluation",
  storageBucket: "g-quick-volume-evaluation.firebasestorage.app",
  messagingSenderId: "325375750956",
  appId: "1:325375750956:web:cfae2ed9cc05501a0bb289",
  measurementId: "G-HJBCDHTZPZ"
};

let db = null;
let firebaseReady = false;

/**
 * 直接回傳內建的 Firebase 設定
 */
function loadFirebaseConfig() {
  return FIREBASE_CONFIG;
}

/**
 * 初始化 Firebase
 */
function initFirebase(config) {
  try {
    if (!config || !config.projectId) {
      console.warn('Firebase config incomplete — projectId missing');
      return false;
    }

    // 避免重複初始化
    if (firebase.apps.length === 0) {
      firebase.initializeApp(config);
    }
    db = firebase.firestore();
    firebaseReady = true;
    console.log(`Firebase connected: ${config.projectId}`);
    return true;
  } catch (err) {
    console.error('Firebase init error:', err);
    return false;
  }
}
