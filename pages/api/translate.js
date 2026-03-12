export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { words } = req.body;
  if (!words || !Array.isArray(words)) return res.status(400).json({ error: 'invalid input' });

  const apiKey = process.env.BAIDU_LLM_KEY;
  if (!apiKey) return res.status(500).json({ error: '服务器未配置翻译 API' });

  try {
    const prompt = `请将以下英文单词或短语逐一翻译成中文，每行一个，保持顺序，只输出中文翻译，不要任何解释：\n${words.join('\n')}`;

    const r = await fetch('https://qianfan.baidubce.com/v2/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'ernie-4.5-8k',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1
      })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || '翻译请求失败');

    const text = data.choices?.[0]?.message?.content || '';
    const translations = text.trim().split('\n').map(s => s.trim()).filter(Boolean);

    while (translations.length < words.length) translations.push('—');

    return res.status(200).json({ translations: translations.slice(0, words.length) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
