/* ============================================
   App.js — Main Application Logic
   元件規格清單產生器
   ============================================ */

// ---- State ----
let selectedComponentType = 'RF';
let selectedProjectId = '';
let currentInputTab = 'text';
let parsedRecords = [];       // Current AI parse results (array of records)
let currentRecordIndex = 0;   // For multi-component navigation
let stagingList = [];          // { type, record }[]
let imageBase64 = null;
let imageMimeType = null;
let pdfBase64 = null;

// ---- Default Values per Component Type ----
const DEFAULTS = {
  RF:      { 'Height(mm)': 250, Pad_L: 10, Pad_W: 10, 'Thick(mm)': 2.5, Board_Type: 'Copper Coin', 'Limit(C)': 200, R_jc: 1.5, TIM_Type: 'Grease' },
  Digital: { 'Height(mm)': 50,  Pad_L: 10, Pad_W: 10, 'Thick(mm)': 0,   Board_Type: 'Thermal Via', 'Limit(C)': 100, R_jc: 0.5, TIM_Type: 'Putty' },
  PWR:     { 'Height(mm)': 30,  Pad_L: 20, Pad_W: 20, 'Thick(mm)': 0,   Board_Type: 'None',        'Limit(C)': 95,  R_jc: 0,   TIM_Type: 'Grease' }
};

// ---- Field Metadata ----
const FIELDS = [
  { key: 'Component',  label: 'Component',  type: 'text',   aiConfidence: 'high',   required: true },
  { key: 'Qty',        label: 'Qty',        type: 'number', aiConfidence: 'high',   required: true },
  { key: 'Power(W)',   label: 'Power(W)',   type: 'number', aiConfidence: 'high',   required: true },
  { key: 'Height(mm)', label: 'Height(mm)', type: 'number', aiConfidence: 'warn',   required: true },
  { key: 'Pad_L',      label: 'Pad_L',      type: 'number', aiConfidence: 'high',   required: true },
  { key: 'Pad_W',      label: 'Pad_W',      type: 'number', aiConfidence: 'high',   required: true },
  { key: 'Thick(mm)',   label: 'Thick(mm)',  type: 'number', aiConfidence: 'manual', required: true },
  { key: 'Board_Type', label: 'Board_Type', type: 'enum',   aiConfidence: 'manual', required: true, options: ['Thermal Via', 'Copper Coin', 'None'] },
  { key: 'Limit(C)',   label: 'Limit(°C)',  type: 'number', aiConfidence: 'high',   required: true },
  { key: 'R_jc',       label: 'R_jc',       type: 'number', aiConfidence: 'high',   required: true },
  { key: 'TIM_Type',   label: 'TIM_Type',   type: 'enum',   aiConfidence: 'manual', required: true, options: ['Grease', 'Pad', 'Pad2', 'Putty', 'None'] }
];

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  // Init Firebase
  const config = loadFirebaseConfig();
  if (config && config.projectId) {
    const success = initFirebase(config);
    if (success) {
      updateFirebaseStatus(true, config.projectId);
      loadProjects();
    }
  }

  // Load saved API key
  const savedProvider = sessionStorage.getItem('ai_provider') || 'gemini';
  currentProvider = savedProvider;
  document.getElementById('providerSelect').value = savedProvider;
  updateProviderUI();

  const savedKey = sessionStorage.getItem(`apiKey_${savedProvider}`);
  if (savedKey) {
    document.getElementById('apiKeyInput').value = savedKey;
  }

  // Event listeners
  setupEventListeners();
});

function setupEventListeners() {
  // Provider select
  document.getElementById('providerSelect').addEventListener('change', (e) => {
    currentProvider = e.target.value;
    sessionStorage.setItem('ai_provider', currentProvider);
    updateProviderUI();
    // Load saved key for this provider
    const savedKey = sessionStorage.getItem(`apiKey_${currentProvider}`);
    document.getElementById('apiKeyInput').value = savedKey || '';
  });

  // API Key input — save on change
  document.getElementById('apiKeyInput').addEventListener('change', (e) => {
    const key = e.target.value.trim();
    if (key) {
      sessionStorage.setItem(`apiKey_${currentProvider}`, key);
    }
  });

  // OpenRouter model select
  document.getElementById('openrouterModelSelect').addEventListener('change', (e) => {
    sessionStorage.setItem('openrouter_model', e.target.value);
  });

  // Project select
  document.getElementById('projectSelect').addEventListener('change', (e) => {
    selectedProjectId = e.target.value;
    updateWriteTargets();
  });

  // Image drop zone
  const imageZone = document.getElementById('imageDropZone');
  imageZone.addEventListener('click', () => document.getElementById('imageFileInput').click());
  imageZone.addEventListener('dragover', (e) => { e.preventDefault(); imageZone.classList.add('dragover'); });
  imageZone.addEventListener('dragleave', () => imageZone.classList.remove('dragover'));
  imageZone.addEventListener('drop', handleImageDrop);
  document.getElementById('imageFileInput').addEventListener('change', handleImageFileSelect);

  // PDF drop zone
  const pdfZone = document.getElementById('pdfDropZone');
  pdfZone.addEventListener('click', () => document.getElementById('pdfFileInput').click());
  pdfZone.addEventListener('dragover', (e) => { e.preventDefault(); pdfZone.classList.add('dragover'); });
  pdfZone.addEventListener('dragleave', () => pdfZone.classList.remove('dragover'));
  pdfZone.addEventListener('drop', handlePdfDrop);
  document.getElementById('pdfFileInput').addEventListener('change', handlePdfFileSelect);

  // Paste event (for screenshots)
  document.addEventListener('paste', handlePaste);

  // Text input — 監聽輸入變化以更新 summary
  document.getElementById('textInput').addEventListener('input', updateInputSummary);
}

// ============================================
// UI Updates
// ============================================
function updateFirebaseStatus(connected, projectId) {
  const el = document.getElementById('firebaseStatus');
  const dot = el.querySelector('.status-dot');
  const text = el.querySelector('.status-text');
  if (connected) {
    dot.className = 'status-dot online';
    text.textContent = `Firebase: ${projectId}`;
  } else {
    dot.className = 'status-dot offline';
    text.textContent = 'Firebase 未連線';
  }
}

function updateProviderUI() {
  const group = document.getElementById('openrouterModelGroup');
  group.style.display = currentProvider === 'openrouter' ? '' : 'none';

  const link = document.getElementById('getKeyLink');
  link.href = AI_PROVIDERS[currentProvider].getKeyUrl;
}

function updateWriteTargets() {
  const collName = COLLECTION_MAP[selectedComponentType];
  const fieldName = FIELD_MAP[selectedComponentType];

  document.getElementById('libraryTarget').textContent = collName;
  document.getElementById('projectTarget').textContent =
    selectedProjectId ? `projects/${selectedProjectId}/${fieldName}` : 'projects/{id}/' + fieldName;
}

function updateStagingCounts() {
  const counts = { RF: 0, Digital: 0, PWR: 0 };
  stagingList.forEach(item => counts[item.type]++);
  document.getElementById('rfCount').textContent = counts.RF;
  document.getElementById('digitalCount').textContent = counts.Digital;
  document.getElementById('pwrCount').textContent = counts.PWR;

  const hasItems = stagingList.length > 0;
  document.getElementById('stagingList').style.display = hasItems ? '' : 'none';
  document.getElementById('writeFirebaseBtn').disabled = !hasItems;

  // Render staging table
  renderStagingTable();
}

function renderStagingTable() {
  const tbody = document.getElementById('stagingTableBody');
  tbody.innerHTML = '';
  stagingList.forEach((item, idx) => {
    const tr = document.createElement('tr');
    const typeClass = item.type === 'RF' ? 'rf' : item.type === 'Digital' ? 'digital' : 'pwr';
    tr.innerHTML = `
      <td><span class="staging-badge ${typeClass}">${item.type}</span></td>
      <td class="value-display">${item.record.Component || '—'}</td>
      <td class="value-display">${item.record['Power(W)'] ?? '—'}</td>
      <td class="value-display">${item.record['Limit(C)'] ?? '—'}</td>
      <td class="value-display">${item.record.R_jc ?? '—'}</td>
      <td><button class="btn-remove" onclick="removeStagingItem(${idx})">移除</button></td>
    `;
    tbody.appendChild(tr);
  });
}

// ============================================
// Panel Toggle
// ============================================
function togglePanel(panelId) {
  document.getElementById(panelId).classList.toggle('collapsed');
}

// ============================================
// Component Type Selection
// ============================================
function selectComponentType(type) {
  selectedComponentType = type;
  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  updateWriteTargets();
}

// ============================================
// Input Tab Selection
// ============================================
function selectInputTab(tab) {
  currentInputTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  const tabId = { text: 'tabText', image: 'tabImage', pdf: 'tabPdf' }[tab];
  document.getElementById(tabId).classList.add('active');
}

// ============================================
// Image Handling
// ============================================
function handleImageDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    loadImageFile(file);
  }
}

function handleImageFileSelect(e) {
  const file = e.target.files[0];
  if (file) loadImageFile(file);
}

function handlePaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const file = item.getAsFile();
      loadImageFile(file);
      selectInputTab('image');
      break;
    }
  }
}

function loadImageFile(file) {
  imageMimeType = file.type;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    imageBase64 = dataUrl.split(',')[1];

    const preview = document.getElementById('imagePreview');
    preview.src = dataUrl;
    preview.style.display = 'block';
    document.querySelector('#imageDropZone .drop-zone-content').style.display = 'none';
    updateInputSummary();
  };
  reader.readAsDataURL(file);
}

// ============================================
// PDF Handling
// ============================================
function handlePdfDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') {
    loadPdfFile(file);
  }
}

function handlePdfFileSelect(e) {
  const file = e.target.files[0];
  if (file) loadPdfFile(file);
}

function loadPdfFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    pdfBase64 = dataUrl.split(',')[1];

    const info = document.getElementById('pdfInfo');
    info.textContent = `已載入: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    info.style.display = 'block';
    document.querySelector('#pdfDropZone .drop-zone-content').style.display = 'none';
    updateInputSummary();
  };
  reader.readAsDataURL(file);
}

// ============================================
// Input Summary — 顯示哪些輸入來源有資料
// ============================================
function updateInputSummary() {
  const text = document.getElementById('textInput').value.trim();
  const hasText = !!text;
  const hasImage = !!imageBase64;
  const hasPdf = !!pdfBase64;
  const count = (hasText ? 1 : 0) + (hasImage ? 1 : 0) + (hasPdf ? 1 : 0);

  // 更新 tab 按鈕上的 has-data 標記
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    const has = (tab === 'text' && hasText) || (tab === 'image' && hasImage) || (tab === 'pdf' && hasPdf);
    btn.classList.toggle('has-data', has);
  });

  // 更新摘要列
  const summary = document.getElementById('inputSummary');
  const tags = document.getElementById('inputSummaryTags');
  if (count >= 2) {
    const labels = [];
    if (hasText) labels.push('文字');
    if (hasImage) labels.push('截圖');
    if (hasPdf) labels.push('PDF');
    tags.innerHTML = labels.map(l => `<span class="summary-tag">${l}</span>`).join('');
    summary.style.display = '';
  } else {
    summary.style.display = 'none';
  }
}

// ============================================
// AI Parse
// ============================================
async function handleAIParse() {
  // 收集所有有資料的輸入來源
  const text = document.getElementById('textInput').value.trim();
  const hasText = !!text;
  const hasImage = !!imageBase64;
  const hasPdf = !!pdfBase64;

  if (!hasText && !hasImage && !hasPdf) {
    showToast('請至少提供一種輸入（文字、截圖或 PDF）', 'warning');
    return;
  }

  // 綜合所有輸入來源
  const content = buildCombinedContent(text, imageBase64, imageMimeType, pdfBase64);

  const apiKey = sessionStorage.getItem(`apiKey_${currentProvider}`);
  if (!apiKey) { showToast('請先輸入 API Key', 'warning'); return; }

  showLoading('AI 解析中...');

  try {
    parsedRecords = await callAI(content, selectedComponentType);
    currentRecordIndex = 0;

    // Apply defaults for null fields
    parsedRecords = parsedRecords.map(rec => applyDefaults(rec, selectedComponentType));

    // Show multi-component notice
    const multiEl = document.getElementById('multiDetect');
    if (parsedRecords.length > 1) {
      multiEl.textContent = `偵測到 ${parsedRecords.length} 個元件`;
      multiEl.style.display = '';
    } else {
      multiEl.style.display = 'none';
    }

    renderResultTable();
    document.getElementById('addToListBtn').disabled = false;
    showToast(`解析完成，共 ${parsedRecords.length} 個元件`, 'success');
  } catch (err) {
    showToast(`解析失敗: ${err.message}`, 'error');
    console.error('AI parse error:', err);
  } finally {
    hideLoading();
  }
}

function applyDefaults(record, type) {
  const defaults = DEFAULTS[type];
  const result = { ...record };

  for (const [key, defaultVal] of Object.entries(defaults)) {
    if (result[key] === null || result[key] === undefined) {
      result[key] = defaultVal;
    }
  }

  // Ensure Qty is at least 1
  if (!result.Qty || result.Qty < 1) result.Qty = 1;

  return result;
}

// ============================================
// Result Table Rendering
// ============================================
function renderResultTable() {
  const wrap = document.getElementById('resultTableWrap');

  if (parsedRecords.length === 0) {
    wrap.innerHTML = '<p class="placeholder-text">尚未解析</p>';
    return;
  }

  let html = '';

  // Multi-component navigation
  if (parsedRecords.length > 1) {
    html += '<div class="component-nav">';
    parsedRecords.forEach((rec, i) => {
      const name = rec.Component || `元件 ${i + 1}`;
      const active = i === currentRecordIndex ? 'active' : '';
      html += `<button class="component-nav-btn ${active}" onclick="selectRecord(${i})">${name}</button>`;
    });
    html += '</div>';
  }

  const record = parsedRecords[currentRecordIndex];

  html += '<table class="data-table"><thead><tr>';
  html += '<th>欄位</th><th>值</th><th>狀態</th>';
  html += '</tr></thead><tbody>';

  for (const field of FIELDS) {
    const value = record[field.key];
    const status = getFieldStatus(field, value, record);

    html += '<tr>';
    html += `<td style="font-weight:500">${field.label}</td>`;
    html += `<td class="cell-editable" onclick="editCell(this, ${currentRecordIndex}, '${field.key}', '${field.type}')" data-field="${field.key}">`;

    if (field.type === 'enum') {
      html += `<span class="value-display">${value ?? '<span class="value-null">null</span>'}</span>`;
    } else {
      html += `<span class="value-display">${value !== null && value !== undefined ? value : '<span class="value-null">null</span>'}</span>`;
    }

    html += '</td>';
    html += `<td>${status}</td>`;
    html += '</tr>';
  }

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function getFieldStatus(field, value, record) {
  if (value === null || value === undefined) {
    if (field.required) {
      return '<span class="status-icon status-null">🔴 必填</span>';
    }
    return '<span class="status-icon status-manual">✏️ 可選</span>';
  }

  if (field.aiConfidence === 'manual') {
    return '<span class="status-icon status-manual">✏️ 預設值</span>';
  }
  if (field.aiConfidence === 'warn') {
    return '<span class="status-icon status-warn">⚠️ 請確認</span>';
  }
  return '<span class="status-icon status-confident">✅</span>';
}

function selectRecord(index) {
  currentRecordIndex = index;
  renderResultTable();
}

// ============================================
// Inline Cell Editing
// ============================================
function editCell(td, recordIndex, fieldKey, fieldType) {
  // Prevent double-editing
  if (td.querySelector('input, select')) return;

  const record = parsedRecords[recordIndex];
  const currentValue = record[fieldKey];
  const field = FIELDS.find(f => f.key === fieldKey);

  if (fieldType === 'enum' && field.options) {
    const select = document.createElement('select');
    select.className = 'cell-select';
    field.options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt;
      if (opt === currentValue) option.selected = true;
      select.appendChild(option);
    });

    select.addEventListener('change', () => {
      record[fieldKey] = select.value;
      renderResultTable();
    });
    select.addEventListener('blur', () => renderResultTable());

    td.innerHTML = '';
    td.appendChild(select);
    select.focus();
  } else {
    const input = document.createElement('input');
    input.className = 'cell-input';
    input.type = fieldType === 'number' ? 'number' : 'text';
    input.step = 'any';
    input.value = currentValue ?? '';

    const commit = () => {
      let newVal = input.value.trim();
      if (fieldType === 'number') {
        newVal = newVal === '' ? null : parseFloat(newVal);
      }
      record[fieldKey] = newVal;
      renderResultTable();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') renderResultTable();
    });
    input.addEventListener('blur', commit);

    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    input.select();
  }
}

// ============================================
// Staging List
// ============================================
function handleAddToList() {
  if (parsedRecords.length === 0) return;

  // Validate required fields
  const record = parsedRecords[currentRecordIndex];
  const missing = FIELDS.filter(f => f.required && (record[f.key] === null || record[f.key] === undefined || record[f.key] === ''));

  if (missing.length > 0) {
    showToast(`必填欄位尚未填入: ${missing.map(f => f.label).join(', ')}`, 'error');
    return;
  }

  // Add to staging
  stagingList.push({
    type: selectedComponentType,
    record: { ...record }
  });

  // If multi-component, move to next or remove current
  if (parsedRecords.length > 1) {
    parsedRecords.splice(currentRecordIndex, 1);
    if (currentRecordIndex >= parsedRecords.length) currentRecordIndex = Math.max(0, parsedRecords.length - 1);
    if (parsedRecords.length === 0) {
      document.getElementById('resultTableWrap').innerHTML = '<p class="placeholder-text">所有元件已加入暫存清單</p>';
      document.getElementById('addToListBtn').disabled = true;
      document.getElementById('multiDetect').style.display = 'none';
    } else {
      document.getElementById('multiDetect').textContent = `剩餘 ${parsedRecords.length} 個元件`;
      renderResultTable();
    }
  } else {
    document.getElementById('resultTableWrap').innerHTML = '<p class="placeholder-text">已加入暫存清單</p>';
    document.getElementById('addToListBtn').disabled = true;
    parsedRecords = [];
  }

  updateStagingCounts();
  showToast(`已加入: ${record.Component}`, 'success');
}

function removeStagingItem(index) {
  const removed = stagingList.splice(index, 1)[0];
  updateStagingCounts();
  showToast(`已移除: ${removed.record.Component}`, 'info');
}

// ============================================
// Firebase Write
// ============================================
async function handleWriteFirebase() {
  if (stagingList.length === 0) {
    showToast('暫存清單為空', 'warning');
    return;
  }

  const writeLibrary = document.getElementById('writeLibrary').checked;
  const writeProject = document.getElementById('writeProject').checked;

  if (!writeLibrary && !writeProject) {
    showToast('請至少勾選一個寫入目標', 'warning');
    return;
  }

  if (writeProject && !selectedProjectId) {
    showToast('請先選擇專案', 'warning');
    return;
  }

  if (!firebaseReady) {
    showToast('Firebase 未連線', 'error');
    return;
  }

  showLoading('寫入 Firebase 中...');

  try {
    const results = await batchWrite(stagingList, selectedProjectId, { writeLibrary, writeProject });

    // Show log
    const logEl = document.getElementById('writeLog');
    logEl.style.display = '';
    logEl.innerHTML = '';

    let successCount = 0;
    let failCount = 0;

    results.forEach(r => {
      if (r.success) {
        successCount++;
        r.logs.forEach(l => {
          logEl.innerHTML += `<div class="log-success">✓ ${r.component} → ${l.target}</div>`;
        });
      } else {
        failCount++;
        logEl.innerHTML += `<div class="log-error">✗ ${r.component}: ${r.error}</div>`;
      }
    });

    if (failCount === 0) {
      showToast(`全部寫入成功 (${successCount} 筆)`, 'success');
      stagingList = [];
      updateStagingCounts();
    } else {
      showToast(`${successCount} 筆成功，${failCount} 筆失敗`, 'warning');
    }
  } catch (err) {
    showToast(`寫入失敗: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// ============================================
// Project Management
// ============================================
async function loadProjects() {
  if (!firebaseReady) return;

  try {
    const projects = await fetchProjects();
    const select = document.getElementById('projectSelect');
    select.innerHTML = '<option value="">— 選擇專案 —</option>';
    projects.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.project_name || p.id;
      select.appendChild(option);
    });
  } catch (err) {
    console.error('Failed to load projects:', err);
    showToast('無法載入專案清單', 'error');
  }
}

function handleNewProject() {
  const form = document.getElementById('newProjectForm');
  form.style.display = form.style.display === 'none' ? '' : 'none';
}

function hideNewProjectForm() {
  document.getElementById('newProjectForm').style.display = 'none';
}

async function handleCreateProject() {
  const id = document.getElementById('newProjectId').value.trim();
  const name = document.getElementById('newProjectName').value.trim();

  if (!id) { showToast('請輸入專案 ID', 'warning'); return; }
  if (!name) { showToast('請輸入專案名稱', 'warning'); return; }
  if (!firebaseReady) { showToast('Firebase 未連線', 'error'); return; }

  try {
    await createProject(id, name);
    showToast(`專案已建立: ${name}`, 'success');
    hideNewProjectForm();
    document.getElementById('newProjectId').value = '';
    document.getElementById('newProjectName').value = '';
    await loadProjects();
    document.getElementById('projectSelect').value = id;
    selectedProjectId = id;
    updateWriteTargets();
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// ============================================
// AI Connection Test
// ============================================
async function handleTestConnection() {
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) { showToast('請輸入 API Key', 'warning'); return; }

  // Save key
  sessionStorage.setItem(`apiKey_${currentProvider}`, apiKey);

  const statusEl = document.getElementById('aiStatus');
  const dot = statusEl.querySelector('.status-dot');
  dot.className = 'status-dot testing';

  const btn = document.getElementById('testConnectionBtn');
  btn.disabled = true;
  btn.textContent = '測試中...';

  try {
    const ok = await testAIConnection(currentProvider, apiKey);
    if (ok) {
      dot.className = 'status-dot online';
      showToast(`${AI_PROVIDERS[currentProvider].name} 連線成功`, 'success');
    } else {
      dot.className = 'status-dot offline';
      showToast('連線測試失敗，請檢查 API Key', 'error');
    }
  } catch (err) {
    dot.className = 'status-dot offline';
    showToast(`連線失敗: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '測試連線';
  }
}

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================
// Loading Overlay
// ============================================
function showLoading(text) {
  document.getElementById('loadingText').textContent = text || '處理中...';
  document.getElementById('loadingOverlay').style.display = '';
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}
