import crypto from 'crypto';

// ========== 百度翻译 API ==========
async function baiduTranslate(text, from = 'en', to = 'zh') {
  const appId = process.env.BAIDU_APP_ID;
  const secretKey = process.env.BAIDU_SECRET_KEY;

  if (!appId || !secretKey) {
    throw new Error('百度翻译 API 未配置 (需要 BAIDU_APP_ID 和 BAIDU_SECRET_KEY)');
  }

  const salt = Date.now().toString();
  const sign = crypto
    .createHash('md5')
    .update(appId + text + salt + secretKey)
    .digest('hex');

  const params = new URLSearchParams({
    q: text,
    from: from,
    to: to,
    appid: appId,
    salt: salt,
    sign: sign,
  });

  const response = await fetch(
    `https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`
  );

  const data = await response.json();

  if (data.error_code) {
    throw new Error(`百度翻译错误 <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mrow><mi>d</mi><mi>a</mi><mi>t</mi><mi>a</mi><mi mathvariant="normal">.</mi><mi>e</mi><mi>r</mi><mi>r</mi><mi>o</mi><msub><mi>r</mi><mi>c</mi></msub><mi>o</mi><mi>d</mi><mi>e</mi></mrow><mo>:</mo></mrow><annotation encoding="application/x-tex">{data.error_code}:</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="strut" style="height:0.8444em;vertical-align:-0.15em;"></span><span class="mord"><span class="mord mathnormal">d</span><span class="mord mathnormal">a</span><span class="mord mathnormal">t</span><span class="mord mathnormal">a</span><span class="mord">.</span><span class="mord mathnormal">erro</span><span class="mord"><span class="mord mathnormal" style="margin-right:0.02778em;">r</span><span class="msupsub"><span class="vlist-t vlist-t2"><span class="vlist-r"><span class="vlist" style="height:0.1514em;"><span style="top:-2.55em;margin-left:-0.0278em;margin-right:0.05em;"><span class="pstrut" style="height:2.7em;"></span><span class="sizing reset-size6 size3 mtight"><span class="mord mathnormal mtight">c</span></span></span></span><span class="vlist-s">​</span></span><span class="vlist-r"><span class="vlist" style="height:0.15em;"><span></span></span></span></span></span></span><span class="mord mathnormal">o</span><span class="mord mathnormal">d</span><span class="mord mathnormal">e</span></span><span class="mspace" style="margin-right:0.2778em;"></span><span class="mrel">:</span></span></span></span>{data.error_msg}`);
  }

  if (!data.trans_result || !data.trans_result.length) {
    throw new Error('百度翻译返回空结果');
  }

  return data.trans_result.map((item) => item.dst).join('');
}

// ========== 分词（单词维度，不合并）==========
function toWords(text) {
  // 只提取英文单词，每个单词独立
  return text.match(/[a-zA-Z'''\-]+/g) || [];
}

// ========== 批量翻译单词（一次请求翻译多个，用换行分隔）==========
async function translateWords(words) {
  if (words.length === 0) return [];

  // 百度翻译支持用换行符分隔多个词，一次请求翻译
  // 分批处理，每批最多 30 个词，避免请求太大
  const batchSize = 30;
  const segments = [];

  for (let i = 0; i < words.length; i += batchSize) {
    const batch = words.slice(i, i + batchSize);
    const batchText = batch.join('\n');
    
    const zhText = await baiduTranslate(batchText);
    const zhWords = zhText.split('\n');

    for (let j = 0; j < batch.length; j++) {
      segments.push({
        en: [batch[j]],
        zh: [zhWords[j] || batch[j]]
      });
    }

    // 批次间加延迟
    if (i + batchSize < words.length) {
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  return segments;
}

// ========== 主处理函数 ==========
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: '请输入要翻译的文本' });
  }

  try {
    // 1. 全文翻译（整段，通顺）
    const fullZh = await baiduTranslate(text.trim());
    console.log('✅ 百度翻译全文成功');

    // 2. 单词级翻译（hover 高亮用）
    const words = toWords(text);
    const segments = await translateWords(words);

    return res.status(200).json({ 
      fullZh, 
      segments,
      source: '百度翻译'
    });

  } catch (e) {
    console.error('❌ 翻译失败:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
