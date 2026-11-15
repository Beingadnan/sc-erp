import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

/** What a printed transfer certificate shows (snapshot taken when it was issued). */
export interface TcDetails {
  schoolName: string;
  campusName: string;
  campusAddress: string | null;
  board: string;
  udiseCode: string | null;
  studentName: string;
  admissionNumber: string;
  admissionDate: string;
  dateOfBirth: string;
  gender: string;
  fatherName: string | null;
  motherName: string | null;
  guardianName: string | null;
  lastClass: string | null;
  lastYear: string | null;
  leftOn: string;
  reason: string;
  conduct: string;
  remarks: string;
  pen: string | null;
  apaarId: string | null;
}

/** Standard PDF fonts only cover Latin text; anything else is replaced. */
const latin = (s: string | null | undefined) =>
  (s ?? '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?').trim() || '-';

const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}-${m}-${y}` : iso;
};

const DATE_WORDS = [
  '',
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
  'Eleventh',
  'Twelfth',
  'Thirteenth',
  'Fourteenth',
  'Fifteenth',
  'Sixteenth',
  'Seventeenth',
  'Eighteenth',
  'Nineteenth',
  'Twentieth',
  'Twenty-first',
  'Twenty-second',
  'Twenty-third',
  'Twenty-fourth',
  'Twenty-fifth',
  'Twenty-sixth',
  'Twenty-seventh',
  'Twenty-eighth',
  'Twenty-ninth',
  'Thirtieth',
  'Thirty-first',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const yearWords = (y: number) => {
  const below100 = (n: number) =>
    n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`;
  const th = Math.floor(y / 1000);
  const rest = y % 1000;
  const hundreds = Math.floor(rest / 100);
  const last = rest % 100;
  return [
    th ? `${ONES[th]} Thousand` : '',
    hundreds ? `${ONES[hundreds]} Hundred` : '',
    last ? below100(last) : '',
  ]
    .filter(Boolean)
    .join(' ');
};
/** "2019-06-15" → "Fifteenth June Two Thousand Nineteen" (TCs show the birth date in words). */
export const dateInWords = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DATE_WORDS[d!]} ${MONTHS[m! - 1]} ${yearWords(y!)}`;
};

export async function renderTcPdf(
  tcNumber: string,
  issuedOn: string,
  d: TcDetails,
  opts: { cancelled?: boolean } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Transfer Certificate ${tcNumber}`);
  pdf.setProducer('School ERP');
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width } = page.getSize();
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.4, 0.43, 0.48);

  const centre = (text: string, y: number, size: number, f = bold) => {
    const t = latin(text);
    page.drawText(t, {
      x: (width - f.widthOfTextAtSize(t, size)) / 2,
      y,
      size,
      font: f,
      color: ink,
    });
  };

  page.drawRectangle({
    x: 28,
    y: 28,
    width: width - 56,
    height: 841.89 - 56,
    borderWidth: 1.2,
    borderColor: ink,
  });
  centre(d.schoolName, 780, 18);
  centre([d.campusName, d.campusAddress].filter(Boolean).join(', '), 760, 10, font);
  centre(
    [`Affiliated to ${d.board}`, d.udiseCode ? `UDISE ${d.udiseCode}` : null]
      .filter(Boolean)
      .join('  |  '),
    746,
    9,
    font,
  );
  page.drawLine({
    start: { x: 50, y: 734 },
    end: { x: width - 50, y: 734 },
    thickness: 0.8,
    color: ink,
  });
  centre('TRANSFER CERTIFICATE', 708, 15);
  page.drawText(latin(`TC No.: ${tcNumber}`), { x: 56, y: 682, size: 10, font: bold, color: ink });
  const issued = latin(`Date of issue: ${dmy(issuedOn)}`);
  page.drawText(issued, {
    x: width - 56 - font.widthOfTextAtSize(issued, 10),
    y: 682,
    size: 10,
    font,
    color: ink,
  });
  page.drawText(latin(`Admission No.: ${d.admissionNumber}`), {
    x: 56,
    y: 666,
    size: 10,
    font,
    color: ink,
  });

  const rows: Array<[string, string]> = [
    ['Name of the student', d.studentName],
    ["Father's name", d.fatherName ?? '-'],
    ["Mother's name", d.motherName ?? '-'],
    ...(d.guardianName ? ([["Guardian's name", d.guardianName]] as Array<[string, string]>) : []),
    ['Date of birth (in figures)', dmy(d.dateOfBirth)],
    ['Date of birth (in words)', dateInWords(d.dateOfBirth)],
    ['Gender', d.gender],
    ['Date of admission', dmy(d.admissionDate)],
    [
      'Class in which last studied',
      [d.lastClass, d.lastYear ? `(${d.lastYear})` : null].filter(Boolean).join(' ') || '-',
    ],
    ['Date of leaving', dmy(d.leftOn)],
    ['Reason for leaving', d.reason],
    ['General conduct', d.conduct],
    ['PEN (UDISE+)', d.pen ?? '-'],
    ['APAAR ID', d.apaarId ?? '-'],
    ['Remarks', d.remarks || '-'],
  ];
  let y = 630;
  rows.forEach(([label, value], i) => {
    page.drawText(`${i + 1}.`, { x: 56, y, size: 10, font, color: muted });
    page.drawText(latin(label), { x: 76, y, size: 10, font, color: ink });
    // Wrap long values.
    const words = latin(value).split(' ');
    let line = '';
    let ly = y;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (bold.widthOfTextAtSize(next, 10) > 270 && line) {
        page.drawText(line, { x: 270, y: ly, size: 10, font: bold, color: ink });
        ly -= 14;
        line = w;
      } else line = next;
    }
    page.drawText(line, { x: 270, y: ly, size: 10, font: bold, color: ink });
    y = ly - 22;
  });

  page.drawText('Prepared by', { x: 56, y: 110, size: 10, font, color: ink });
  page.drawText('Checked by', { x: 250, y: 110, size: 10, font, color: ink });
  page.drawText('Principal (seal and signature)', { x: 400, y: 110, size: 10, font, color: ink });
  page.drawText(
    latin(`Generated by School ERP. Verify TC No. ${tcNumber} with the school office.`),
    { x: 56, y: 48, size: 7.5, font, color: muted },
  );
  if (opts.cancelled) {
    page.drawText('CANCELLED', {
      x: 140,
      y: 330,
      size: 72,
      font: bold,
      color: rgb(0.85, 0.15, 0.15),
      opacity: 0.35,
      rotate: degrees(35),
    });
  }
  return pdf.save();
}
