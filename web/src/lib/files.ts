import JSZip from "jszip";
import type { UploadFileInfo } from "@/types/api";

const AUDIO_RE = /\.(wav|mp3|m4a|ogg|flac|aac|webm|opus)$/i;
const MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  webm: "audio/webm",
  opus: "audio/ogg",
};

export const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type.includes("zip");
export const isAudio = (name: string) => AUDIO_RE.test(name);

/** Read an audio blob's duration via a detached <audio> element. Resolves undefined if the browser can't decode it. */
function probeDuration(blob: Blob): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    const done = (v?: number) => {
      URL.revokeObjectURL(url);
      resolve(v && Number.isFinite(v) ? v : undefined);
    };
    const timer = setTimeout(() => done(), 4000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      clearTimeout(timer);
      done(audio.duration);
    };
    audio.onerror = () => {
      clearTimeout(timer);
      done();
    };
    audio.src = url;
  });
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

/** List every audio file in the selection — expanding zips — with durations where the browser can decode them. */
export async function describeFiles(files: File[], onProgress?: (done: number, total: number) => void): Promise<UploadFileInfo[]> {
  const blobs: { name: string; size: number; blob: Blob }[] = [];
  for (const f of files) {
    if (isZip(f)) {
      const zip = await JSZip.loadAsync(f);
      const entries = Object.values(zip.files).filter((e) => !e.dir && isAudio(e.name) && !e.name.startsWith("__MACOSX"));
      for (const e of entries) {
        const ext = e.name.split(".").pop()!.toLowerCase();
        const blob = new Blob([await e.async("arraybuffer")], { type: MIME[ext] ?? "audio/*" });
        blobs.push({ name: e.name.split("/").pop()!, size: blob.size, blob });
      }
    } else if (isAudio(f.name)) {
      blobs.push({ name: f.name, size: f.size, blob: f });
    }
  }
  let done = 0;
  return pool(blobs, 6, async (b) => {
    const duration_sec = await probeDuration(b.blob);
    onProgress?.(++done, blobs.length);
    return { name: b.name, size: b.size, duration_sec };
  });
}

export const bytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
