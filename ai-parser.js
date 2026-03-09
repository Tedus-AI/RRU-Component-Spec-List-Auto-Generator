/* ============================================
   AI Parser — Multi-Provider Support
   預設 Google Gemini (免費)
   ============================================ */

// ---- Provider Definitions ----
const AI_PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    model: 'gemini-2.5-flash',
    free: true,
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    call: async (apiKey, systemPrompt, userContent) => {
      const parts = typeof userContent === 'string'
        ? [{ text: userContent }]
        : userContent;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
          })
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Gemini API error');
      return data.candidates[0].content.parts[0].text;
    }
  },

  openrouter: {
    name: 'OpenRouter',
    model: 'google/gemma-3n-e4b-it:free',
    free: true,
    getKeyUrl: 'https://openrouter.ai/keys',
    call: async (apiKey, systemPrompt, userContent, modelOverride) => {
      const model = modelOverride || sessionStorage.getItem('openrouter_model') || 'google/gemma-3n-e4b-it:free';
      const content = typeof userContent === 'string'
        ? userContent
        : userContent;

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
          max_tokens: 2000,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content }
          ]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'OpenRouter API error');
      return data.choices[0].message.content;
    }
  },

  groq: {
    name: 'Groq',
    model: 'llama-3.3-70b-versatile',
    free: true,
    getKeyUrl: 'https://console.groq.com/keys',
    call: async (apiKey, systemPrompt, userContent) => {
      const content = typeof userContent === 'string' ? userContent : JSON.stringify(userContent);

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 2000,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content }
          ]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Groq API error');
      return data.choices[0].message.content;
    }
  },

  anthropic: {
    name: 'Anthropic Claude',
    model: 'claude-sonnet-4-20250514',
    free: false,
    getKeyUrl: 'https://console.anthropic.com/',
    call: async (apiKey, systemPrompt, userContent) => {
      const content = typeof userContent === 'string'
        ? [{ type: 'text', text: userContent }]
        : userContent;

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
          max_tokens: 2000,
          system: systemPrompt,
          messages: [{ role: 'user', content }]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Claude API error');
      return data.content[0].text;
    }
  }
};

// ---- Current State ----
let currentProvider = 'gemini';

// ---- System Prompt Builder ----
function buildSystemPrompt(componentType) {
  return `你是一位熱流工程助理，專門從半導體元件 datasheet 抽取熱參數。

元件類型：${componentType}

請從以下 datasheet 內容抽取熱參數，回傳 JSON。

規則：
1. Power(W)：若有多個工作模式，取最大值
2. Limit(C)：RF 類取 Max Tj，PWR/Digital 類取 Max Tc 或 Max Tj
3. R_jc：尋找 Theta_JC 或 Junction-to-Case thermal resistance
4. Pad_L / Pad_W：封裝底部接觸面尺寸（mm）
5. 找不到的欄位填 null，絕對不要猜測或捏造數值
6. 若偵測到多個獨立元件（如 PA + Driver），回傳 JSON 陣列
7. 只回傳 JSON，不加任何說明文字

單一元件回傳格式：
{
  "Component": "string or null",
  "Qty": 1,
  "Power(W)": "number or null",
  "Height(mm)": "number or null",
  "Pad_L": "number or null",
  "Pad_W": "number or null",
  "Thick(mm)": null,
  "Board_Type": null,
  "Limit(C)": "number or null",
  "R_jc": "number or null",
  "TIM_Type": null
}

多元件回傳格式（JSON 陣列）：
[{ ... }, { ... }]`;
}

// ---- Image Content Builder ----
function buildImageContent(base64Data, mimeType, extraText) {
  const text = extraText || '請從此 datasheet 截圖中抽取元件熱參數。';

  if (currentProvider === 'gemini') {
    return [
      { inlineData: { mimeType, data: base64Data } },
      { text }
    ];
  }
  if (currentProvider === 'anthropic') {
    return [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
      { type: 'text', text }
    ];
  }
  // OpenRouter / Groq (OpenAI format)
  return [
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
    { type: 'text', text }
  ];
}

// ---- PDF Content Builder ----
function buildPdfContent(base64Data, extraText) {
  const text = extraText || '請從此 datasheet PDF 中抽取元件熱參數。';

  if (currentProvider === 'gemini') {
    return [
      { inlineData: { mimeType: 'application/pdf', data: base64Data } },
      { text }
    ];
  }
  if (currentProvider === 'anthropic') {
    return [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
      { type: 'text', text }
    ];
  }
  // OpenRouter / Groq — PDF not well supported, fallback to text prompt
  return text + '\n\n[PDF content — 此 Provider 不支援直接 PDF 解析，請改用文字或截圖輸入]';
}

// ---- Unified Call ----
async function callAI(userContent, componentType) {
  const provider = AI_PROVIDERS[currentProvider];
  const apiKey = sessionStorage.getItem(`apiKey_${currentProvider}`);
  if (!apiKey) throw new Error('請先輸入 API Key');

  const systemPrompt = buildSystemPrompt(componentType);
  const modelOverride = currentProvider === 'openrouter'
    ? (sessionStorage.getItem('openrouter_model') || undefined)
    : undefined;

  const rawText = await provider.call(apiKey, systemPrompt, userContent, modelOverride);

  // Parse JSON (strip markdown code fences if present)
  const cleaned = rawText.replace(/```json\s*|```\s*/g, '').trim();
  const parsed = JSON.parse(cleaned);

  // Normalize to array
  return Array.isArray(parsed) ? parsed : [parsed];
}

// ---- Connection Test ----
async function testAIConnection(provider, apiKey) {
  try {
    const result = await AI_PROVIDERS[provider].call(
      apiKey,
      '你是助理，請直接回應。',
      '請回覆 {"status":"ok"}'
    );
    const parsed = JSON.parse(result.replace(/```json|```/g, '').trim());
    return parsed.status === 'ok';
  } catch (e) {
    console.error('AI connection test failed:', e);
    return false;
  }
}
