import { sanitizeState } from './params';
import type { SoundState } from './state';

/**
 * Share links: the sound settings go in the URL hash as `#s=<code>`.
 * The hash is never sent to the server. Code format:
 *   "1" + base64url(deflate-raw(JSON))   when the browser can compress
 *   "0" + base64url(JSON)                fallback
 */

const PARAM = 's';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

const canCompress = typeof CompressionStream !== 'undefined';

export const MAX_NAME = 60;

/** Trim, drop control characters, and cap the length of a sound name. */
export function cleanName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME);
}

/** Just the sound and its name. */
function shareable(state: SoundState, name: string) {
  return {
    v: 1,
    name: cleanName(name) || undefined,
    rhythm: state.rhythm,
    buzz: state.buzz,
    zipper: state.zipper,
    bubbles: state.bubbles,
  };
}

export async function encodeState(state: SoundState, name = ''): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(shareable(state, name)));
  if (canCompress) return '1' + toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
  return '0' + toBase64Url(json);
}

export async function decodeState(code: string): Promise<{ state: SoundState; name: string }> {
  const body = fromBase64Url(code.slice(1));
  let bytes: Uint8Array;
  if (code[0] === '1') bytes = await pipe(body, new DecompressionStream('deflate-raw'));
  else if (code[0] === '0') bytes = body;
  else throw new Error('Unknown share code format');
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const name = data && typeof data === 'object' ? cleanName((data as { name?: unknown }).name) : '';
  return { state: sanitizeState(data), name };
}

/** The share code in the current URL, if any. */
export function codeFromUrl(): string | null {
  const hash = location.hash.replace(/^#/, '');
  return new URLSearchParams(hash).get(PARAM);
}

export function urlFor(code: string): string {
  return `${location.origin}${location.pathname}${location.search}#${PARAM}=${code}`;
}

/** Update the address bar without adding history entries or firing hashchange. */
export function writeUrl(code: string) {
  history.replaceState(null, '', `#${PARAM}=${code}`);
}
