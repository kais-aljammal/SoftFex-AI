import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
export const REVIEW_MODEL = 'claude-sonnet-5-5';
export function readApiKey(projectRoot:string){return readCredential(projectRoot,'ANTHROPIC_API_KEY');}
// Imported only by Electron main. Never return this value through IPC.
export function readCredential(projectRoot: string,name:'ANTHROPIC_API_KEY'|'DEEPGRAM_API_KEY'): string | undefined {
  if (process.env[name]?.trim()) return process.env[name]!.trim();
  try {
    const match = readFileSync(join(projectRoot, '.env'), 'utf8').match(new RegExp(`^${name}=([^\\r\\n]*)`,'m'));
    const value = match?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
    return value || undefined;
  } catch { return undefined; }
}
export function createClient(key: string) { return new Anthropic({ apiKey: key, maxRetries: 0, timeout: 30_000 }); }
export function apiFailure(error: unknown): string {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401) return 'Anthropic authentication failed. Update your local key.';
    if (error.status === 403 || error.status === 404) return 'Sonnet 5.5 is unavailable for this API account.';
    if (error.status === 429) return 'Anthropic quota or rate limit reached. Try again later.';
    if (error.status === 400) return 'Anthropic rejected the review request.';
  }
  return 'Anthropic request unavailable or timed out. Local checks remain available.';
}
export async function checkConnectivity(key: string): Promise<{ ok: boolean; message: string }> {
  try {
    const result = await createClient(key).messages.create({
      model: REVIEW_MODEL, max_tokens: 64,
      thinking: { type: 'between_tools' }, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
    });
    const text = result.content.filter(block => block.type === 'text').map(block => block.text).join('');
    return result.stop_reason === 'end_turn' && text.trim() === 'OK'
      ? { ok: true, message: 'Claude Sonnet 5.5 connectivity verified.' }
      : { ok: false, message: 'API responded, but the minimal connectivity check did not complete as expected.' };
  } catch (error) { return { ok: false, message: apiFailure(error) }; }
}
