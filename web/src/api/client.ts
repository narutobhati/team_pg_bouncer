import type {
  Batch,
  Call,
  Fix,
  Pipeline,
  PromptVersion,
  Regression,
  ReplayedCall,
  RootCause,
  ServerEvent,
  TestResult,
  Turn,
  UploadFileInfo,
} from "@/types/api";

export interface CreateBatchInput {
  files: File[];
  label: string;
  /** Mock-only: synthesize a sample batch of this many calls instead of real files. */
  sampleCount?: number;
  /** Client-side listing of the upload (zip entries + durations), used by the mock for names and durations. */
  entries?: UploadFileInfo[];
}

/** Everything the UI needs from the backend. Implemented by the Go HTTP client and the in-browser mock. */
export interface ApiClient {
  readonly mode: "http" | "mock";
  getPipeline(): Promise<Pipeline>;
  listBatches(): Promise<Batch[]>;
  createBatch(input: CreateBatchInput): Promise<Batch>;
  listCalls(): Promise<Call[]>;
  getCall(id: number): Promise<Call>;
  markReviewed(id: number): Promise<Call>;
  replayCall(id: number): Promise<{ transcript: Turn[]; grade: Call["grade"] }>;
  listRootCauses(): Promise<RootCause[]>;
  listFixes(): Promise<Fix[]>;
  approveFixes(ids: number[], edits: Record<number, string>): Promise<PromptVersion>;
  rejectFix(id: number): Promise<Fix>;
  previewPrompt(ids: number[], edits: Record<number, string>): Promise<{ text: string; diff: PromptVersion["diff"] }>;
  listTests(): Promise<TestResult[]>;
  listReplayedCalls(fixId: number): Promise<ReplayedCall[]>;
  listPrompts(): Promise<PromptVersion[]>;
  listRegressions(): Promise<Regression[]>;
  subscribe(handler: (e: ServerEvent) => void): () => void;
  reset?(): Promise<void>;
}
