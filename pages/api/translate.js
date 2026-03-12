import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { words } = req.body;
  if (!words || !Array.isArray(words)) return res.status(400).json({ error: 'invalid input' });

  const appId = process.env.BAIDU_APP_ID;
  const key   = process.env.BAIDU_KEY;

  if (!appId || !key) {
    return res.status(500).json({ error: '服务器未配置翻译 API，请联系管理员' });
  }

  try {
    // Translate all words in one batch request (join with \n, Baidu supports it)
    const query = words.join('\n');
    const salt  = Date.now().toString();
    const sign  = crypto.createHash('md5').update(appId + query + salt + key).digest('hex');

    const params = new URLSearchParams({ q: query, from: 'en', to: 'zh', appid: appId, salt, sign });
    const r = await fetch(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params}`);
    const data = await r.json();

    if (data.error_code) {
      return res.status(400).json({ error: `百度翻译错误 ${data.error_code}: ${data.error_msg}` });
    }

    // data.trans_result is array of {src, dst} in same order as input lines
    const translations = data.trans_result.map(item => item.dst);
    return res.status(200).json({ translations });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
