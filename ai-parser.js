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
            generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
          })
        }
      );
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error?.message || 'Gemini API error';
        if (res.status === 429 || msg.includes('quota') || msg.includes('rate')) {
          throw new Error('Gemini 免費額度已達上限，請等待約 1 分鐘後再試');
        }
        throw new Error(msg);
      }
      // 檢查回應是否被截斷
      const candidate = data.candidates[0];
      if (candidate.finishReason === 'MAX_TOKENS') {
        throw new Error('AI 回應被截斷（內容過長），請減少輸入圖片數量或文字量後重試');
      }
      // Gemini 2.5 思考模型可能回傳多個 parts（thought + response）
      // 取最後一個非 thought 的 text part
      const responseParts = candidate.content.parts;
      const textParts = responseParts.filter(p => p.text && !p.thought);
      return textParts.length > 0 ? textParts[textParts.length - 1].text : responseParts[responseParts.length - 1].text;
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

// ---- Combined Content Builder ----
// 綜合所有有資料的輸入（文字+多張截圖+PDF）一起送給 AI
// images: [{ base64, mimeType }]
function buildCombinedContent(text, images, pdfB64) {
  const hasText = !!text;
  const hasImage = images && images.length > 0;
  const hasPdf = !!pdfB64;

  // 純文字 → 直接回傳字串
  if (hasText && !hasImage && !hasPdf) {
    return text;
  }

  // 建立圖片編號提示（讓 AI 知道圖片順序）
  const imgIntro = hasImage && images.length > 1
    ? `共有 ${images.length} 張截圖（圖1 ~ 圖${images.length}），請依序參考。\n`
    : '';

  // 有圖片或 PDF → 需要多模態格式
  if (currentProvider === 'gemini') {
    const parts = [];
    if (hasImage) {
      images.forEach((img, i) => {
        parts.push({ text: `[圖${i + 1}]` });
        parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
      });
    }
    if (hasPdf) parts.push({ inlineData: { mimeType: 'application/pdf', data: pdfB64 } });
    if (hasText) {
      parts.push({ text: `${imgIntro}以下是使用者的補充說明，請一併參考：\n${text}` });
    } else {
      parts.push({ text: `${imgIntro}請從以上 datasheet 資料中抽取元件熱參數。` });
    }
    return parts;
  }

  if (currentProvider === 'anthropic') {
    const content = [];
    if (hasImage) {
      images.forEach((img, i) => {
        content.push({ type: 'text', text: `[圖${i + 1}]` });
        content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } });
      });
    }
    if (hasPdf) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 } });
    }
    if (hasText) {
      content.push({ type: 'text', text: `${imgIntro}以下是使用者的補充說明，請一併參考：\n${text}` });
    } else {
      content.push({ type: 'text', text: `${imgIntro}請從以上 datasheet 資料中抽取元件熱參數。` });
    }
    return content;
  }

  // OpenRouter / Groq (OpenAI format) — PDF 不支援，僅圖片+文字
  const content = [];
  if (hasImage) {
    images.forEach((img, i) => {
      content.push({ type: 'text', text: `[圖${i + 1}]` });
      content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } });
    });
  }
  let textPart = imgIntro;
  if (hasPdf) textPart += '[PDF content — 此 Provider 不支援直接 PDF 解析，請改用文字或截圖輸入]\n\n';
  if (hasText) {
    textPart += hasImage || hasPdf ? `以下是使用者的補充說明，請一併參考：\n${text}` : text;
  } else {
    textPart += '請從以上 datasheet 資料中抽取元件熱參數。';
  }
  content.push({ type: 'text', text: textPart });

  // 如果只有文字部分（無圖片），直接回傳字串
  if (!hasImage) return textPart;
  return content;
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

  // Parse JSON — 更強健的提取邏輯
  let cleaned = rawText.replace(/```json\s*|```\s*/g, '').trim();
  // 嘗試找到 JSON 的起始位置（[ 或 {）
  const jsonStart = cleaned.search(/[\[{]/);
  if (jsonStart > 0) cleaned = cleaned.slice(jsonStart);
  // 找到最後一個 ] 或 } 作為結尾
  const lastBracket = Math.max(cleaned.lastIndexOf(']'), cleaned.lastIndexOf('}'));
  if (lastBracket > 0) cleaned = cleaned.slice(0, lastBracket + 1);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (jsonErr) {
    console.error('AI raw response:', rawText);
    throw new Error('AI 回傳的 JSON 格式不正確，請重試一次。若持續失敗，可嘗試減少圖片數量。');
  }

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
