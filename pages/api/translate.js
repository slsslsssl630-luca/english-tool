// Google Translate for word-group alignment (hover highlight only)
async function googleTranslate(text, to = 'zh-CN') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) return text;
  const data = await r.json();
  return data[0].map(item => item[0]).join('');
}

// Split into word groups (1-3 words) for hover alignment
function toWordGroups(text) {
  const words = text.match(/[a-zA-Z'''\-]+/g) || [];
  const groups = [];
  let i = 0;
  while (i < words.length) {
    // Group 2 words together ~50% of the time for more natural chunks
    if (i + 1 < words.length && /^[a-z]/.test(words[i+1])) {
      groups.push(words[i] + ' ' + words[i+1]);
      i += 2;
    } else {
      groups.push(words[i]);
      i++;
    }
  }
  return groups;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'invalid input' });

  const apiKey = process.env.BAIDU_LLM_KEY;

  try {
    // 1. Full translation: use Baidu LLM if key available, else Google
    let fullZh = '';
    if (apiKey) {
      try {
        const r = await fetch('https://aip.baidubce.com/rpc/2.0/mt/texttrans/v1', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({ q: text, from: 'en', to: 'zh' })
        });
        const data = await r.json();
        if (data.result?.trans_result?.[0]?.dst) {
          fullZh = data.result.trans_result.map(item => item.dst).join('');
        } else {
          throw new Error(JSON.stringify(data));
        }
      } catch(e) {
        console.error('Baidu LLM failed:', e.message);
        // fallback to Google for full translation
        fullZh = await googleTranslate(text);
      }
    } else {
      fullZh = await googleTranslate(text);
    }

    // 2. Word-group level alignment via Google (for hover)
    const groups = toWordGroups(text);
    const segments = await Promise.all(
      groups.map(async (g) => {
        const zh = await googleTranslate(g);
        return { en: [g], zh: [zh] };
      })
    );

    return res.status(200).json({ fullZh, segments });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
