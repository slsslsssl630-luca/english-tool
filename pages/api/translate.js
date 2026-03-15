// Google Translate for word-level alignment (hover only)
async function googleTranslate(text, to = 'zh-CN') {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return text;
    const data = await r.json();
    return data[0].map(item => item[0]).join('');
  } catch {
    return text;
  }
}

// Extract individual words only (no grouping)
function extractWords(text) {
  const words = [];
  const regex = /[a-zA-Z'''\-]+/g;
  let m;
  while ((m = regex.exec(text)) !== null) {
    words.push(m[0]);
  }
  return words;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'invalid input' });

  const apiKey = process.env.BAIDU_LLM_KEY;

  try {
    // 1. Full translation via Baidu LLM (natural, fluent Chinese)
    let fullZh = '';
    if (apiKey) {
      try {
        const r = await fetch('https://fanyi-api.baidu.com/ait/api/aiTextTranslate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            q: text,
            from: 'en',
            to: 'zh',
            model_type: 'llm'
          })
        });
        const data = await r.json();
        if (data.trans_result?.[0]?.dst) {
          fullZh = data.trans_result.map(item => item.dst).join('');
        } else {
          console.error('Baidu LLM error:', JSON.stringify(data));
          fullZh = await googleTranslate(text);
        }
      } catch(e) {
        console.error('Baidu LLM exception:', e.message);
        fullZh = await googleTranslate(text);
      }
    } else {
      fullZh = await googleTranslate(text);
    }

    // 2. Word-level translation via Google (for hover highlight)
    const words = extractWords(text);
    const segments = await Promise.all(
      words.map(async (word) => {
        const zh = await googleTranslate(word);
        return { en: [word], zh: [zh] };
      })
    );

    return res.status(200).json({ fullZh, segments });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
