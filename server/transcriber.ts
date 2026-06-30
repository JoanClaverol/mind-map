import { Agent, fetch as undiciFetch, FormData as UndiciFormData } from 'undici';

/**
 * The sidecar sends response headers only AFTER transcription finishes, and
 * undici's default headersTimeout (300s) would kill long files mid-flight.
 * The AbortSignal below is the single real limit.
 */
const longHaul = new Agent({ headersTimeout: 0, bodyTimeout: 0 });
const TRANSCRIBE_TIMEOUT_MS = 15 * 60_000;
const HEALTH_CACHE_MS = 30_000;

// Read lazily — Vite's loadEnv populates process.env after modules evaluate.
function baseUrl(): string {
  return (process.env.TRANSCRIBER_URL ?? 'http://localhost:8124').replace(/\/+$/, '');
}

export interface TranscribeSegment {
  text: string;
  start: number;
  end: number;
}

export interface TranscribeResult {
  text: string;
  language: string;
  language_probability: number;
  duration: number;
  segments: TranscribeSegment[];
}

export async function transcribeAudio(file: File): Promise<TranscribeResult> {
  const fd = new UndiciFormData();
  fd.append('audio', file, file.name || 'audio.webm');
  const res = await undiciFetch(`${baseUrl()}/transcribe`, {
    method: 'POST',
    body: fd,
    dispatcher: longHaul,
    signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`transcriber ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as TranscribeResult;
}

let lastProbe = { at: 0, ok: false };

export async function transcriberHealthy(): Promise<boolean> {
  const now = Date.now();
  if (now - lastProbe.at < HEALTH_CACHE_MS) return lastProbe.ok;
  try {
    const res = await undiciFetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(2_000) });
    lastProbe = { at: now, ok: res.ok };
  } catch {
    lastProbe = { at: now, ok: false };
  }
  return lastProbe.ok;
}
