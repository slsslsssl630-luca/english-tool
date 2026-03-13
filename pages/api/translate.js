export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'invalid input' });

  try {
    // Split into natural phrases by punctuation, then chunk long ones
    const rawPhrases = text
      .split(/(?<=[.!?,;:])\s+|\n+/)
      .map(s => s.trim())
      .filter(Boolean);

    const phrases = [];
    for (const ph of rawPhrases) {
      const words = ph.split(/\s+/);
      if (words.length <= 10) {
        phrases.push(ph);
      } else {
        for (let i = 0; i < words.length; i += 8) {
          phrases.push(words.slice(i, i + 8).join(' '));
        }
      }
    }

    // Translate each phrase via MyMemory
    const segments = await Promise.all(
      phrases.map(async (phrase) => {
        try {
          const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(phrase)}&langpair=en|zh`;
          const r = await fetch(url);
          const data = await r.json();
          const zh = data.responseData?.translatedText || phrase;
          return { en: [phrase], zh: [zh] };
        } catch {
          return { en: [phrase], zh: [phrase] };
        }
      })
    );

    return res.status(200).json({ segments });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
