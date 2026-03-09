# SPEC — 元件規格清單產生器
# Component Spec Auto-Fill Generator

**版本**: v1.0  
**日期**: 2025-03  
**對接工具**: 5G-RRU-Quick-Volume-Evaluation-Tool v4.30  
**部署目標**: GitHub Pages（純前端，無後端伺服器）

---

## 1. 工具定位與目標

### 1.1 解決的問題
使用者目前需要手動翻閱 datasheet，將元件熱參數逐欄填入 Volume-Evaluation-Tool 的元件清單。此工具透過 AI 自動解析 datasheet，減少手動填寫時間，並直接將結果寫入 Firebase，讓 Volume-Evaluation-Tool 可直接讀取。

### 1.2 核心流程
```
輸入 datasheet (PDF / 截圖 / 文字)
    ↓
Claude API 自動抽取元件熱參數
    ↓
使用者在表格中確認 / 修改
    ↓
按下「確認寫入」
    ↓
同時寫入 Firebase：
  ├── rf_library / digital_library / pwr_library (元件資料庫)
  └── projects/{project_id}/rf_data|digital_data|pwr_data (專案清單)
```

---

## 2. Firebase 資料結構

### 2.1 沿用 Volume-Evaluation-Tool 的現有結構（不新增 collection）

```
Firebase Firestore
├── rf_library/
│   └── {doc_id}        ← ComponentRecord
├── digital_library/
│   └── {doc_id}        ← ComponentRecord
├── pwr_library/
│   └── {doc_id}        ← ComponentRecord
└── projects/
    └── {project_id}/
        ├── meta
        ├── global_params
        ├── rf_data[]       ← ComponentRecord[]
        ├── digital_data[]  ← ComponentRecord[]
        └── pwr_data[]      ← ComponentRecord[]
```

### 2.2 doc_id 規則（與 Volume-Evaluation-Tool 一致）
```javascript
doc_id = component_name
  .replace(/ /g, '_')
  .replace(/\//g, '-')
  .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '')
```

---

## 3. ComponentRecord Schema（三類共用）

來源：Volume-Evaluation-Tool v4.30 JSON Schema

```json
{
  "Component":   "string   — 元件型號或代號，例如 PA_GaN_28",
  "Qty":         "integer  — 元件數量，最小值 1",
  "Power(W)":    "number   — 單顆元件功耗（W），取最大工作模式",
  "Height(mm)":  "number   — 元件安裝高度，距 PCB 底面（mm）",
  "Pad_L":       "number   — E-PAD 或封裝底部長度（mm）",
  "Pad_W":       "number   — E-PAD 或封裝底部寬度（mm）",
  "Thick(mm)":   "number   — PCB 厚度或 Copper Coin 厚度（mm）",
  "Board_Type":  "enum     — Thermal Via | Copper Coin | None",
  "Limit(C)":    "number   — 元件最高允許溫度（°C）",
  "R_jc":        "number   — Junction-to-Case 熱阻（°C/W）",
  "TIM_Type":    "enum     — Grease | Pad | Pad2 | Putty | None"
}
```

### 3.1 三類元件預設值

| 欄位 | RF 預設 | Digital 預設 | PWR 預設 |
|------|---------|-------------|---------|
| Height(mm) | 250 | 50 | 30 |
| Pad_L / Pad_W | 10 / 10 | 10 / 10 | 20 / 20 |
| Thick(mm) | 2.5 | 0 | 0 |
| Board_Type | Copper Coin | Thermal Via | None |
| Limit(C) | 200 | 100 | 95 |
| R_jc | 1.5 | 0.5 | 0 |
| TIM_Type | Grease | Putty | Grease |

---

## 4. AI 解析規格

### 4.1 各欄位 AI 可信度

| 欄位 | AI 自動填 | 說明 |
|------|----------|------|
| Component | ✅ | 型號名稱 |
| Qty | ✅ | 通常預設 1，使用者修改 |
| Power(W) | ✅ | 取 datasheet 最大功耗模式 |
| Limit(C) | ✅ | Max Tj 或 Max Tc |
| R_jc | ✅ | Theta_JC，單位 °C/W |
| Pad_L / Pad_W | ✅ | 封裝底面尺寸 |
| Height(mm) | ⚠️ | AI 嘗試填，使用者必須確認 |
| Thick(mm) | ❌ | 預設值，使用者手動填 |
| Board_Type | ❌ | 套用類型預設值，使用者確認 |
| TIM_Type | ❌ | 套用類型預設值，使用者確認 |

### 4.2 Claude API Prompt 設計

```
System:
你是一位熱流工程助理，專門從半導體元件 datasheet 抽取熱參數。

User:
元件類型：{RF | Digital | PWR}

請從以下 datasheet 內容抽取熱參數，回傳 JSON。

規則：
1. Power(W)：若有多個工作模式，取最大值
2. Limit(C)：RF 類取 Max Tj，PWR/Digital 類取 Max Tc 或 Max Tj
3. R_jc：尋找 Theta_JC 或 Junction-to-Case thermal resistance
4. Pad_L / Pad_W：封裝底部接觸面尺寸（mm）
5. 找不到的欄位填 null，絕對不要猜測或捏造數值
6. 只回傳 JSON，不加任何說明文字

回傳格式（JSON only）：
{
  "Component": "string or null",
  "Qty": 1,
  "Power(W)": number or null,
  "Height(mm)": number or null,
  "Pad_L": number or null,
  "Pad_W": number or null,
  "Thick(mm)": null,
  "Board_Type": null,
  "Limit(C)": number or null,
  "R_jc": number or null,
  "TIM_Type": null
}

Datasheet 內容：
{user_input}
```

### 4.3 多元件判斷
- 若解析結果含多個元件（例如 PA + Driver PA），分別建立多筆 record
- UI 需顯示「偵測到 N 個元件，請分別確認」

---

## 5. UI 頁面設計

### 5.1 整體佈局（單頁）

```
┌─────────────────────────────────────────────────┐
│  🔥 元件規格清單產生器                            │
│  Connect to: [Firebase Project ID]               │
├─────────────────────────────────────────────────┤
│  STEP 1：選擇專案                                │
│  專案：[ 下拉選單，從 Firebase 讀取 ▼ ]           │
│         [ + 新增專案 ]                           │
├─────────────────────────────────────────────────┤
│  STEP 2：元件類型                               │
│  [ RF Component ] [ Digital Component ] [ PWR ] │
├─────────────────────────────────────────────────┤
│  STEP 3：輸入 Datasheet                         │
│  [ 📄 上傳 PDF ] [ 🖼 貼上截圖 ] [ 📝 貼上文字 ] │
│  ┌──────────────────────────────┐               │
│  │ (貼上區域 / 檔案預覽)         │               │
│  └──────────────────────────────┘               │
│  [ 🤖 AI 解析 ]                                 │
├─────────────────────────────────────────────────┤
│  STEP 4：確認解析結果                            │
│  ┌────────────────────────────────────────────┐ │
│  │ 欄位     │ AI 解析值  │ 狀態               │ │
│  │ Component│ PA_GaN_28 │ ✅                  │ │
│  │ Power(W) │ 52.99     │ ✅                  │ │
│  │ Height   │ 250       │ ⚠️ 請確認           │ │
│  │ Board_Type│ (預設值)  │ ✏️ 請手動選擇       │ │
│  │ ...      │ ...       │ ...                 │ │
│  └────────────────────────────────────────────┘ │
│  所有欄位可直接點擊編輯                           │
├─────────────────────────────────────────────────┤
│  STEP 5：加入暫存清單                            │
│  [ ➕ 加入清單 ]                                 │
│                                                 │
│  📦 目前暫存（RF: 2筆 / Digital: 0筆）           │
│  [展開預覽清單]                                  │
├─────────────────────────────────────────────────┤
│  STEP 6：寫入 Firebase                          │
│  寫入目標：                                     │
│  ☑ rf_library（元件資料庫）                      │
│  ☑ projects/{id}/rf_data（此專案清單）            │
│                                                 │
│  [ ✅ 確認全部寫入 Firebase ]                    │
└─────────────────────────────────────────────────┘
```

### 5.2 表格狀態標示規則

| 狀態 | 圖示 | 說明 |
|------|------|------|
| AI 有填值且可信 | ✅ | 可直接使用 |
| AI 有填但需確認 | ⚠️ | Height(mm) 等 |
| AI 無法判斷 | ✏️ | 套預設值，需人工確認 |
| AI 填 null | 🔴 | 必填欄位，阻擋寫入 |

---

## 6. Firebase 寫入邏輯

### 6.1 寫入 library（新增或覆蓋）
```javascript
// 集合名稱依元件類型
const collectionName = {
  RF: 'rf_library',
  Digital: 'digital_library',
  PWR: 'pwr_library'
}[componentType]

await setDoc(doc(db, collectionName, docId), componentRecord)
```

### 6.2 寫入 projects（Append，不覆蓋）
```javascript
const fieldName = {
  RF: 'rf_data',
  Digital: 'digital_data',
  PWR: 'pwr_data'
}[componentType]

await updateDoc(doc(db, 'projects', projectId), {
  [fieldName]: arrayUnion(componentRecord)
})
```

### 6.3 新增專案（若不存在）
```javascript
await setDoc(doc(db, 'projects', projectId), {
  project_name: projectName,
  meta: { version: 'v4.30', timestamp: new Date().toISOString() },
  rf_data: [],
  digital_data: [],
  pwr_data: []
})
```

---

## 7. 技術架構

### 7.1 技術棧
- **前端**: 純 HTML + Vanilla JavaScript（或 React，依開發習慣）
- **AI**: 多 Provider 支援（預設 Google Gemini，免費）
- **資料庫**: Firebase Firestore（沿用 Volume-Evaluation-Tool 同一個 Firebase project）
- **部署**: GitHub Pages

### 7.2 檔案結構
```
component-spec-generator/
├── index.html
├── style.css
├── app.js
├── firebase-config.js    ← Firebase 設定（與 Volume-Evaluation-Tool 相同）
├── ai-parser.js          ← 多 Provider AI 呼叫與 prompt 管理
├── firebase-writer.js    ← Firestore 讀寫邏輯
└── README.md
```

---

### 7.3 AI Provider 設定（多 Provider，預設 Gemini）

直接沿用 tool-spec-form 的 Provider 架構，4 個 Provider 完全一致：

| Provider ID | 顯示名稱 | 預設模型 | 費用 | 取得 Key |
|-------------|---------|---------|------|---------|
| `gemini` ⭐ | Google Gemini | gemini-2.5-flash | **免費** | aistudio.google.com/apikey |
| `openrouter` | OpenRouter | google/gemma-3n-e4b-it:free | **免費額度** | openrouter.ai/keys |
| `groq` | Groq | llama-3.3-70b-versatile | **免費** | console.groq.com |
| `anthropic` | Anthropic Claude | claude-sonnet-4-20250514 | 付費 | console.anthropic.com |

#### OpenRouter 可選模型清單（與 tool-spec-form 完全一致）
```
google/gemma-3n-e4b-it:free          ← 預設，穩定
nvidia/nemotron-nano-9b-v2:free
stepfun/step-3.5-flash:free
meta-llama/llama-3.3-70b-instruct:free
openrouter/free                      ← 自動選擇最佳免費模型
```
> 若選擇的模型被限流，自動嘗試其他免費模型

#### API Key 儲存 Key 名稱（sessionStorage）
```javascript
// 與 tool-spec-form 一致的命名規則
sessionStorage.getItem('apiKey_gemini')
sessionStorage.getItem('apiKey_openrouter')
sessionStorage.getItem('apiKey_groq')
sessionStorage.getItem('apiKey_anthropic')   // 注意：非 'claude'
```

---

### 7.4 各 Provider API 呼叫實作

#### Provider 設定物件
```javascript
const AI_PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    model: 'gemini-2.5-flash',
    free: true,
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    call: async (apiKey, systemPrompt, userContent) => {
      // userContent 可為文字或含圖片的 parts 陣列
      const parts = typeof userContent === 'string'
        ? [{ text: userContent }]
        : userContent

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1000 }
          })
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Gemini API error')
      return data.candidates[0].content.parts[0].text
    }
  },

  openrouter: {
    name: 'OpenRouter',
    model: 'google/gemma-3n-e4b-it:free',  // 預設，與 tool-spec-form 一致
    free: true,
    getKeyUrl: 'https://openrouter.ai/keys',
    call: async (apiKey, systemPrompt, userContent, modelOverride) => {
      const model = modelOverride || sessionStorage.getItem('openrouter_model') || 'google/gemma-3n-e4b-it:free'
      const content = typeof userContent === 'string'
        ? userContent
        : userContent

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Component Spec Generator'
        },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content }
          ]
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'OpenRouter API error')
      return data.choices[0].message.content
    }
  },

  groq: {
    name: 'Groq',
    model: 'llama-3.3-70b-versatile',
    free: true,
    getKeyUrl: 'https://console.groq.com/keys',
    call: async (apiKey, systemPrompt, userContent) => {
      const content = typeof userContent === 'string' ? userContent : JSON.stringify(userContent)

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1000,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content }
          ]
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Groq API error')
      return data.choices[0].message.content
    }
  },

  anthropic: {
    name: 'Anthropic Claude',
    model: 'claude-sonnet-4-20250514',
    free: false,
    getKeyUrl: 'https://console.anthropic.com/',
    call: async (apiKey, systemPrompt, userContent) => {
      // userContent: string 或 Claude messages content 陣列（含圖片）
      const content = typeof userContent === 'string'
        ? [{ type: 'text', text: userContent }]
        : userContent

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages: [{ role: 'user', content }]
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error?.message || 'Claude API error')
      return data.content[0].text
    }
  }
}
```

#### 統一呼叫介面
```javascript
// 預設 provider（與 tool-spec-form 一致）
let currentProvider = 'gemini'
let currentOpenRouterModel = 'google/gemma-3n-e4b-it:free'

async function callAI(userContent) {
  const provider = AI_PROVIDERS[currentProvider]
  const apiKey = sessionStorage.getItem(`apiKey_${currentProvider}`)
  if (!apiKey) throw new Error('請先輸入 API Key')

  const systemPrompt = buildSystemPrompt()  // 見第 4.2 節
  const rawText = await provider.call(apiKey, systemPrompt, userContent)

  // 解析 JSON（去除可能的 markdown code fence）
  const cleaned = rawText.replace(/```json|```/g, '').trim()
  return JSON.parse(cleaned)
}
```

---

### 7.5 圖片輸入格式（各 Provider 差異）

截圖貼上後轉 base64，依 Provider 格式包裝：

```javascript
function buildImageContent(base64Data, mimeType = 'image/png') {
  if (currentProvider === 'gemini') {
    return [
      { inlineData: { mimeType, data: base64Data } },
      { text: '請從此 datasheet 截圖中抽取元件熱參數。' }
    ]
  }
  if (currentProvider === 'anthropic') {
    return [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
      { type: 'text', text: '請從此 datasheet 截圖中抽取元件熱參數。' }
    ]
  }
  // OpenRouter / Groq（OpenAI 格式）
  return [
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
    { type: 'text', text: '請從此 datasheet 截圖中抽取元件熱參數。' }
  ]
}
```

---

### 7.6 API Key 處理
- 頁面頂端提供 Provider 選擇 + API Key 輸入欄（參考 tool-spec-form UI）
- 存於 `sessionStorage`（關閉分頁即清除，不長期存儲）
- Key 格式：`apiKey_gemini` / `apiKey_openrouter` / `apiKey_groq` / `apiKey_claude`
- 不寫入 Firebase，不上傳任何地方

#### 連線測試邏輯
```javascript
async function testConnection(provider, apiKey) {
  try {
    const result = await AI_PROVIDERS[provider].call(
      apiKey,
      '你是助理，請直接回應。',
      '請回覆 {"status":"ok"}'
    )
    const parsed = JSON.parse(result.replace(/```json|```/g, '').trim())
    return parsed.status === 'ok'
  } catch (e) {
    return false
  }
}
```

---

## 8. 輸入方式實作細節

### 8.1 上傳 PDF
- 使用 `FileReader` 讀取為 base64
- 傳入 Claude API 的 `document` 類型 content block

### 8.2 貼上截圖
- 監聽 `paste` 事件，抓取 `clipboardData.items` 中的 image
- 轉為 base64 後傳入 Claude API 的 `image` 類型 content block

### 8.3 貼上文字
- `<textarea>` 直接輸入或貼上
- 傳入 Claude API 的 `text` 類型 content block

---

## 9. 開發優先順序

| Phase | 內容 | 完成條件 |
|-------|------|---------|
| P1 | Firebase 讀寫骨架 + 手動填表 + 寫入按鈕 | 不依賴 AI，可正常寫入 Firebase |
| P2 | Claude API 串接（文字輸入 → 解析） | 貼文字可自動填表 |
| P3 | 截圖輸入支援 | 貼截圖可解析 |
| P4 | PDF 上傳支援 | 上傳 PDF 可解析 |
| P5 | 多元件批次處理 | 一次解析多個元件 |

---

## 10. 與 Volume-Evaluation-Tool 的串接方式

此工具完成後，Volume-Evaluation-Tool 只需做**最小改動**：

```
在元件清單 Tab 加入：
[ 📥 從 Firebase 載入專案元件 ]

點擊後：
1. 列出 Firebase 中的專案清單
2. 選擇專案後，讀取 rf_data / digital_data / pwr_data
3. 載入到現有的元件清單表格
```

Volume-Evaluation-Tool 的核心計算邏輯**完全不需修改**。

---

## 11. 驗收標準

- [ ] 可從 Firebase 讀取現有專案清單並顯示於下拉選單
- [ ] 貼上 datasheet 文字後，AI 可正確填入至少 Component / Power(W) / Limit(C) / R_jc
- [ ] null 欄位有明確紅色警示，阻擋寫入
- [ ] 點擊「確認寫入」後，資料正確出現在 Firebase rf_library 與 projects/{id}/rf_data
- [ ] Volume-Evaluation-Tool 讀取後，計算結果與手動填入一致
- [ ] 所有操作不需後端伺服器，GitHub Pages 直接可用