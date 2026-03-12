export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { words } = req.body;
  if (!words || !Array.isArray(words)) return res.status(400).json({ error: 'invalid input' });

  try {
    const translations = await Promise.all(
      words.map(async (word) => {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|zh`;
        const r = await fetch(url);
        const data = await r.json();
        return data.responseData?.translatedText || word;
      })
    );
    return res.status(200).json({ translations });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
