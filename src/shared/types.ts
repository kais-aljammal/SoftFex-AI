export type AppPhase = 'needs_workspace' | 'watching' | 'changes_pending' | 'reviewing' | 'report_ready' | 'report_partial' | 'report_outdated' | 'review_failed';
export type Finding = {
  id: string; origin: 'rule' | 'ai'; ruleId?: string;
  severity: 'critical' | 'high' | 'medium' | 'low'; confidence: 'high' | 'medium' | 'low';
  category: 'security' | 'correctness' | 'reliability' | 'quality'; title: string;
  file: string; startLine: number; endLine: number; evidence: string;
  explanation: string; impact: string; recommendation: string; snapshotHash: string;
};
export type ReviewReport = {
  reviewId: string; workspace: string; trigger: 'codex_turn_complete' | 'manual'; revision: number;
  startedAt: number; finishedAt?: number; status: 'complete' | 'partial' | 'outdated' | 'failed';
  changedFiles: number; reviewedFiles: string[]; skippedFiles: string[];
  localChecksPassed: boolean; aiStatus: 'completed' | 'failed' | 'not_configured' | 'skipped';
  findings: Finding[]; previousFindings: { finding: Finding; status: 'resolved_in_latest_snapshot' | 'not_reverified' }[];
  note?: string; mode: 'changed' | 'current_snapshot';
};
export type AppState = {
  phase: AppPhase; workspace?: string; changedFiles: number; revision: number; report?: ReviewReport;
  error?: string; muted: boolean; aiEnabled: boolean; apiKeyPresent: boolean;
  apiConnectivity: 'unchecked' | 'checking' | 'connected' | 'failed'; apiMessage?: string;
  integration: 'manual' | 'listening' | 'connected'; lastCompletion?: number;
  deepgramKeyPresent?: boolean;
};
export type WindowMode='collapsed'|'changes'|'reviewing'|'warning'|'speaking'|'report'|'detail';
export type SpeechResult={text:string;provider:'deepgram'|'browser';bytes?:Uint8Array;notice?:string};
export type Result<T = void> = { ok: true; value: T } | { ok: false; error: string };
export interface SoftFexAPI {
  getState(): Promise<AppState>;
  onStateChange(callback: (state: AppState) => void): () => void;
  setWindowMode(mode: WindowMode): Promise<Result>;
  selectWorkspace(): Promise<Result>;
  reviewNow(): Promise<Result>;
  openFinding(id: string): Promise<Result>;
  getFixPrompt(id: string): Promise<Result<string>>;
  copyPrompt(id: string): Promise<Result>;
  setMute(value: boolean): Promise<Result>;
  setAiReviewEnabled(value: boolean): Promise<Result>;
  requestSpeech(request:{kind:'test'}|{kind:'report';reviewId:string}):Promise<Result<SpeechResult>>;
  stopSpeech():Promise<Result>;
  quit(): Promise<Result>;
}
declare global { interface Window { softfex: SoftFexAPI } }
