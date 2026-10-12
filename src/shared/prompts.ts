import type {Finding} from './types';
export function fixPrompt(finding:Finding){
 return `Please inspect ${finding.file}:${finding.startLine}-${finding.endLine}.
SoftFex identified a ${finding.severity} potential ${finding.category} issue:
${finding.title}

Evidence:
${finding.evidence}

Concern: ${finding.explanation}
Potential impact: ${finding.impact}
Suggested correction: ${finding.recommendation}

First verify whether the concern is valid in this project's context.
If valid, apply the smallest safe correction using existing project libraries and conventions.
Preserve unrelated behavior; avoid unrelated refactors.
Add/update a focused regression test if appropriate, run relevant available checks, and report what changed and which checks actually passed.
If the concern is not valid, explain why with evidence rather than editing code.`;
}
