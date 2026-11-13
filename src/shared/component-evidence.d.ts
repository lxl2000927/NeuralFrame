export interface ProjectEvidenceRecord {
  scope: string;
  status: string;
  detail: string;
}
export interface ProjectEvidenceSource {
  label: string;
  url: string;
}
export interface ProjectEvidence {
  label: string;
  summary: string;
  records: ProjectEvidenceRecord[];
  sources: ProjectEvidenceSource[];
  checkedAt: string | null;
}
export function projectEvidence(component: string, version: string): ProjectEvidence;
/** Fixed HTTPS URLs whose version-specific documents were reviewed. */
export function projectEvidenceSources(): string[];
