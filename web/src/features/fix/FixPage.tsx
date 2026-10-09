import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Eye, FileText, Loader2, Pencil, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { Fix } from "@/types/api";
import { api } from "@/api";
import { useApproveFixes, usePrompts, useRejectFix } from "@/api/hooks";
import { useFixes, useRootCauses } from "@/api/hooks";
import { FixStatusBadge, TypeBadge, VersionChip } from "@/components/Badges";
import { Diff, type DiffLine } from "@/components/Diff";
import { Checkbox, EmptyState, SectionTitle } from "@/components/Misc";
import { Modal } from "@/components/Overlay";
import { cn } from "@/lib/util";
import { fadeUp, stagger } from "@/theme/motion";

function FixCard({
  fix,
  selected,
  onSelect,
  edit,
  onEdit,
  onApprove,
  approving,
  focused,
}: {
  fix: Fix;
  selected: boolean;
  onSelect: (v: boolean) => void;
  edit?: string;
  onEdit: (v: string | undefined) => void;
  onApprove: () => void;
  approving: boolean;
  focused: boolean;
}) {
  const { data: rcs = [] } = useRootCauses();
  const rc = rcs.find((r) => r.id === fix.root_cause_id);
  const reject = useRejectFix();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(edit ?? fix.proposed_change);
  const [shake, setShake] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const pending = fix.status === "Pending Review";
  const change = edit ?? fix.proposed_change;

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focused]);

  const lines: DiffLine[] = [
    { kind: "remove", text: fix.current_excerpt },
    { kind: "add", text: change },
  ];

  return (
    <motion.article
      ref={ref}
      layout
      variants={fadeUp}
      animate={shake ? { x: [0, -5, 5, -4, 4, 0] } : undefined}
      transition={{ duration: 0.4 }}
      onAnimationComplete={() => setShake(0)}
      className={cn(
        "card relative overflow-hidden transition-shadow",
        selected && "shadow-glow",
        focused && !selected && "ring-1 ring-accent",
        fix.status === "Rejected" && "opacity-60",
      )}
    >
      <AnimatePresence>
        {approving && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
            style={{ background: "color-mix(in srgb, var(--good) 10%, transparent)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.svg viewBox="0 0 52 52" className="h-16 w-16">
              <motion.circle cx="26" cy="26" r="24" fill="none" stroke="var(--good)" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4 }} />
              <motion.path d="M15 27l7 7 15-16" fill="none" stroke="var(--good)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.35, delay: 0.35 }} />
            </motion.svg>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-5">
        <div className="flex flex-wrap items-start gap-3">
          {pending && <Checkbox checked={selected} onChange={onSelect} label={<span className="sr-only">Select fix</span>} />}
          <div className="min-w-0 flex-1">
            <div className="text-xs text-tm">Fix for</div>
            <h3 className="text-[15px] font-semibold text-t1">“{fix.root_cause_name}”</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-t2">
              {rc && <TypeBadge type={rc.type} />}
              <button className="hover:text-t1 hover:underline" onClick={() => nav(`/audit?rc=${fix.root_cause_id}`)}>
                Affects {fix.affected_calls} calls
              </button>
              <span>·</span>
              <span>Priority {fix.priority_score}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                against <VersionChip v={fix.prompt_version} />
              </span>
              {fix.applied_in && (
                <span className="flex items-center gap-1">
                  · applied in <VersionChip v={fix.applied_in} active />
                </span>
              )}
            </div>
          </div>
          <FixStatusBadge status={fix.status} />
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <div className="label mb-1.5">Current prompt (excerpt)</div>
            <p className="rounded-xl border border-line bg-s2 px-3 py-2 font-mono text-[12.5px] text-t2">“{fix.current_excerpt}”</p>
          </div>
          <div>
            <div className="label mb-1.5 flex items-center gap-2">
              Suggested change {edit !== undefined && <span className="chip bg-accent-soft normal-case tracking-normal text-accent">edited</span>}
            </div>
            <AnimatePresence mode="wait" initial={false}>
              {editing ? (
                <motion.div key="edit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <textarea
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={4}
                    className="input resize-y font-mono text-[12.5px] leading-relaxed"
                    aria-label="Edit suggested prompt change"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      className="btn-ghost px-3 py-1.5 text-xs"
                      onClick={() => {
                        setDraft(edit ?? fix.proposed_change);
                        setEditing(false);
                      }}
                    >
                      Cancel
                    </button>
                    {edit !== undefined && (
                      <button
                        className="btn-ghost px-3 py-1.5 text-xs"
                        onClick={() => {
                          onEdit(undefined);
                          setDraft(fix.proposed_change);
                          setEditing(false);
                        }}
                      >
                        Revert to suggestion
                      </button>
                    )}
                    <button
                      className="btn-primary px-3 py-1.5 text-xs"
                      disabled={!draft.trim()}
                      onClick={() => {
                        onEdit(draft.trim() === fix.proposed_change ? undefined : draft.trim());
                        setEditing(false);
                      }}
                    >
                      Save edit
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="diff" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Diff lines={lines} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <p className="flex gap-2 text-sm text-t2">
            <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
            {fix.rationale}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <div className="text-sm">
            <span className="text-tm">Expected repaired </span>
            <span className="font-semibold text-t1">
              ~{fix.expected_calls_repaired} of {fix.affected_calls}
            </span>
          </div>
          {pending && (
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(true)} disabled={editing}>
                <Pencil size={13} /> Edit fix
              </button>
              <button
                className="btn-outline px-3 py-1.5 text-xs"
                disabled={reject.isPending}
                onClick={() => {
                  setShake(1);
                  reject.mutate(fix.id);
                }}
              >
                <X size={13} /> Reject
              </button>
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={onApprove} disabled={editing || approving}>
                <Check size={13} /> Approve
              </button>
            </div>
          )}
          {!pending && fix.status !== "Rejected" && (
            <button className="btn-outline ml-auto px-3 py-1.5 text-xs" onClick={() => nav(`/test?fix=${fix.id}`)}>
              View test result
            </button>
          )}
        </div>
      </div>
    </motion.article>
  );
}

function PromptPreview({ open, onClose, ids, edits }: { open: boolean; onClose: () => void; ids: number[]; edits: Record<number, string> }) {
  const [data, setData] = useState<{ text: string; diff: DiffLine[] } | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(false);
  useEffect(() => {
    if (!open) return;
    setData(null);
    api.previewPrompt(ids, edits).then(setData);
  }, [open, ids, edits]);
  const lines = data ? (onlyChanges ? data.diff.filter((l) => l.kind !== "context") : data.diff) : [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Preview full new prompt"
      subtitle={`${ids.length} approved change${ids.length === 1 ? "" : "s"} applied`}
      className="max-w-3xl"
      footer={
        <>
          <Checkbox checked={onlyChanges} onChange={setOnlyChanges} label="Only show changes" />
          <button className="btn-outline ml-auto" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {data ? <Diff lines={lines} animate={false} /> : <div className="grid place-items-center py-16"><Loader2 className="animate-spin text-accent" /></div>}
    </Modal>
  );
}

export function FixPage() {
  const { data: fixes = [] } = useFixes();
  const { data: prompts = [] } = usePrompts();
  const approve = useApproveFixes();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const focus = params.get("fix");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [preview, setPreview] = useState<number[] | null>(null);
  const [approving, setApproving] = useState<Set<number>>(new Set());
  const [showActive, setShowActive] = useState(false);
  const [showReviewed, setShowReviewed] = useState(false);

  const active = prompts.find((p) => p.active);
  const nextVersion = `v${prompts.length + 1}`;
  const pending = fixes.filter((f) => f.status === "Pending Review").sort((a, b) => b.priority_score - a.priority_score);
  const reviewed = fixes.filter((f) => f.status !== "Pending Review").sort((a, b) => b.id - a.id);
  const selectedIds = useMemo(() => pending.filter((f) => selected.has(f.id)).map((f) => f.id), [pending, selected]);

  const doApprove = (ids: number[]) => {
    setApproving(new Set(ids));
    const payload = Object.fromEntries(ids.filter((id) => edits[id]).map((id) => [id, edits[id]]));
    setTimeout(() => {
      approve.mutate(
        { ids, edits: payload },
        {
          onSuccess: () => {
            setSelected(new Set());
            setApproving(new Set());
            setTimeout(() => nav("/test"), 500);
          },
          onError: () => setApproving(new Set()),
        },
      );
    }, 800);
  };

  if (!fixes.length) return <EmptyState icon={Wrench} title="No fixes drafted yet" body="Once root causes are found, the top issues get a minimal prompt change suggested here for review." />;

  return (
    <div className="space-y-8 pb-16">
      <section className="card p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft">
            <FileText size={17} className="text-accent" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-tm">Working against</div>
            <div className="flex items-center gap-2 text-sm font-semibold text-t1">
              Prompt {active && <VersionChip v={active.version} active />}
              <span className="font-normal text-tm">· approving creates {nextVersion}</span>
            </div>
          </div>
          <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setShowActive(!showActive)} aria-expanded={showActive}>
            <motion.span animate={{ rotate: showActive ? 180 : 0 }}>
              <ChevronDown size={14} />
            </motion.span>
            {showActive ? "Hide" : "Show"} active prompt
          </button>
        </div>
        <AnimatePresence initial={false}>
          {showActive && active && (
            <motion.pre
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-4 overflow-hidden whitespace-pre-wrap rounded-xl border border-line bg-s2 p-4 font-mono text-[12.5px] leading-relaxed text-t2"
            >
              {active.text}
            </motion.pre>
          )}
        </AnimatePresence>
      </section>

      <section>
        <SectionTitle
          title="Pending review"
          subtitle={pending.length ? "Approve one, or select several to merge into a single new prompt version" : "Nothing waiting — every suggested fix has been reviewed."}
          right={
            pending.length > 1 && (
              <button
                className="btn-ghost text-xs"
                onClick={() => setSelected(selectedIds.length === pending.length ? new Set() : new Set(pending.map((f) => f.id)))}
              >
                {selectedIds.length === pending.length ? "Clear selection" : "Select all"}
              </button>
            )
          }
        />
        <motion.div variants={stagger(0.07)} initial="hidden" animate="show" className="grid gap-4 xl:grid-cols-2">
          <AnimatePresence>
            {pending.map((f) => (
              <FixCard
                key={f.id}
                fix={f}
                focused={focus === String(f.id)}
                selected={selected.has(f.id)}
                onSelect={(on) => {
                  const n = new Set(selected);
                  on ? n.add(f.id) : n.delete(f.id);
                  setSelected(n);
                }}
                edit={edits[f.id]}
                onEdit={(v) => setEdits((e) => {
                  const n = { ...e };
                  if (v === undefined) delete n[f.id];
                  else n[f.id] = v;
                  return n;
                })}
                onApprove={() => doApprove([f.id])}
                approving={approving.has(f.id)}
              />
            ))}
          </AnimatePresence>
        </motion.div>
      </section>

      {reviewed.length > 0 && (
        <section>
          <button className="mb-4 flex items-center gap-2 text-sm font-semibold text-t1" onClick={() => setShowReviewed(!showReviewed)} aria-expanded={showReviewed}>
            <motion.span animate={{ rotate: showReviewed ? 0 : -90 }}>
              <ChevronDown size={16} />
            </motion.span>
            Reviewed <span className="chip bg-s2 text-t2">{reviewed.length}</span>
          </button>
          <AnimatePresence initial={false}>
            {showReviewed && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="grid gap-4 overflow-hidden xl:grid-cols-2">
                {reviewed.map((f) => (
                  <FixCard key={f.id} fix={f} focused={focus === String(f.id)} selected={false} onSelect={() => {}} onEdit={() => {}} onApprove={() => {}} approving={false} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      )}

      <AnimatePresence>
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="fixed inset-x-0 bottom-5 z-30 flex justify-center px-4"
          >
            <div className="glass flex w-full max-w-2xl flex-wrap items-center gap-3 rounded-2xl border border-line px-4 py-3 shadow-2xl">
              <span className="text-sm text-t1">
                <b className="tnum">{selectedIds.length}</b> fix{selectedIds.length > 1 ? "es" : ""} selected
              </span>
              <button className="btn-ghost ml-auto text-xs" onClick={() => setPreview(selectedIds)}>
                <Eye size={14} /> Preview full new prompt
              </button>
              <button className="btn-primary text-sm" onClick={() => doApprove(selectedIds)} disabled={approve.isPending || approving.size > 0}>
                {approve.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                Approve → create {nextVersion}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {pending.length > 0 && selectedIds.length === 0 && (
        <div className="flex justify-center">
          <button className="btn-ghost text-xs" onClick={() => setPreview(pending.map((f) => f.id))}>
            <Eye size={14} /> Preview prompt with all pending fixes
          </button>
        </div>
      )}

      <PromptPreview open={preview != null} onClose={() => setPreview(null)} ids={preview ?? []} edits={edits} />
    </div>
  );
}
