// Asking an AI model for a structured answer, on behalf of one workspace.
//
// Each business chooses its own connection: the platform's default, its own Anthropic key, or any
// endpoint that speaks the common chat-completions protocol (which covers open-source models a
// business hosts itself). Whatever the provider, the caller gives a JSON schema and gets back an
// object, or a plain message saying why not. Keys stay on the server.
//
// The answer is always a proposal. Nothing here writes to the database; the caller shows the
// answer to a person, checks it against real records, and only then acts on it.

const clean = (s) => String(s ?? '').trim();

/** What this workspace's AI connection is, with the key resolved. Null when there is none. */
export function aiFor(env, w) {
  const set = w?.settings?.ai || {}, key = w?.secrets?.aiKey;
  if (set.provider === 'openai-compatible' && clean(set.baseUrl)) return { provider: 'openai-compatible', baseUrl: clean(set.baseUrl).replace(/\/$/, ''), model: clean(set.model), key: key || '' };
  if (set.provider === 'anthropic' && key) return { provider: 'anthropic', model: clean(set.model) || 'claude-haiku-5-5', key };
  if (env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: 'claude-haiku-5-5', key: env.ANTHROPIC_API_KEY, platform: true };
  return null;
}

export class AiError extends Error { constructor(msg, status = 502) { super(msg); this.status = status; } }

/**
 * One question, one structured answer.
 * @param conn    from aiFor()
 * @param system  what the model is doing and the rules it must keep
 * @param text    the material, already wrapped in tags by the caller
 * @param images  [{ type: 'image/jpeg', data: base64 }] for models that can see
 * @param schema  JSON schema of the answer
 * @param client  an Anthropic SDK client to reuse (tests pass a stand-in)
 */
export async function askJson({ conn, system, text, images = [], schema, maxTokens = 8000, fetchImpl = fetch, client = null }) {
  if (!conn) throw new AiError('No AI connection is set up for this business.', 501);
  if (conn.provider === 'anthropic') {
    if (!client) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); client = new Anthropic({ apiKey: conn.key }); }
    const content = [...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } })), { type: 'text', text }];
    const response = await client.messages.create({ model: conn.model, max_tokens: maxTokens, output_config: { effort: 'low', format: { type: 'json_schema', schema } }, system, messages: [{ role: 'user', content: images.length ? content : text }] });
    if (response.stop_reason === 'refusal') throw new AiError('The AI declined to read this.', 422);
    if (response.stop_reason === 'max_tokens') throw new AiError('There was too much for the AI to answer in one go. Send less at a time.', 422);
    try { return JSON.parse(response.content.find((b) => b.type === 'text').text); } catch { throw new AiError('The AI reply could not be read.'); }
  }
  // Any server that speaks chat completions: a hosted open-source model, a gateway, a local box.
  const user = images.length ? [{ type: 'text', text }, ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.type};base64,${im.data}` } }))] : text;
  const res = await fetchImpl(`${conn.baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', ...(conn.key ? { authorization: `Bearer ${conn.key}` } : {}) },
    body: JSON.stringify({ model: conn.model, max_tokens: maxTokens, messages: [{ role: 'system', content: `${system}\nAnswer with one JSON object that fits this schema and nothing else:\n${JSON.stringify(schema)}` }, { role: 'user', content: user }], response_format: { type: 'json_object' } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AiError(`The AI service did not answer as expected (${res.status}).`);
  const raw = clean(body.choices?.[0]?.message?.content).replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(raw); } catch { throw new AiError('The AI reply could not be read.'); }
}
