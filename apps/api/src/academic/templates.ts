/**
 * Starter structures for Indian schools. They are a starting point only: every class,
 * subject and grading band is editable afterwards, and nothing is added twice.
 *
 * Sources and caveats (see docs/research/academic-templates.md):
 *  - CBSE 8-point scale (A1…E) is the band set CBSE used for classes 9–10 under CCE and
 *    that most CBSE schools still print on internal report cards.
 *  - RBSE board results are reported in divisions (First ≥ 60 %, Second ≥ 45 %,
 *    Third ≥ 33 %); pilot schools must confirm what they use for internal exams.
 *  - The 5-point primary scale is a common descriptive scale; schools usually adjust it.
 */
import type { Board } from '@school-erp/validation';

export type Stage = 'pre_primary' | 'primary' | 'middle' | 'secondary' | 'senior_secondary';

export interface TemplateClass {
  code: string;
  name: string;
  stage: Stage;
  sortOrder: number;
}

export interface TemplateSubject {
  code: string;
  name: string;
  kind: 'scholastic' | 'co_scholastic';
}

export interface TemplateBand {
  label: string;
  minPercent: number;
  maxPercent: number;
  gradePoint: number | null;
  remark: string;
}

export interface TemplateScale {
  key: 'primary' | 'board';
  name: string;
  description: string;
  bands: TemplateBand[];
}

export const stageOf = (n: number): Stage =>
  n <= 5 ? 'primary' : n <= 8 ? 'middle' : n <= 10 ? 'secondary' : 'senior_secondary';

export const templateClasses = (
  includePrePrimary: boolean,
  highestClass: number,
): TemplateClass[] => [
  ...(includePrePrimary
    ? [
        { code: 'NUR', name: 'Nursery', stage: 'pre_primary' as const, sortOrder: 1 },
        { code: 'LKG', name: 'LKG', stage: 'pre_primary' as const, sortOrder: 2 },
        { code: 'UKG', name: 'UKG', stage: 'pre_primary' as const, sortOrder: 3 },
      ]
    : []),
  ...Array.from({ length: highestClass }, (_, i) => ({
    code: String(i + 1),
    name: `Class ${i + 1}`,
    stage: stageOf(i + 1),
    sortOrder: 10 + i + 1,
  })),
];

export const TEMPLATE_SUBJECTS: TemplateSubject[] = [
  { code: 'ENG', name: 'English', kind: 'scholastic' },
  { code: 'HIN', name: 'Hindi', kind: 'scholastic' },
  { code: 'MATH', name: 'Mathematics', kind: 'scholastic' },
  { code: 'EVS', name: 'Environmental Studies', kind: 'scholastic' },
  { code: 'SCI', name: 'Science', kind: 'scholastic' },
  { code: 'SST', name: 'Social Science', kind: 'scholastic' },
  { code: 'SKT', name: 'Sanskrit', kind: 'scholastic' },
  { code: 'COMP', name: 'Computer Science', kind: 'scholastic' },
  { code: 'ART', name: 'Art Education', kind: 'co_scholastic' },
  { code: 'HPE', name: 'Health & Physical Education', kind: 'co_scholastic' },
  { code: 'WORK', name: 'Work Education', kind: 'co_scholastic' },
];

/** Subject codes per stage; codes in OPTIONAL are added as optional subjects. */
export const STAGE_SUBJECTS: Record<Stage, string[]> = {
  pre_primary: ['ENG', 'HIN', 'MATH', 'ART'],
  primary: ['ENG', 'HIN', 'MATH', 'EVS', 'COMP', 'ART', 'HPE'],
  middle: ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'SKT', 'COMP', 'ART', 'HPE', 'WORK'],
  secondary: ['ENG', 'HIN', 'MATH', 'SCI', 'SST', 'COMP', 'ART', 'HPE', 'WORK'],
  // Streams (science / commerce / arts) differ by school; only the common core is added.
  senior_secondary: ['ENG', 'HPE', 'WORK'],
};
export const OPTIONAL_SUBJECTS = new Set(['COMP']);

const PRIMARY_SCALE: TemplateScale = {
  key: 'primary',
  name: '5-point descriptive (primary)',
  description: 'Starter scale for pre-primary to class 8. Edit the bands to match your school.',
  bands: [
    { label: 'A+', minPercent: 90, maxPercent: 100, gradePoint: null, remark: 'Outstanding' },
    { label: 'A', minPercent: 75, maxPercent: 89.99, gradePoint: null, remark: 'Excellent' },
    { label: 'B', minPercent: 56, maxPercent: 74.99, gradePoint: null, remark: 'Very good' },
    { label: 'C', minPercent: 35, maxPercent: 55.99, gradePoint: null, remark: 'Good' },
    {
      label: 'D',
      minPercent: 0,
      maxPercent: 34.99,
      gradePoint: null,
      remark: 'Scope for improvement',
    },
  ],
};

const CBSE_SCALE: TemplateScale = {
  key: 'board',
  name: 'CBSE 8-point (A1–E)',
  description: 'CBSE eight-band scale with grade points, for classes 9 to 12.',
  bands: [
    { label: 'A1', minPercent: 91, maxPercent: 100, gradePoint: 10, remark: '' },
    { label: 'A2', minPercent: 81, maxPercent: 90.99, gradePoint: 9, remark: '' },
    { label: 'B1', minPercent: 71, maxPercent: 80.99, gradePoint: 8, remark: '' },
    { label: 'B2', minPercent: 61, maxPercent: 70.99, gradePoint: 7, remark: '' },
    { label: 'C1', minPercent: 51, maxPercent: 60.99, gradePoint: 6, remark: '' },
    { label: 'C2', minPercent: 41, maxPercent: 50.99, gradePoint: 5, remark: '' },
    { label: 'D', minPercent: 33, maxPercent: 40.99, gradePoint: 4, remark: '' },
    { label: 'E', minPercent: 0, maxPercent: 32.99, gradePoint: null, remark: 'Needs improvement' },
  ],
};

const RBSE_SCALE: TemplateScale = {
  key: 'board',
  name: 'RBSE divisions',
  description:
    'Division system used for Rajasthan Board results, for classes 9 to 12. Confirm the internal-exam scheme with your school.',
  bands: [
    { label: 'I', minPercent: 60, maxPercent: 100, gradePoint: null, remark: 'First division' },
    { label: 'II', minPercent: 45, maxPercent: 59.99, gradePoint: null, remark: 'Second division' },
    { label: 'III', minPercent: 33, maxPercent: 44.99, gradePoint: null, remark: 'Third division' },
    { label: 'F', minPercent: 0, maxPercent: 32.99, gradePoint: null, remark: 'Fail' },
  ],
};

export const templateScales = (board: Board): TemplateScale[] =>
  board === 'RBSE' ? [PRIMARY_SCALE, RBSE_SCALE] : [PRIMARY_SCALE, CBSE_SCALE];

/** Which starter scale a class uses: board scale from class 9 up. */
export const scaleKeyFor = (stage: Stage): TemplateScale['key'] =>
  stage === 'secondary' || stage === 'senior_secondary' ? 'board' : 'primary';
