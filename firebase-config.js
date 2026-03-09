/* ============================================
   Firebase Configuration
   沿用 Volume-Evaluation-Tool 的 Firebase Project
   ============================================ */

// Firebase config — 使用者需在此填入自己的 Firebase 設定
// 或透過 URL 參數動態載入
const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

let db = null;
let firebaseReady = false;

/**
 * 從 URL hash 或 localStorage 載入 Firebase 設定
 * 支援格式: #firebase=BASE64_ENCODED_CONFIG
 */
function loadFirebaseConfig() {
  // 1. 嘗試從 localStorage 讀取
  const saved = localStorage.getItem('firebase_config');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.projectId) return parsed;
    } catch (e) { /* ignore */ }
  }

  // 2. 嘗試從 URL hash 讀取
  const hash = window.location.hash;
  if (hash.startsWith('#firebase=')) {
    try {
      const encoded = hash.substring('#firebase='.length);
      const decoded = atob(encoded);
      const parsed = JSON.parse(decoded);
      if (parsed.projectId) {
        localStorage.setItem('firebase_config', JSON.stringify(parsed));
        return parsed;
      }
    } catch (e) { /* ignore */ }
  }

  // 3. 使用預設 (可能為空)
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

/**
 * 手動設定 Firebase config（從 UI 輸入）
 */
function setFirebaseConfig(configObj) {
  localStorage.setItem('firebase_config', JSON.stringify(configObj));
  // 重新初始化
  if (firebase.apps.length > 0) {
    firebase.app().delete().then(() => {
      const success = initFirebase(configObj);
      if (success) {
        updateFirebaseStatus(true, configObj.projectId);
        loadProjects();
      }
    });
  } else {
    const success = initFirebase(configObj);
    if (success) {
      updateFirebaseStatus(true, configObj.projectId);
      loadProjects();
    }
  }
}
