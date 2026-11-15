import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { GradeBand } from '@school-erp/validation';

export interface ReportCardDetails {
  schoolName: string;
  campusName: string;
  campusAddress: string | null;
  examName: string;
  yearName: string;
  studentName: string;
  admissionNumber: string;
  rollNumber: number | null;
  className: string;
  dateOfBirth: string | null;
  fatherName: string | null;
  motherName: string | null;
  classTeacher: string | null;
  attendance: { present: number; total: number } | null;
  subjects: Array<{
    subjectName: string;
    maxMarks: number;
    marks: number | null;
    status: string | null;
    grade: string | null;
    passed: boolean | null;
  }>;
  total: number;
  maxTotal: number;
  percent: number | null;
  grade: string | null;
  rank: number | null;
  classSize: number;
  failedIn: string[];
  remark: string;
  bands: GradeBand[];
  /** Not yet published: printed with a "Provisional" note for the office. */
  provisional: boolean;
}

/** Standard PDF fonts only cover Latin text; anything else is replaced. */
const latin = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .trim();
const dmy = (iso: string | null) => {
  if (!iso) return '-';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}-${m}-${y}` : iso;
};
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const STATUS: Record<string, string> = { absent: 'AB', medical: 'ML', exempt: 'EX' };

const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.44, 0.5);
const LINE = rgb(0.8, 0.82, 0.86);
const BAND = rgb(0.94, 0.95, 0.97);
const RED = rgb(0.75, 0.1, 0.1);

/** A one-page A4 report card in the usual Indian school layout. */
export async function renderReportCardPdf(r: ReportCardDetails): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(latin(`Report card - ${r.studentName} - ${r.examName}`));
  pdf.setProducer('School ERP');
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = page.getWidth();
  const M = 40;
  let y = 800;

  const text = (s: string, x: number, yy: number, size = 10, f: PDFFont = font, color = INK) =>
    page.drawText(latin(s) || '-', { x, y: yy, size, font: f, color });
  const centre = (s: string, yy: number, size: number, f: PDFFont = font, color = INK) => {
    const t = latin(s);
    text(t, (W - f.widthOfTextAtSize(t, size)) / 2, yy, size, f, color);
  };
  const right = (
    s: string,
    xRight: number,
    yy: number,
    size = 10,
    f: PDFFont = font,
    color = INK,
  ) => {
    const t = latin(s) || '-';
    text(t, xRight - f.widthOfTextAtSize(t, size), yy, size, f, color);
  };
  const hline = (yy: number, p: PDFPage = page) =>
    p.drawLine({ start: { x: M, y: yy }, end: { x: W - M, y: yy }, thickness: 0.7, color: LINE });

  // Header
  centre(r.schoolName, y, 18, bold);
  y -= 16;
  centre([r.campusName, r.campusAddress].filter(Boolean).join(', '), y, 9, font, MUTED);
  y -= 22;
  centre(`REPORT CARD  -  ${r.examName.toUpperCase()}`, y, 12, bold);
  y -= 14;
  centre(`Academic year ${r.yearName}`, y, 9, font, MUTED);
  if (r.provisional) {
    y -= 13;
    centre('PROVISIONAL - results not yet published', y, 9, bold, RED);
  }
  y -= 14;
  hline(y);

  // Student details: two columns
  y -= 18;
  const details: Array<[string, string]> = [
    ['Student', r.studentName],
    ['Class', r.className],
    ['Admission no.', r.admissionNumber],
    ['Roll no.', r.rollNumber ? String(r.rollNumber) : '-'],
    ["Father's name", r.fatherName ?? '-'],
    ["Mother's name", r.motherName ?? '-'],
    ['Date of birth', dmy(r.dateOfBirth)],
    ['Attendance', r.attendance ? `${r.attendance.present} of ${r.attendance.total} days` : '-'],
  ];
  for (let i = 0; i < details.length; i += 2) {
    for (const [j, [k, v]] of details.slice(i, i + 2).entries()) {
      const x = j === 0 ? M : W / 2 + 10;
      text(k, x, y, 9, font, MUTED);
      text(v, x + 85, y, 10, j === 0 && i === 0 ? bold : font);
    }
    y -= 16;
  }
  y -= 4;

  // Marks table
  const cols = { subject: M + 8, max: 330, marks: 400, grade: 470, result: W - M - 8 };
  page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: BAND });
  text('Subject', cols.subject, y, 9, bold);
  right('Max', cols.max, y, 9, bold);
  right('Marks', cols.marks, y, 9, bold);
  right('Grade', cols.grade, y, 9, bold);
  right('Result', cols.result, y, 9, bold);
  y -= 22;
  for (const s of r.subjects) {
    text(s.subjectName, cols.subject, y, 10);
    right(String(s.maxMarks), cols.max, y, 10, font, MUTED);
    const shown =
      s.status === null
        ? '-'
        : s.status === 'present'
          ? num(s.marks ?? 0)
          : (STATUS[s.status] ?? '-');
    right(
      shown,
      cols.marks,
      y,
      10,
      s.passed === false ? bold : font,
      s.passed === false ? RED : INK,
    );
    right(s.grade ?? '-', cols.grade, y, 10);
    right(
      s.passed === null ? '-' : s.passed ? 'Pass' : 'Fail',
      cols.result,
      y,
      9,
      font,
      s.passed === false ? RED : MUTED,
    );
    y -= 6;
    hline(y);
    y -= 14;
  }
  // Totals
  y -= 2;
  text('Total', cols.subject, y, 10, bold);
  right(String(r.maxTotal), cols.max, y, 10, bold);
  right(num(r.total), cols.marks, y, 10, bold);
  right(r.grade ?? '-', cols.grade, y, 10, bold);
  y -= 24;

  const summary: Array<[string, string]> = [
    ['Percentage', r.percent === null ? '-' : `${r.percent.toFixed(2)}%`],
    ['Overall grade', r.grade ?? '-'],
    ['Rank in class', r.rank ? `${r.rank} of ${r.classSize}` : '-'],
    [
      'Result',
      r.failedIn.length ? `Needs to improve in ${r.failedIn.join(', ')}` : 'Passed in all subjects',
    ],
  ];
  for (const [k, v] of summary) {
    text(k, M, y, 9, font, MUTED);
    text(
      v,
      M + 100,
      y,
      10,
      k === 'Result' ? bold : font,
      k === 'Result' && r.failedIn.length ? RED : INK,
    );
    y -= 15;
  }

  // Remark
  y -= 8;
  text("Class teacher's remark", M, y, 9, font, MUTED);
  y -= 15;
  const words = latin(r.remark || '-').split(/\s+/);
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, 10) > W - 2 * M) {
      text(line, M, y, 10);
      y -= 13;
      line = w;
    } else line = next;
  }
  if (line) text(line, M, y, 10);

  // Grading key
  y = 150;
  hline(y + 12);
  text('Grading scale', M, y, 8, bold, MUTED);
  y -= 13;
  const key = [...r.bands]
    .sort((a, b) => b.minPercent - a.minPercent)
    .map((b) => `${b.label}: ${Math.round(b.minPercent)}-${Math.floor(b.maxPercent)}`)
    .join('    ');
  text(key, M, y, 8, font, MUTED);
  y -= 11;
  text('AB = absent, ML = medical leave, EX = exempt', M, y, 8, font, MUTED);

  // Signatures
  y = 70;
  for (const [i, label] of ['Class teacher', 'Principal', "Parent's signature"].entries()) {
    const x = M + i * ((W - 2 * M) / 3);
    page.drawLine({
      start: { x, y: y + 12 },
      end: { x: x + 140, y: y + 12 },
      thickness: 0.6,
      color: LINE,
    });
    text(i === 0 && r.classTeacher ? `${label} (${r.classTeacher})` : label, x, y, 8, font, MUTED);
  }
  return pdf.save();
}
