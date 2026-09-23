import 'dotenv/config';
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 8000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

const TIER_MODELS = {
  quick: 'claude-haiku-4-5',
  default: 'claude-sonnet-5',
  complex: 'claude-opus-5'
};

const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

if (!client) {
  console.warn('⚠ ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.');
}

function extractJSON(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced ? fenced[1] : trimmed;
  return JSON.parse(candidate);
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, configured: Boolean(client) });
});

app.post('/api/screen', async (req, res) => {
  if (!client) {
    return res.status(500).json({ error: { code: 'missing_api_key' } });
  }

  const { prompt, modelTier } = req.body || {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: { code: 'upstream_error' } });
  }

  const model = TIER_MODELS[modelTier] || TIER_MODELS.default;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });

    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || !textBlock.text.trim()) {
      return res.status(502).json({ error: { code: 'empty_completion' } });
    }

    let result;
    try {
      result = extractJSON(textBlock.text);
    } catch {
      return res.status(502).json({ error: { code: 'invalid_json' } });
    }

    res.json({ result });
  } catch (error) {
    console.error('Anthropic API error:', error);
    if (error instanceof Anthropic.AuthenticationError) {
      res.status(500).json({ error: { code: 'missing_api_key' } });
    } else if (error instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: { code: 'rate_limited' } });
    } else {
      res.status(502).json({ error: { code: 'upstream_error' } });
    }
  }
});

app.listen(PORT, () => {
  console.log(`SafeSignal Chat running at http://localhost:${PORT}`);
});
