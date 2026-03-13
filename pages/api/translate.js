// Translate via Google Translate (no API key needed)
async function googleTranslate(text, to = 'zh-CN') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Google Translate ${r.status}`);
  const data = await r.json();
  return data[0].map(item => item[0]).join('');
}

// Split into small word groups (1-3 words) for hover alignment
function tokenize(text) {
  const words = text.match(/[a-zA-Z'''\-]+|[^\w\s]+/g) || [];
  const groups = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (/^[^\w]+$/.test(w)) { i++; continue; } // skip punct
    // Try to group 2-3 words as a natural chunk
    if (i + 1 < words.length && /^[a-zA-Z]/.test(words[i+1]) && Math.random() > 0.4) {
      groups.push(w + ' ' + words[i+1]);
      i += 2;
    } else {
      groups.push(w);
      i++;
    }
  }
  return groups;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'invalid input' });

  try {
    // 1. Full text translation for natural Chinese paragraph
    const fullZh = await googleTranslate(text);

    // 2. Word-group level for hover
    const groups = tokenize(text);
    const segTranslations = await Promise.all(
      groups.map(async (g) => {
        try {
          const zh = await googleTranslate(g);
          return { en: [g], zh: [zh] };
        } catch {
          return { en: [g], zh: [g] };
        }
      })
    );

    return res.status(200).json({ fullZh, segments: segTranslations });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
