export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'invalid input' });

  const apiKey = process.env.BAIDU_LLM_KEY;
  if (!apiKey) return res.status(500).json({ error: '服务器未配置翻译 API' });

  const systemPrompt = `你是专业的英译中翻译引擎。用户输入英文，你需要：
1. 输出整段自然流畅的中文翻译（fullZh字段）
2. 同时输出词组级别的对照数据，用于hover高亮（segments字段）

严格按如下JSON格式输出，不要任何解释或markdown：
{"fullZh":"整段自然中文翻译","segments":[{"en":"英文词组","zh":"对应中文"},...]}`; 

  try {
    const r = await fetch('https://qianfan.baidubce.com/v2/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'ernie-4.5-8k',
        messages: [
          { role: 'user', content: `${systemPrompt}\n\n请翻译以下英文：\n${text}` }
        ],
        temperature: 0.1,
        max_output_tokens: 2000
      })
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || `API错误 ${r.status}`);

    const raw = data.choices?.[0]?.message?.content || '';
    // Strip markdown fences if present
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({
      fullZh: parsed.fullZh,
      segments: parsed.segments.map((s, i) => ({ id: i, en: [s.en], zh: [s.zh] }))
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
