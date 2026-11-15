import { z } from 'zod';

/** How Indian schools name classes, turned into our class record. */
export interface ClassInfo {
  code: string;
  name: string;
  stage: 'pre_primary' | 'primary' | 'middle' | 'secondary' | 'senior_secondary';
  sortOrder: number;
}

const ROMAN: Record<string, number> = {
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
};
const PRE: Array<[RegExp, ClassInfo]> = [
  [
    /^(pre[\s_-]*nursery|pn|play[\s_-]*(group|school)?)$/,
    { code: 'PN', name: 'Pre-Nursery', stage: 'pre_primary', sortOrder: 1 },
  ],
  [/^(nursery|nur)$/, { code: 'NUR', name: 'Nursery', stage: 'pre_primary', sortOrder: 2 }],
  [
    /^(lkg|l\.k\.g\.?|lower kg|kg[\s_-]*1|kg)$/,
    { code: 'LKG', name: 'LKG', stage: 'pre_primary', sortOrder: 3 },
  ],
  [
    /^(ukg|u\.k\.g\.?|upper kg|kg[\s_-]*2)$/,
    { code: 'UKG', name: 'UKG', stage: 'pre_primary', sortOrder: 4 },
  ],
];
const STREAMS: Record<string, string> = {
  sci: 'Science',
  science: 'Science',
  pcm: 'Science (PCM)',
  pcb: 'Science (PCB)',
  com: 'Commerce',
  commerce: 'Commerce',
  arts: 'Arts',
  art: 'Arts',
  humanities: 'Humanities',
  hum: 'Humanities',
};

const stageOf = (n: number): ClassInfo['stage'] =>
  n <= 5 ? 'primary' : n <= 8 ? 'middle' : n <= 10 ? 'secondary' : 'senior_secondary';

/** "Class 5", "5", "V", "5th", "Std 5", "LKG", "Nursery", "11 Science" → class; null if unknown. */
export const parseClassLabel = (raw: string): ClassInfo | null => {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^(class|std\.?|standard|grade)\s*/, '')
    .trim();
  if (!s) return null;
  for (const [re, info] of PRE) if (re.test(s)) return info;
  const m = /^([0-9]{1,2}|[ivx]{1,4})(st|nd|rd|th)?(?:[\s_-]*\(?([a-z]+)\)?)?$/.exec(s);
  if (!m) return null;
  const n = /^\d/.test(m[1]!) ? Number(m[1]) : ROMAN[m[1]!];
  if (!n || n < 1 || n > 12) return null;
  const stream = m[3] ? STREAMS[m[3]] : undefined;
  if (m[3] && (!stream || n < 11)) return null;
  return {
    code: stream
      ? `${n}-${stream.slice(0, 3).toUpperCase()}${stream.includes('(') ? stream.slice(-4, -1) : ''}`
      : String(n),
    name: stream ? `Class ${n} ${stream}` : `Class ${n}`,
    stage: stageOf(n),
    sortOrder: 10 + n,
  };
};

/** "All", "1-5, 7", "LKG, UKG, 1 to 3" → class codes (or 'all'); unknown parts listed in `bad`. */
export const parseClassList = (raw: string): { all: boolean; codes: string[]; bad: string[] } => {
  const s = raw.trim();
  if (!s || /^(all|all classes|\*)$/i.test(s)) return { all: true, codes: [], bad: [] };
  const codes: string[] = [];
  const bad: string[] = [];
  for (const part of s
    .split(/[,;/]+/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const range = /^(.+?)\s*(?:-|to|–)\s*(.+)$/i.exec(part);
    const a = range ? parseClassLabel(range[1]!) : null;
    const b = range ? parseClassLabel(range[2]!) : null;
    if (range && a && b && /^\d+$/.test(a.code) && /^\d+$/.test(b.code)) {
      for (let n = Number(a.code); n <= Number(b.code); n++) codes.push(String(n));
      continue;
    }
    const one = parseClassLabel(part);
    if (one) codes.push(one.code);
    else bad.push(part);
  }
  return { all: false, codes: [...new Set(codes)], bad };
};

/** A short code for a subject when the school did not give one: "Social Science" → "SOCIALSC". */
export const subjectCodeFrom = (name: string) => {
  const c = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 8);
  return /^[A-Z0-9]/.test(c) ? c : `S${c}`.slice(0, 8);
};

export const setupPreviewQuerySchema = z.object({
  campusId: z.uuid(),
  academicYearId: z.uuid().optional(),
});
export const setupListQuerySchema = z.object({ campusId: z.uuid() });

export const SETUP_MAX_BYTES = 2 * 1024 * 1024;
export const SETUP_MAX_ROWS = 2000;
