'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const UserNamePreferences = require('../models/UserNamePreferences');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * POST /api/names/suggest
 * Requires auth (requireAuth middleware sets req.userId).
 * Body: { prompt: string, gender: "boy"|"girl"|"neutral", excludeNames: string[] }
 * Response: { suggestions: [{ name: string, note: string }] }
 */
async function suggestNames(req, res) {
  const { prompt, gender, excludeNames, likedNames } = req.body;

  // --- Input validation ---
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
  }

  const validGenders = ['boy', 'girl', 'neutral'];
  if (!gender || !validGenders.includes(gender)) {
    return res.status(400).json({ error: 'gender must be one of: boy, girl, neutral' });
  }

  const safeExcludeNames = Array.isArray(excludeNames) ? excludeNames.filter(n => typeof n === 'string') : [];
  const safeLikedNames = Array.isArray(likedNames) ? likedNames.filter(n => typeof n === 'string') : [];

  // --- Build system prompt ---
  const excludeBlock = safeExcludeNames.length > 0
    ? safeExcludeNames.map(n => `- ${n}`).join('\n')
    : '(none)';

  const likedBlock = safeLikedNames.length > 0
    ? `This user has already chosen and likes these names: ${safeLikedNames.join(', ')}. Generate names in a similar style.\n\n`
    : '';

  const systemText = `${likedBlock}You are a baby name advisor. The parents are looking for ${gender} baby names.
Return ONLY a JSON array — no markdown, no explanation — of 12 to 16 name objects.
Each object must have exactly two fields:
  "name": the baby name (string, title-cased)
  "note": one short phrase (≤ 8 words) describing origin or character (e.g. "Irish origin, soft sound")

Do not suggest any of these already-submitted names:
${excludeBlock}

Gender guidance:
- "boy": suggest male names only
- "girl": suggest female names only
- "neutral": suggest gender-neutral names with a slight bias toward names that feel truly unisex`;

  // --- Call Claude Haiku with prompt caching on the system block ---
  let message;
  try {
    message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: systemText,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        { role: 'user', content: prompt.trim() },
      ],
    });
  } catch (err) {
    console.error('Anthropic API error in suggestNames:', err);
    return res.status(502).json({ error: 'AI service unavailable' });
  }

  // --- Parse response ---
  const rawText = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  // Strip markdown code fences if present
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  let suggestions;
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      throw new Error('Response is not an array');
    }
    suggestions = parsed
      .filter(item => item && typeof item.name === 'string' && typeof item.note === 'string');
  } catch (err) {
    console.error('Failed to parse Anthropic response:', rawText, err);
    return res.status(502).json({ error: 'AI service returned an unexpected response' });
  }

  const excludeSet = new Set(safeExcludeNames.map(n => n.toLowerCase()));
  suggestions = suggestions.filter(s => !excludeSet.has(s.name.toLowerCase())).slice(0, 12);

  return res.status(200).json({ suggestions });
}

/**
 * GET /api/names/preferences/:bracketId
 * Requires auth. Returns the owner's persisted bank and dismissed names,
 * creating a blank record if none exists.
 */
async function getPreferences(req, res) {
  const { userId } = req;
  const { bracketId } = req.params;
  try {
    const doc = await UserNamePreferences.findOneAndUpdate(
      { userId, bracketId },
      {},
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ dismissedNames: doc.dismissedNames, bankNames: doc.bankNames });
  } catch (err) {
    console.error('getPreferences error:', err);
    return res.status(500).json({ error: 'Failed to load preferences' });
  }
}

/**
 * PATCH /api/names/preferences/:bracketId
 * Requires auth. Partially updates dismissedNames and/or bankNames.
 * Body: { dismissedNames?: string[], bankNames?: { name: string, note: string }[] }
 */
async function patchPreferences(req, res) {
  const { userId } = req;
  const { bracketId } = req.params;
  const { dismissedNames, bankNames } = req.body;

  // Validate provided fields
  if (dismissedNames !== undefined) {
    if (!Array.isArray(dismissedNames) || dismissedNames.some(n => typeof n !== 'string')) {
      return res.status(400).json({ error: 'dismissedNames must be an array of strings' });
    }
  }
  if (bankNames !== undefined) {
    if (
      !Array.isArray(bankNames) ||
      bankNames.some(item => !item || typeof item.name !== 'string' || typeof item.note !== 'string')
    ) {
      return res.status(400).json({ error: 'bankNames must be an array of { name: string, note: string } objects' });
    }
  }

  // Build $set from only the keys that were provided
  const updates = {};
  if (dismissedNames !== undefined) updates.dismissedNames = dismissedNames;
  if (bankNames !== undefined) updates.bankNames = bankNames;

  try {
    const doc = await UserNamePreferences.findOneAndUpdate(
      { userId, bracketId },
      { $set: updates },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({ dismissedNames: doc.dismissedNames, bankNames: doc.bankNames });
  } catch (err) {
    console.error('patchPreferences error:', err);
    return res.status(500).json({ error: 'Failed to update preferences' });
  }
}

module.exports = { suggestNames, getPreferences, patchPreferences };
