// Wire types shared with the Go API. Field names are snake_case on the wire and kept
// as-is in the client so the JSON can be passed through without mapping.

export type Grade = "Fatal" | "Non-Fatal";

export const CATEGORIES = ["wrong_capture", "loop", "wrong_info", "incomplete", "compliance", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const RISK_FLAGS = ["frustration", "loop", "human_request", "low_confidence", "wrong_capture"] as const;
export type RiskFlag = (typeof RISK_FLAGS)[number];

export const ROOT_CAUSE_TYPES = ["Prompt Issue", "ASR Issue", "Knowledge Gap", "Flow Logic"] as const;
export type RootCauseType = (typeof ROOT_CAUSE_TYPES)[number];

export type Stage = "idle" | "queued" | "processing" | "clustering" | "fixing" | "testing" | "done";

export type ReplayStatus = "repaired" | "failing" | "unchanged";

export interface Turn {
  speaker: "BOT" | "USER";
  text: string;
  timestamp: string; // "mm:ss"
  confidence: number; // 0..1 ASR confidence
  asr_mismatch?: boolean; // verbatim vs normalized transcript differ significantly
  verbatim?: string;
  // Only on simulated (replayed) transcripts:
  replay_status?: ReplayStatus;
  original_text?: string;
}

export interface Call {
  id: number;
  call_id: string; // human-facing id, e.g. "CL-1042"
  batch_id: number;
  file_name: string;
  prompt_version: string; // "v1"
  created_at: string; // ISO
  duration_sec: number;
  language: string; // "hi-IN" | "en-IN" | ...
  overall_confidence: number;
  grade: Grade;
  category?: Category; // absent on clean calls
  reason: string;
  evidence: string;
  evidence_timestamp: string;
  evidence_turn?: number; // index into transcript
  risky_flags: RiskFlag[];
  reviewed: boolean;
  root_cause_id?: number;
  transcript: Turn[];
  simulated_transcript?: Turn[];
  simulated_grade?: Grade;
}

export interface Batch {
  id: number;
  label: string;
  total: number;
  processed: number;
  prompt_version: string;
  stage: Stage;
  created_at: string;
  completed_at?: string;
  clustered_at?: string;
}

export interface RootCause {
  id: number;
  batch_id: number;
  name: string;
  description: string;
  type: RootCauseType;
  call_ids: number[];
  frequency: number; // 0..1 share of batch
  severity: number; // 0..1 share of affected calls that are Fatal
  priority_score: number; // 0..100
  fixed: boolean;
  regressed?: boolean; // a previously fixed root cause that reappeared above threshold
  fix_id?: number;
  snippets: { call_id: number; lines: Turn[] }[];
}

export type FixStatus = "Pending Review" | "Approved" | "Rejected" | "Validated" | "Needs Revision";

export interface Fix {
  id: number;
  root_cause_id: number;
  root_cause_name: string;
  prompt_version: string; // version the diff is written against
  current_excerpt: string;
  proposed_change: string;
  rationale: string;
  expected_calls_repaired: number;
  affected_calls: number;
  priority_score: number;
  status: FixStatus;
  created_at: string;
  applied_in?: string; // prompt version that includes this fix
}

export interface TestResult {
  fix_id: number;
  root_cause_id: number;
  root_cause_name: string;
  prompt_before: string;
  prompt_after: string;
  replayed: number;
  before_fatal: number;
  after_fatal: number;
  repaired: number;
  still_failing: number;
  regressed: number;
  seconds_to_fix: number; // issue found -> fix tested
  verdict: "Validated" | "Needs Revision";
  completed_at: string;
}

export interface ReplayedCall {
  call_id: number;
  call_code: string;
  before: Grade;
  after: Grade;
  status: "Repaired" | "Still Failing" | "Regressed";
  old_response: string;
  new_response: string;
}

export interface PromptVersion {
  version: string;
  created_at: string;
  based_on?: string;
  fixes_applied: number[];
  fixed_root_causes: string[];
  text: string;
  diff: { kind: "context" | "add" | "remove"; text: string }[];
  fatal_rate?: number; // measured on batches run against this version
  projected_fatal_rate?: number; // from replay tests, before any batch ran on it
  calls_applied: number;
  batch_ids: number[];
  active: boolean;
}

export interface Regression {
  id: number;
  root_cause_name: string;
  fixed_in: string;
  batch_id: number;
  frequency: number;
  created_at: string;
}

export interface Pipeline {
  stage: Stage;
  batch_id?: number;
  processed: number;
  total: number;
  active_prompt: string;
}

export interface UploadFileInfo {
  name: string;
  size: number;
  duration_sec?: number;
}

export type ServerEvent =
  | { type: "batch.created"; batch: Batch }
  | { type: "batch.progress"; pipeline: Pipeline }
  | { type: "call.graded"; call: Call }
  | { type: "root_causes.ready"; batch_id: number; count: number }
  | { type: "fixes.ready"; count: number }
  | { type: "prompt.created"; version: string }
  | { type: "test.done"; results: TestResult[] }
  | { type: "regression"; regression: Regression }
  | { type: "call.updated"; call: Call };
