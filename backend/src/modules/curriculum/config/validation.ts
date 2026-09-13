import type { CurriculumConfiguration } from "./types.js";
export function validateConfiguration(c: CurriculumConfiguration) {
  const errors: string[] = [];
  const validDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
  if (!c.boardCode || !c.version || !c.datasetCode || !c.datasetVersion) errors.push("boardCode, version, datasetCode and datasetVersion are required");
  if (!validDate(c.academicYear.startDate) || !validDate(c.academicYear.endDate) || c.academicYear.endDate < c.academicYear.startDate) errors.push("academic year dates are invalid");
  if (!Number.isInteger(c.examinationYear.yearValue) || c.examinationYear.yearValue < 1900) errors.push("examination year is invalid");
  const keys = new Set<string>();
  for (const s of c.structures) {
    if (keys.has(s.key)) errors.push(`duplicate structure key: ${s.key}`); keys.add(s.key);
    const nodeKeys = new Set<string>(); const elementKeys = new Set<string>(); const parents = new Map<string,string|undefined>();
    for (const n of s.nodes) {
      if (nodeKeys.has(n.key)) errors.push(`duplicate node key: ${n.key}`); nodeKeys.add(n.key);
      parents.set(n.key,n.parentKey);
      if (n.parentKey && n.parentKey === n.key) errors.push(`self-parent node: ${n.key}`);
      if (n.parentKey && !s.nodes.some(x => x.key === n.parentKey)) errors.push(`unknown parent: ${n.key}`);
      if (n.sequence !== undefined && (!Number.isInteger(n.sequence) || n.sequence < 0)) errors.push(`invalid sequence: ${n.key}`);
      for (const e of n.elements ?? []) { if (!e.key || !e.type || !e.title) errors.push(`invalid element: ${n.key}`); const ek=`${n.key}:${e.key}`; if(elementKeys.has(ek)) errors.push(`duplicate element key: ${ek}`); elementKeys.add(ek); }
    }
    for (const key of nodeKeys) { const seen = new Set<string>(); let current: string|undefined = key; while (current) { if(seen.has(current)){ errors.push(`cycle involving node: ${key}`); break; } seen.add(current); current=parents.get(current); } }
  }
  if (errors.length) { const error = new Error(errors.join("; ")); (error as Error & { code?: string }).code = "VALIDATION_ERROR"; throw error; }
  return c;
}
