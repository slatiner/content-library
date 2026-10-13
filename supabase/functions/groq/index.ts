// Groq proxy for the assistant (#24). The Groq key lives in Supabase's secret
// store (GROQ_API_KEY) and never reaches the browser. Only signed-in users may
// call it; the function checks the caller's session with Supabase Auth itself
// (deployed with --no-verify-jwt, which also lets the CORS preflight through).
// Requests are passed to Groq as they are, limited to the app's model and token
// cap so the shared quota can't be spent on anything else.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELS = new Set(['openai/gpt-oss-20b']);
const MAX_TOKENS = 1500;
const ORIGINS = new Set(['https://slatiner.github.io', 'http://localhost:5173']);

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': ORIGINS.has(origin) ? origin : 'https://slatiner.github.io',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin') ?? '');
  const reply = (status: number, body: unknown) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: { message: 'POST only' } });

  // Signed in? Ask Supabase Auth about the caller's token.
  const auth = req.headers.get('authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? '';
  const who = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
    headers: { authorization: auth, apikey },
  });
  if (!who.ok) return reply(401, { error: { code: 'not_signed_in', message: 'Sign in to use the assistant.' } });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: { message: 'Body must be JSON' } });
  }
  if (!MODELS.has(String(body.model))) return reply(400, { error: { message: 'Model not allowed' } });
  body.max_completion_tokens = Math.min(Number(body.max_completion_tokens) || MAX_TOKENS, MAX_TOKENS);

  const key = Deno.env.get('GROQ_API_KEY');
  if (!key) return reply(500, { error: { code: 'no_server_key', message: 'GROQ_API_KEY is not set' } });
  const groq = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // A rejected server key is our problem, not the caller's sign-in.
  return reply(groq.status === 401 ? 502 : groq.status, await groq.text());
});
