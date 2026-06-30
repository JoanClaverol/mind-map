/**
 * MediaRecorder wrapper. The recorder/stream objects live here at module level
 * (they are not serializable and must never enter the store).
 */

// Safari records audio/mp4 (AAC) only; Chrome prefers webm/opus.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

interface Holder {
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
}

let holder: Holder | null = null;

export function isRecording(): boolean {
  return holder !== null;
}

export async function startRecording(): Promise<void> {
  if (holder) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('microphone requires a secure context (use http://localhost)');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  holder = { recorder, stream, chunks };
  recorder.start(); // no timeslice: Safari may emit a single chunk at stop
}

/** Stop and assemble the clip. Resolves null if nothing was captured. */
export function stopRecording(): Promise<{ blob: Blob; filename: string } | null> {
  const h = holder;
  if (!h) return Promise.resolve(null);
  holder = null;
  return new Promise((resolve) => {
    h.recorder.onstop = () => {
      h.stream.getTracks().forEach((t) => t.stop()); // release the mic indicator
      const type = h.recorder.mimeType || 'audio/webm';
      const ext = type.includes('mp4') ? 'm4a' : type.includes('webm') ? 'webm' : 'bin';
      const blob = new Blob(h.chunks, { type });
      resolve(blob.size > 0 ? { blob, filename: `recording.${ext}` } : null);
    };
    h.recorder.stop();
  });
}

/** Abandon an in-progress recording (Esc, editor unmount). */
export function discardRecording(): void {
  const h = holder;
  holder = null;
  if (!h) return;
  h.recorder.onstop = () => h.stream.getTracks().forEach((t) => t.stop());
  try {
    h.recorder.stop();
  } catch {
    h.stream.getTracks().forEach((t) => t.stop());
  }
}
