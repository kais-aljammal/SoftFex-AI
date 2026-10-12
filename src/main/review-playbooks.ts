import type {SnapshotFile} from './snapshot';

type Discipline='correctness'|'integration'|'data'|'security'|'frontend'|'reliability';
const guidance:Record<Discipline,string>={
  correctness:'Trace inputs, branches, units, boundaries and returned values. Check empty/zero/null cases, indexing, ordering and mutation against the supplied contract. Report only a demonstrable wrong result or broken behavior.',
  integration:'Compare changed callers and callees against supplied imports, signatures and API contracts. Check request/response shapes, async sequencing, status/error handling and trust boundaries. Missing context is uncertainty, not proof of a mismatch.',
  data:'Trace validation, conversions and state/database writes. Check precision, nullability, identifiers, transaction boundaries and collection operations for a concrete data-loss or wrong-result path. Respect the actual database API.',
  security:'Trace attacker-controlled input into queries, commands, HTML, filesystem access and authorization. Describe the required preconditions; distinguish a potential weakness from confirmed exploitation. Do not repeat supplied deterministic findings.',
  frontend:'Check rendered behavior, event/state flow, stale async results, accessible names, keyboard operation and focus against actual JSX/DOM code. Avoid visual preferences or generic accessibility advice without a specific broken interaction.',
  reliability:'Check cancellation, failures, timeouts, cleanup, concurrent updates and unbounded work for a plausible user-visible failure or performance problem. Do not request abstractions or optimizations without a concrete failing path.',
};

/** One reviewer, correctness first, and at most two source-relevant supporting lenses. */
export function selectReviewPlaybooks(files:Pick<SnapshotFile,'file'|'content'>[]){
  const scores=new Map<Exclude<Discipline,'correctness'>,number>();
  const add=(name:Exclude<Discipline,'correctness'>,amount:number)=>scores.set(name,(scores.get(name)??0)+amount);
  for(const file of files){
    const code=file.content;const path=file.file.toLowerCase();
    if(/\.(?:tsx|jsx)$/.test(path)||/\b(?:document\.|useState\(|useEffect\(|aria-|addEventListener\()/.test(code))add('frontend',5);
    if(/\b(?:fetch\(|axios\.|\.json\(|\.status\(|req\.|res\.|ipcMain|ipcRenderer|router\.|app\.(?:get|post|put|delete)\()/.test(code)||/(?:api|route|client|contract|service)/.test(path))add('integration',4);
    if(/\b(?:query\(|transaction\(|INSERT|SELECT|UPDATE|DELETE|JSON\.parse|parseFloat\(|parseInt\(|\.reduce\()/.test(code)||/(?:database|repository|schema|store|payment|money)/.test(path))add('data',3);
    if(/\b(?:query\(|exec\(|spawn\(|innerHTML\b|dangerouslySetInnerHTML\b|authorize\b|authenticate\b|permission\b|password\b|token\b)/.test(code)||/(?:auth|security|permission)/.test(path))add('security',4);
    if(/\b(?:async|await|AbortController|setTimeout|setInterval|Promise|\.on\(|\.watch\(|\.close\(|\.dispose\(|\.map\()/.test(code))add('reliability',2);
  }
  const selected:Discipline[]=['correctness',...[...scores].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,2).map(([name])=>name)];
  return selected.map(discipline=>({discipline,guidance:guidance[discipline]}));
}
