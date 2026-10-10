import { AnimatePresence, motion } from "framer-motion";
import { FileArchive, FileAudio, Loader2, Play, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { UploadFileInfo } from "@/types/api";
import { isMock } from "@/api";
import { useCreateBatch, useBatches, usePrompts } from "@/api/hooks";
import { Modal } from "@/components/Overlay";
import { VersionChip } from "@/components/Badges";
import { useUi } from "@/store/ui";
import { bytes, describeFiles, isAudio, isZip } from "@/lib/files";
import { cn, duration } from "@/lib/util";

export function UploadModal() {
  const { uploadOpen, setUploadOpen } = useUi();
  const { data: prompts = [] } = usePrompts();
  const { data: batches = [] } = useBatches();
  const create = useCreateBatch();
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [entries, setEntries] = useState<UploadFileInfo[]>([]);
  const [sample, setSample] = useState(0);
  const [label, setLabel] = useState("");
  const [drag, setDrag] = useState(false);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = prompts.find((p) => p.active);

  const reset = () => {
    setFiles([]);
    setEntries([]);
    setSample(0);
    setLabel("");
    setError(null);
    setReading(null);
    create.reset();
  };
  const close = () => {
    setUploadOpen(false);
    setTimeout(reset, 250);
  };

  const add = useCallback(async (list: File[]) => {
    const valid = list.filter((f) => isZip(f) || isAudio(f.name));
    if (!valid.length) {
      setError("Drop a .zip of recordings or audio files (wav, mp3, m4a, ogg, flac).");
      return;
    }
    setError(null);
    setSample(0);
    setReading({ done: 0, total: 0 });
    try {
      const info = await describeFiles(valid, (done, total) => setReading({ done, total }));
      if (!info.length) setError("No audio files found inside that upload.");
      setFiles((f) => [...f, ...valid]);
      setEntries((e) => [...e, ...info]);
    } catch (e) {
      setError(e instanceof Error ? `Couldn't read the upload: ${e.message}` : "Couldn't read the upload.");
    } finally {
      setReading(null);
    }
  }, []);

  const count = sample || entries.length;
  const totalSec = entries.reduce((s, e) => s + (e.duration_sec ?? 0), 0);

  const start = () =>
    create.mutate(
      { files, entries, label: label.trim() || `Batch ${batches.length + 1}`, sampleCount: sample || undefined },
      {
        onSuccess: () => {
          close();
          nav("/audit");
        },
        onError: (e) => setError(e instanceof Error ? e.message : "Upload failed"),
      },
    );

  return (
    <Modal
      open={uploadOpen}
      onClose={close}
      title="Upload recordings"
      subtitle={
        <span className="flex items-center gap-1.5">
          New batch will be graded against {active && <VersionChip v={active.version} active />}
        </span>
      }
      footer={
        <>
          <span className="mr-auto text-xs text-tm">{count > 0 && `${count} call${count === 1 ? "" : "s"} ready`}</span>
          <button className="btn-ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!count || create.isPending || !!reading} onClick={start}>
            {create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Start processing
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <motion.div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            add(Array.from(e.dataTransfer.files));
          }}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Choose a zip or audio files"
          animate={{ scale: drag ? 1.015 : 1 }}
          className={cn(
            "relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            drag ? "border-accent bg-accent-soft" : "border-line bg-s2 hover:border-[color:var(--border-strong)]",
          )}
          style={drag ? { boxShadow: "var(--shadow-glow)" } : undefined}
        >
          <motion.div animate={{ y: drag ? -6 : 0 }} className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-s1 shadow-card">
            {reading ? <Loader2 size={24} className="animate-spin text-accent" /> : <UploadCloud size={24} className="text-accent" />}
          </motion.div>
          <div className="text-sm font-semibold text-t1">{reading ? "Reading files…" : drag ? "Drop to add" : "Drag & drop a zip or audio files"}</div>
          <div className="mt-1 text-xs text-t2">
            {reading && reading.total ? `Measuring durations ${reading.done}/${reading.total}` : "or click to browse · .zip, .wav, .mp3, .m4a, .ogg, .flac · max 15 files per batch"}
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept=".zip,audio/*"
            className="hidden"
            onChange={(e) => {
              add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </motion.div>

        {isMock && entries.length === 0 && (
          <button
            className={cn("flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors", sample ? "border-accent bg-accent-soft" : "border-line hover:bg-s2")}
            onClick={() => setSample(sample ? 0 : 100)}
          >
            <Sparkles size={18} className="text-accent" />
            <span className="flex-1">
              <span className="block text-sm font-medium text-t1">Use sample batch</span>
              <span className="block text-xs text-t2">100 simulated IndiaMART buyer calls (Hinglish) — no files needed</span>
            </span>
            <span className={cn("h-4 w-4 rounded-full border-2", sample ? "border-accent bg-accent" : "border-[color:var(--border-strong)]")} />
          </button>
        )}

        <AnimatePresence>
          {error && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-sm" style={{ color: "var(--critical-text)" }} role="alert">
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {entries.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="text-t2">
                <b className="tnum text-t1">{entries.length}</b> recordings
                {totalSec > 0 && <> · {duration(totalSec)} total</>}
                {files.some(isZip) && (
                  <span className="ml-2 inline-flex items-center gap-1 text-tm">
                    <FileArchive size={12} /> {files.filter(isZip).map((f) => f.name).join(", ")}
                  </span>
                )}
              </span>
              <button className="flex items-center gap-1 text-t2 hover:text-t1" onClick={() => (setFiles([]), setEntries([]))}>
                <Trash2 size={12} /> Clear
              </button>
            </div>
            <ul className="max-h-56 divide-y divide-[color:var(--border)] overflow-y-auto rounded-xl border border-line">
              {entries.map((e, i) => (
                <motion.li
                  key={`${e.name}-${i}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.015, 0.5) }}
                  className="flex items-center gap-3 px-3 py-2 text-sm"
                >
                  <FileAudio size={14} className="shrink-0 text-tm" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-t1">{e.name}</span>
                  <span className="tnum text-xs text-tm">{bytes(e.size)}</span>
                  <span className="tnum w-12 text-right text-xs text-t2">{e.duration_sec ? duration(e.duration_sec) : "—"}</span>
                </motion.li>
              ))}
            </ul>
          </div>
        )}

        <label className="block">
          <span className="label mb-1.5 block">Batch label (optional)</span>
          <input className="input" placeholder={`e.g. Week 42 calls`} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        </label>
      </div>
    </Modal>
  );
}
