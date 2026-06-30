import { api } from '../api/client';
import { useStore } from '../state/store';

/**
 * Shared transcription flow: used by stop-recording (Shift+R) and by dropping
 * an audio file onto the canvas. Ends in phase 'ready' (panel shown) or null.
 */
export async function transcribeBlob(blob: Blob, filename: string): Promise<void> {
  const s = useStore.getState();
  if (s.audio && s.audio.phase !== 'recording') return; // panel already open
  s.setAudio({ phase: 'transcribing' });
  try {
    const result = await api.transcribe(blob, filename);
    if (!result.text.trim()) {
      useStore.getState().setAudio(null);
      useStore.getState().addToast('info', 'Nothing transcribed — the clip seems silent');
      return;
    }
    useStore.getState().setAudio({
      phase: 'ready',
      transcript: result.text,
      language: result.language,
      duration: result.duration,
      segments: result.segments,
    });
  } catch (err) {
    useStore.getState().setAudio(null);
    useStore.getState().addToast('error', `Transcription failed: ${(err as Error).message}`);
  }
}

const AUDIO_EXT_RE = /\.(m4a|mp3|wav|ogg|webm|aac|flac|mp4)$/i;

export function isAudioFile(file: File): boolean {
  return file.type.startsWith('audio/') || AUDIO_EXT_RE.test(file.name);
}
