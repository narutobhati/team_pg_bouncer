import { AnimatePresence, motion } from "framer-motion";
import { Bot, Loader2, PhoneOff, ShieldCheck, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Fix, RootCause, Turn } from "@/types/api";
import type { LiveSession, LiveTestResult } from "@/types/api";
import { api } from "@/api";
import { useRootCauses } from "@/api/hooks";
import { GradeBadge, RiskyFlags } from "@/components/Badges";
import { Diff } from "@/components/Diff";
import { Modal } from "@/components/Overlay";
import { cn } from "@/lib/util";

// ── constants ─────────────────────────────────────────────────────────────────

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const SILENCE_THRESHOLD = 10;     // amplitude units — below this = silence
const SILENCE_DURATION_MS = 1200; // wait this long after you stop speaking
const BARGE_IN_THRESHOLD = 20;    // amplitude to detect user speaking over bot
const BARGE_IN_FRAMES = 3;        // consecutive loud frames before barge-in fires (×100ms)
const MAX_RECORD_MS = 30_000;

// ── voice state ───────────────────────────────────────────────────────────────

type VoiceState = "idle" | "bot-speaking" | "listening" | "processing" | "error";
type Phase = "setup" | "active" | "result";

// ── detect bot closing the call ───────────────────────────────────────────────

const CLOSING_PHRASES = [
  "dhanyawaad", "shukriya", "thank you for", "thanks for calling",
  "have a good day", "shubh ho", "good bye", "goodbye", "alvida",
  "whatsapp par bhej", "whatsapp pe bhej", "seller details",
  "connect kar", "connect kar denge", "i'll connect", "connect karunga",
  "indiamART ki taraf se", "indiamart ki taraf",
  "aapka din", "take care", "bye bye",
];

function isClosingStatement(text: string): boolean {
  const lower = text.toLowerCase();
  return CLOSING_PHRASES.some((p) => lower.includes(p.toLowerCase()));
}

// ── audio: play b64 WAV, stops early if user speaks (barge-in) ───────────────

async function playViaContext(
  ctx: AudioContext,
  b64: string,
  micStream?: MediaStream | null,
): Promise<void> {
  if (ctx.state === "suspended") await ctx.resume();
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
  return new Promise((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    let bargeInTimer: ReturnType<typeof setInterval> | null = null;
    let loudFrames = 0;

    const finish = () => {
      if (bargeInTimer) { clearInterval(bargeInTimer); bargeInTimer = null; }
      resolve();
    };

    // Barge-in: if user speaks while bot is talking, stop TTS immediately
    if (micStream) {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const micSrc = ctx.createMediaStreamSource(micStream);
      micSrc.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      bargeInTimer = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += Math.abs(buf[i] - 128);
        const avg = sum / buf.length;
        if (avg > BARGE_IN_THRESHOLD) {
          loudFrames++;
          if (loudFrames >= BARGE_IN_FRAMES) {
            micSrc.disconnect();
            src.onended = null;
            try { src.stop(); } catch { /* ignore */ }
            finish();
          }
        } else {
          loudFrames = 0;
        }
      }, 100);
    }

    src.onended = () => finish();
    src.start(0);
  });
}

// ── original transcript panel ─────────────────────────────────────────────────

function OriginalTranscript({ turns, callCode }: { turns: Turn[]; callCode?: string }) {
  if (!turns.length) return (
    <div className="flex flex-1 items-center justify-center text-xs text-tm">No transcript</div>
  );
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-line">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-s2 px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        <span className="text-xs font-medium text-t1">Original Call</span>
        {callCode && <span className="ml-auto font-mono text-[10px] text-tm">{callCode}</span>}
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-line">
        {turns.map((t, i) => {
          const isUser = t.speaker === "USER";
          return (
            <div key={i} className={cn("flex gap-2.5 px-3 py-2.5", isUser && "bg-accent/[0.07]")}>
              <span className={cn(
                "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                isUser ? "bg-accent/20 text-accent" : "bg-s3 text-tm",
              )}>
                {isUser ? "► YOU" : "BOT"}
              </span>
              <span className={cn("text-[12.5px] leading-relaxed", isUser ? "text-t1 font-semibold" : "text-t2")}>
                {t.text}
              </span>
            </div>
          );
        })}
      </div>
      <div className="shrink-0 border-t border-line bg-s2 px-3 py-1.5">
        <p className="text-[10px] text-tm">► lines are yours — say them aloud</p>
      </div>
    </div>
  );
}

// ── voice panel ───────────────────────────────────────────────────────────────

function VoicePanel({
  voiceState, lastBotText, lastUserText, onEndCall, endingCall,
}: {
  voiceState: VoiceState;
  lastBotText: string;
  lastUserText: string;
  onEndCall: () => void;
  endingCall: boolean;
}) {
  const speaking = voiceState === "bot-speaking";
  const listening = voiceState === "listening";
  const processing = voiceState === "processing";

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-line">
      {/* top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-s2 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-t2">
          <motion.span
            className="h-2 w-2 rounded-full bg-good"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1.4, repeat: Infinity }}
          />
          Live — you are the buyer
        </div>
        <button
          onClick={onEndCall}
          disabled={endingCall}
          className="flex items-center gap-1.5 rounded-lg bg-critical/10 px-2.5 py-1 text-xs font-medium text-critical transition-colors hover:bg-critical/20"
        >
          {endingCall ? <Loader2 size={11} className="animate-spin" /> : <PhoneOff size={11} />}
          End Call
        </button>
      </div>

      {/* bot avatar */}
      <div className="flex flex-1 flex-col items-center justify-center gap-5 p-4">
        <div className="relative">
          <div className={cn(
            "flex h-24 w-24 items-center justify-center rounded-full transition-all duration-300",
            speaking ? "bg-accent shadow-lg shadow-accent/30" : "bg-accent-soft",
          )}>
            <Bot size={40} className={speaking ? "text-white" : "text-accent"} />
          </div>
          {speaking && (
            <>
              <motion.div className="absolute inset-0 rounded-full border-2 border-accent/50"
                animate={{ scale: [1, 1.4], opacity: [0.5, 0] }}
                transition={{ duration: 1.1, repeat: Infinity }} />
              <motion.div className="absolute inset-0 rounded-full border-2 border-accent/25"
                animate={{ scale: [1, 1.7], opacity: [0.3, 0] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: 0.35 }} />
            </>
          )}
          {processing && (
            <div className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-s2 shadow">
              <Loader2 size={14} className="animate-spin text-accent" />
            </div>
          )}
        </div>

        {/* status */}
        <div className="text-center">
          <p className={cn("text-sm font-medium",
            speaking ? "text-accent" : listening ? "text-good" : processing ? "text-tm" : "text-t2"
          )}>
            {speaking ? "Tanya is speaking…" : listening ? "Listening…" : processing ? "Processing…" : "Starting…"}
          </p>
          {lastBotText && (
            <p className="mt-1.5 max-w-[220px] text-center text-xs italic leading-relaxed text-t2 line-clamp-3">
              "{lastBotText}"
            </p>
          )}
        </div>

        {/* mic indicator */}
        {listening && (
          <motion.div
            className="flex items-center gap-1"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 1.2, repeat: Infinity }}
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.div
                key={i}
                className="w-1 rounded-full bg-good"
                animate={{ height: ["8px", `${12 + Math.sin(i) * 10}px`, "8px"] }}
                transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.1 }}
              />
            ))}
          </motion.div>
        )}

        {/* last user echo */}
        {lastUserText && (
          <div className="rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-center text-xs text-t1 max-w-[200px]">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-accent">You said</span>
            {lastUserText}
          </div>
        )}
      </div>
    </div>
  );
}

// ── verdict panel ─────────────────────────────────────────────────────────────

function VerdictPanel({ result, fix }: { result: LiveTestResult; fix: Fix }) {
  const passed = result.grade === "Non-Fatal";
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border p-5"
        style={{
          borderColor: `color-mix(in srgb, var(${passed ? "--good" : "--critical"}) 40%, transparent)`,
          background: `color-mix(in srgb, var(${passed ? "--good" : "--critical"}) 8%, var(--surface-1))`,
        }}>
        <div className="flex items-center gap-3">
          {passed ? <ShieldCheck size={28} style={{ color: "var(--good)" }} /> : <TriangleAlert size={28} style={{ color: "var(--critical)" }} />}
          <div>
            <div className="text-lg font-semibold text-t1">{passed ? "Fix Validated ✓" : "Still Failing"}</div>
            <div className="text-sm text-t2">
              Original: <GradeBadge grade="Fatal" /> → Your test: <GradeBadge grade={result.grade} />
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-t2">{result.reason}</p>
        {result.risky_flags.length > 0 && <div className="mt-2"><RiskyFlags flags={result.risky_flags} /></div>}
      </div>

      <div className="rounded-xl border border-line bg-s2 p-4">
        <div className="mb-2 text-xs font-medium text-tm">Fix applied in this test</div>
        <p className="text-sm text-t1">{fix.proposed_change}</p>
      </div>

      <div className="rounded-xl border border-line bg-s2 p-4">
        <div className="mb-3 text-xs font-medium text-tm">Conversation transcript</div>
        <div className="max-h-44 space-y-2 overflow-y-auto">
          {result.turns.map((t, i) => (
            <div key={i} className={cn("flex gap-2 text-sm", t.speaker !== "BOT" && "flex-row-reverse")}>
              <span className={cn("mt-0.5 shrink-0 text-[10px] font-semibold", t.speaker === "BOT" ? "text-accent" : "text-tm")}>
                {t.speaker === "BOT" ? "BOT" : "YOU"}
              </span>
              <span className="text-t2">{t.text}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ── main modal ────────────────────────────────────────────────────────────────

export function LiveTestModal({ fix, open, onClose }: { fix: Fix | null; open: boolean; onClose: () => void }) {
  const { data: rcs = [] } = useRootCauses();
  const rc: RootCause | undefined = fix ? rcs.find((r: RootCause) => r.id === fix.root_cause_id) : undefined;

  const callIds: number[] = rc?.call_ids ?? [];
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const activeCallId = selectedCallId ?? callIds[0] ?? null;

  // Reset selected call when modal opens for a different fix
  useEffect(() => {
    setSelectedCallId(null);
  }, [fix?.id, open]);

  const { data: selectedCall } = useQuery({
    queryKey: ["call", activeCallId],
    queryFn: () => api.getCall(activeCallId!),
    enabled: !!activeCallId && open,
  });
  const fullTranscript: Turn[] = (selectedCall?.transcript ?? []) as Turn[];

  // Pre-fetch all associated calls so we can show their call codes in the picker
  const { data: allCalls = [] } = useQuery({
    queryKey: ["calls-for-rc", rc?.id],
    queryFn: async () => Promise.all(callIds.map((id) => api.getCall(id))),
    enabled: callIds.length > 1 && open,
  });

  // ── refs ──────────────────────────────────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const checkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionRef = useRef<LiveSession | null>(null);
  const activeRef = useRef(false); // prevents race conditions on close

  // ── state ─────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("setup");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [lastBotText, setLastBotText] = useState("");
  const [lastUserText, setLastUserText] = useState("");
  const [result, setResult] = useState<LiveTestResult | null>(null);
  const [endingCall, setEndingCall] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // ── cleanup helpers ───────────────────────────────────────────────────────
  const stopRecording = () => {
    clearInterval(checkIntervalRef.current ?? undefined);
    clearTimeout(silenceTimerRef.current ?? undefined);
    clearTimeout(maxTimerRef.current ?? undefined);
    checkIntervalRef.current = null;
    silenceTimerRef.current = null;
    maxTimerRef.current = null;
    if (recorderRef.current?.state === "recording") {
      try { recorderRef.current.stop(); } catch { /* ignore */ }
    }
  };

  const teardown = () => {
    activeRef.current = false;
    stopRecording();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  };

  // Reset on close
  useEffect(() => {
    if (!open) {
      teardown();
      setPhase("setup");
      setVoiceState("idle");
      setLastBotText("");
      setLastUserText("");
      setResult(null);
      setEndingCall(false);
      setErrorMsg("");
      sessionRef.current = null;
    }
  }, [open]);

  // ── start listening loop ──────────────────────────────────────────────────
  const startListening = () => {
    if (!activeRef.current || !micStreamRef.current) return;
    setVoiceState("listening");

    const ctx = audioCtxRef.current!;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    const src = ctx.createMediaStreamSource(micStreamRef.current);
    src.connect(analyser);

    const chunks: Blob[] = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
    const recorder = new MediaRecorder(micStreamRef.current, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = async () => {
      src.disconnect();
      clearInterval(checkIntervalRef.current ?? undefined);
      clearTimeout(silenceTimerRef.current ?? undefined);
      clearTimeout(maxTimerRef.current ?? undefined);

      if (!activeRef.current) return;

      const blob = new Blob(chunks, { type: mimeType });
      if (blob.size < 800) {
        // too short — probably silence or mic noise, listen again
        startListening();
        return;
      }

      setVoiceState("processing");
      try {
        const fd = new FormData();
        const ext = mimeType.includes("webm") ? "webm" : "ogg";
        fd.append("audio", blob, `turn.${ext}`);
        const resp = await fetch(`${BASE}/api/live-test/${sessionRef.current!.session_id}/stt`, {
          method: "POST",
          body: fd,
        });
        const { text } = await resp.json();
        if (!activeRef.current) return;
        if (text?.trim()) {
          await handleUserTurn(text.trim());
        } else {
          startListening(); // nothing heard, try again
        }
      } catch (e) {
        if (activeRef.current) startListening();
      }
    };

    recorder.start(150);

    // Silence detection — check audio level every 150ms
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let hadVoice = false;
    let silenceStart = 0;
    const recordStart = Date.now();

    checkIntervalRef.current = setInterval(() => {
      if (recorder.state !== "recording") return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += Math.abs(buf[i] - 128);
      const avg = sum / buf.length;

      if (avg > SILENCE_THRESHOLD) {
        hadVoice = true;
        silenceStart = 0;
      } else if (hadVoice) {
        if (!silenceStart) silenceStart = Date.now();
        if (Date.now() - silenceStart > SILENCE_DURATION_MS) {
          stopRecording();
        }
      } else if (Date.now() - recordStart > 6000) {
        // No voice at all for 6 seconds → restart listening
        stopRecording();
      }
    }, 150);

    // Hard cap
    maxTimerRef.current = setTimeout(() => {
      if (recorder.state === "recording") stopRecording();
    }, MAX_RECORD_MS);
  };

  // ── send user turn to bot ─────────────────────────────────────────────────
  const handleUserTurn = async (text: string) => {
    if (!activeRef.current || !sessionRef.current) return;
    setLastUserText(text);
    setVoiceState("processing");

    try {
      const resp = await api.sendLiveTurn(sessionRef.current.session_id, text);
      if (!activeRef.current) return;

      setLastBotText(resp.text);

      const closing = isClosingStatement(resp.text);

      if (resp.audio_b64 && audioCtxRef.current) {
        setVoiceState("bot-speaking");
        // Don't pass mic for barge-in on closing — let it play fully
        await playViaContext(audioCtxRef.current, resp.audio_b64, closing ? null : micStreamRef.current);
      }

      if (!activeRef.current) return;
      if (closing) {
        endCall();
      } else {
        startListening();
      }
    } catch (e) {
      if (activeRef.current) {
        setErrorMsg("Connection error — tap End Call to finish.");
        setVoiceState("error");
      }
    }
  };

  // ── start the call ────────────────────────────────────────────────────────
  const startCall = async () => {
    if (!fix) return;
    setVoiceState("processing");

    try {
      // Request mic + create AudioContext within user gesture
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = stream;
      audioCtxRef.current = new AudioContext();
      activeRef.current = true;

      const session = await api.startLiveTest(fix.id, activeCallId ?? undefined);
      sessionRef.current = session;
      setLastBotText(session.opening);
      setPhase("active");

      if (session.audio_b64 && audioCtxRef.current) {
        setVoiceState("bot-speaking");
        await playViaContext(audioCtxRef.current, session.audio_b64, micStreamRef.current);
      }

      if (activeRef.current) startListening();
    } catch (e: any) {
      setErrorMsg(e?.message?.includes("Permission") ? "Microphone access denied." : String(e?.message ?? e));
      setVoiceState("error");
    }
  };

  // ── end the call ──────────────────────────────────────────────────────────
  const endCall = async () => {
    if (!sessionRef.current) return;
    setEndingCall(true);
    activeRef.current = false;
    stopRecording();

    try {
      const r = await api.endLiveTest(sessionRef.current.session_id);
      teardown();
      setResult(r);
      setPhase("result");
    } catch (e) {
      console.error(e);
    } finally {
      setEndingCall(false);
    }
  };

  const diffLines = fix
    ? [
        { kind: "remove" as const, text: fix.current_excerpt || "(new addition)" },
        { kind: "add" as const, text: fix.proposed_change },
      ]
    : [];

  return (
    <Modal
      open={open && !!fix}
      onClose={onClose}
      title="Live Fix Test"
      subtitle={fix ? `Testing fix for: "${fix.root_cause_name}"` : ""}
      className={phase === "active" ? "max-w-5xl" : "max-w-2xl"}
    >
      <AnimatePresence mode="wait">

        {/* ── SETUP ── */}
        {phase === "setup" && fix && (
          <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <div className="rounded-xl border border-line bg-s2 p-4 text-sm leading-relaxed text-t2">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-tm">How this works</div>
              The original failing call is shown on the left as your script. Speak as the buyer — Tanya responds
              with the <strong className="text-t1">fixed prompt</strong> and her voice comes through your speakers.
              The call is auto-graded at the end.
            </div>

            {callIds.length > 1 && (
              <div>
                <div className="mb-2 text-xs font-medium text-tm">Select call to reproduce</div>
                <div className="flex flex-wrap gap-2">
                  {callIds.map((id) => {
                    const code = allCalls.find((c) => c.id === id)?.call_id ?? `#${id}`;
                    const active = id === (selectedCallId ?? callIds[0]);
                    return (
                      <button
                        key={id}
                        onClick={() => setSelectedCallId(id)}
                        className={cn(
                          "rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors",
                          active
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-line bg-s2 text-t2 hover:border-accent hover:text-accent",
                        )}
                      >
                        {code}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {fullTranscript.length > 0 && (
              <div>
                <div className="mb-2 flex items-center justify-between text-xs font-medium text-tm">
                  <span>Original call transcript (your reference)</span>
                  {selectedCall?.call_id && <span className="font-mono text-[10px] text-tm">{selectedCall.call_id}</span>}
                </div>
                <div className="max-h-48 overflow-y-auto rounded-xl border border-line divide-y divide-line">
                  {fullTranscript.map((t, i) => {
                    const isUser = t.speaker === "USER";
                    return (
                      <div key={i} className={cn("flex gap-2.5 px-3 py-2", isUser && "bg-accent/[0.07]")}>
                        <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide", isUser ? "bg-accent/20 text-accent" : "bg-s3 text-tm")}>
                          {isUser ? "► YOU" : "BOT"}
                        </span>
                        <span className={cn("text-[12.5px] leading-relaxed", isUser ? "font-semibold text-t1" : "text-t2")}>{t.text}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-medium text-tm">Prompt change being tested</div>
              <Diff lines={diffLines} animate={false} />
            </div>

            {errorMsg && (
              <p className="rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{errorMsg}</p>
            )}

            <div className="flex justify-end pt-2">
              <button className="btn-primary gap-2 px-5 py-2.5" onClick={startCall} disabled={voiceState === "processing"}>
                {voiceState === "processing"
                  ? <><Loader2 size={15} className="animate-spin" /> Connecting…</>
                  : <><Bot size={15} /> Start Live Call</>}
              </button>
            </div>
          </motion.div>
        )}

        {/* ── ACTIVE ── */}
        {phase === "active" && (
          <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex h-[480px] gap-4">
              <div className="flex w-[42%] flex-col">
                <OriginalTranscript turns={fullTranscript} callCode={selectedCall?.call_id} />
              </div>
              <VoicePanel
                voiceState={voiceState}
                lastBotText={lastBotText}
                lastUserText={lastUserText}
                onEndCall={endCall}
                endingCall={endingCall}
              />
            </div>
            {voiceState === "error" && (
              <p className="mt-3 rounded-lg bg-critical/10 px-3 py-2 text-sm text-critical">{errorMsg}</p>
            )}
          </motion.div>
        )}

        {/* ── RESULT ── */}
        {phase === "result" && result && fix && (
          <motion.div key="result" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
            <VerdictPanel result={result} fix={fix} />
            <div className="flex justify-end gap-2">
              <button className="btn-ghost px-4 py-2 text-sm"
                onClick={() => { setPhase("setup"); setResult(null); sessionRef.current = null; }}>
                Test Again
              </button>
              <button className="btn-outline px-4 py-2 text-sm" onClick={onClose}>Close</button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </Modal>
  );
}
