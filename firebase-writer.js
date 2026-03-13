/* ============================================
   Firebase Writer — Firestore CRUD
   沿用 Volume-Evaluation-Tool 資料結構
   ============================================ */

// ---- doc_id 規則（與 Volume-Evaluation-Tool 一致）----
function toDocId(componentName) {
  return componentName
    .replace(/ /g, '_')
    .replace(/\//g, '-')
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '');
}

// ---- Collection 名稱映射 ----
const COLLECTION_MAP = {
  RF: 'rf_library',
  Digital: 'digital_library',
  PWR: 'pwr_library'
};

const FIELD_MAP = {
  RF: 'rf_data',
  Digital: 'digital_data',
  PWR: 'pwr_data'
};

// ---- 讀取專案清單 ----
async function fetchProjects() {
  if (!db) throw new Error('Firebase 未連線');
  const snapshot = await db.collection('projects').get();
  const projects = [];
  snapshot.forEach(doc => {
    projects.push({
      id: doc.id,
      ...doc.data()
    });
  });
  return projects;
}

// ---- 讀取單一專案完整資料 ----
async function fetchProjectData(projectId) {
  if (!db) throw new Error('Firebase 未連線');
  const doc = await db.collection('projects').doc(projectId).get();
  if (!doc.exists) throw new Error(`專案 "${projectId}" 不存在`);
  return doc.data();
}

// ---- 更新專案中單一元件資料 ----
async function updateProjectComponent(projectId, fieldName, dataArray) {
  if (!db) throw new Error('Firebase 未連線');
  await db.collection('projects').doc(projectId).update({
    [fieldName]: dataArray
  });
}

// ---- 新增專案 ----
async function createProject(projectId, projectName) {
  if (!db) throw new Error('Firebase 未連線');
  const docRef = db.collection('projects').doc(projectId);
  const existing = await docRef.get();
  if (existing.exists) {
    throw new Error(`專案 "${projectId}" 已存在`);
  }
  await docRef.set({
    project_name: projectName,
    meta: { version: 'v4.30', timestamp: new Date().toISOString() },
    rf_data: [],
    digital_data: [],
    pwr_data: []
  });
  return projectId;
}

// ---- 寫入 Library（新增或覆蓋）----
async function writeToLibrary(componentType, record) {
  if (!db) throw new Error('Firebase 未連線');
  const collectionName = COLLECTION_MAP[componentType];
  if (!collectionName) throw new Error(`Unknown component type: ${componentType}`);

  const docId = toDocId(record.Component);
  if (!docId) throw new Error('Component 名稱為空');

  await db.collection(collectionName).doc(docId).set(record);
  return { collection: collectionName, docId };
}

// ---- 寫入 Project（Append）----
async function writeToProject(projectId, componentType, record) {
  if (!db) throw new Error('Firebase 未連線');
  const fieldName = FIELD_MAP[componentType];
  if (!fieldName) throw new Error(`Unknown component type: ${componentType}`);

  await db.collection('projects').doc(projectId).update({
    [fieldName]: firebase.firestore.FieldValue.arrayUnion(record)
  });
  return { projectId, field: fieldName };
}

// ---- 批次寫入 ----
async function batchWrite(items, projectId, options) {
  const results = [];
  const { writeLibrary = true, writeProject = true } = options;

  for (const item of items) {
    const { type, record } = item;
    const logs = [];

    try {
      if (writeLibrary) {
        const libResult = await writeToLibrary(type, record);
        logs.push({ success: true, target: `${libResult.collection}/${libResult.docId}` });
      }

      if (writeProject && projectId) {
        const projResult = await writeToProject(projectId, type, record);
        logs.push({ success: true, target: `projects/${projResult.projectId}/${projResult.field}` });
      }

      results.push({ component: record.Component, type, logs, success: true });
    } catch (err) {
      results.push({ component: record.Component, type, logs, success: false, error: err.message });
    }
  }

  return results;
}
