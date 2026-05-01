// POST /api/analyze-meal
// Body: { imageBase64: string (no data: prefix), mediaType?: 'image/jpeg' | 'image/png' | 'image/webp' }
// Returns: { name, calories, protein, carbs, fat, confidence }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel env' });
    return;
  }

  const { imageBase64, mediaType = 'image/jpeg' } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    res.status(400).json({ error: 'Missing imageBase64' });
    return;
  }

  const cleaned = imageBase64.replace(/^data:image\/\w+;base64,/, '');

  const prompt = `Estimate the macros for the meal in this photo.

Respond ONLY with a JSON object — no markdown, no explanation, no code fences. Use this exact shape:

{"name":"<short name, 1-4 words>","calories":<integer kcal>,"protein":<integer grams>,"carbs":<integer grams>,"fat":<integer grams>,"confidence":"high"|"medium"|"low"}

Assume one typical adult serving as shown. If you cannot identify the meal at all, set confidence to "low" and give your best guess based on what's visible.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: cleaned }},
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: data?.error?.message || 'Upstream error', raw: data });
      return;
    }

    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      res.status(502).json({ error: 'No JSON in model response', raw: text });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch (e) {
      res.status(502).json({ error: 'Bad JSON from model', raw: text });
      return;
    }

    res.status(200).json({
      name: String(parsed.name || 'Meal'),
      calories: Math.max(0, Math.round(Number(parsed.calories) || 0)),
      protein: Math.max(0, Math.round(Number(parsed.protein) || 0)),
      carbs: Math.max(0, Math.round(Number(parsed.carbs) || 0)),
      fat: Math.max(0, Math.round(Number(parsed.fat) || 0)),
      confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'medium'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
