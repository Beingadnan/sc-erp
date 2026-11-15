import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { rupeesInWords } from '@school-erp/validation';

export interface ReceiptDetails {
  schoolName: string;
  campusName: string;
  campusAddress: string | null;
  receiptNumber: string;
  receivedOn: string;
  studentName: string;
  admissionNumber: string;
  className: string;
  guardianName: string | null;
  mode: string;
  reference: string;
  bankName: string;
  instrumentDate: string | null;
  status: string;
  amount: number;
  lines: Array<{ label: string; amount: number }>;
  advance: number;
  collectedBy: string | null;
  note: string;
}

/** Standard PDF fonts only cover Latin text; anything else is replaced. */
const latin = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/[\u2012-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u20B9/g, 'Rs.')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
    .trim() || '-';
const dmy = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}-${m}-${y}` : iso;
};
/** "Rs. 12,500.00" — the rupee sign is not in the standard fonts. */
const rs = (paise: number) => {
  const r = Math.floor(Math.abs(paise) / 100);
  const s = String(r);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `Rs. ${rest ? `${rest},${last3}` : last3}.${String(Math.abs(paise) % 100).padStart(2, '0')}`;
};
const MODE: Record<string, string> = {
  cash: 'Cash',
  cheque: 'Cheque',
  dd: 'Demand draft',
  upi: 'UPI',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  opening: 'Old balance (brought forward)',
  online: 'Online',
};

/** One A5-landscape-width receipt on an A4 page (school copy can be printed twice). */
export async function renderReceiptPdf(r: ReceiptDetails): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Fee receipt ${r.receiptNumber}`);
  doc.setProducer('School ERP');
  const page = doc.addPage([595.28, 841.89]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.12, 0.16);
  const grey = rgb(0.42, 0.45, 0.5);
  const left = 48;
  const right = 547;
  let y = 790;
  const text = (t: string, x: number, size = 10, f = font, color = ink) =>
    page.drawText(latin(t), { x, y, size, font: f, color });
  const textRight = (t: string, x: number, size = 10, f = font) =>
    page.drawText(latin(t), {
      x: x - f.widthOfTextAtSize(latin(t), size),
      y,
      size,
      font: f,
      color: ink,
    });
  const rule = (w = 0.6) =>
    page.drawLine({ start: { x: left, y: y }, end: { x: right, y: y }, thickness: w, color: grey });

  const center = (t: string, size: number, f = bold) =>
    page.drawText(latin(t), {
      x: (595.28 - f.widthOfTextAtSize(latin(t), size)) / 2,
      y,
      size,
      font: f,
      color: ink,
    });
  center(r.schoolName, 16);
  y -= 16;
  center([r.campusName, r.campusAddress].filter(Boolean).join(', '), 9, font);
  y -= 22;
  center('FEE RECEIPT', 12);
  y -= 22;
  rule();
  y -= 18;
  text('Receipt no.', left, 9, font, grey);
  text(r.receiptNumber, left + 70, 10, bold);
  textRight(`Date: ${dmy(r.receivedOn)}`, right, 10);
  y -= 16;
  text('Student', left, 9, font, grey);
  text(r.studentName, left + 70, 10, bold);
  textRight(`Adm. no. ${r.admissionNumber}`, right, 10);
  y -= 16;
  text('Class', left, 9, font, grey);
  text(r.className, left + 70);
  if (r.guardianName) textRight(`Parent: ${r.guardianName}`, right, 10);
  y -= 22;
  rule();
  y -= 16;
  text('Particulars', left, 9, bold, grey);
  textRight('Amount', right, 9, bold);
  y -= 6;
  rule(0.3);
  for (const l of r.lines) {
    y -= 16;
    text(l.label, left);
    textRight(rs(l.amount), right);
  }
  if (r.advance > 0) {
    y -= 16;
    text('Advance (held for future fees)', left);
    textRight(rs(r.advance), right);
  }
  y -= 10;
  rule(0.3);
  y -= 16;
  text('Total received', left, 11, bold);
  textRight(rs(r.amount), right, 11, bold);
  y -= 16;
  text(rupeesInWords(r.amount), left, 9);
  y -= 22;
  const instrument =
    r.mode === 'cheque' || r.mode === 'dd'
      ? `${MODE[r.mode]} no. ${r.reference}, ${r.bankName}${r.instrumentDate ? `, dated ${dmy(r.instrumentDate)}` : ''}`
      : r.reference
        ? `${MODE[r.mode] ?? r.mode}, ref. ${r.reference}`
        : (MODE[r.mode] ?? r.mode);
  text(`Paid by: ${instrument}`, left, 9);
  if (r.mode === 'cheque' || r.mode === 'dd') {
    y -= 13;
    text('Subject to realisation of the cheque/DD.', left, 8, font, grey);
  }
  if (r.note) {
    y -= 13;
    text(`Note: ${r.note}`, left, 9);
  }
  y -= 40;
  text(`Received by: ${r.collectedBy ?? '-'}`, left, 9);
  textRight('Authorised signatory', right, 9);
  y -= 20;
  text('This is a computer-generated receipt.', left, 8, font, grey);

  if (r.status === 'cancelled' || r.status === 'bounced') {
    page.drawText(r.status === 'cancelled' ? 'CANCELLED' : 'CHEQUE BOUNCED', {
      x: 150,
      y: 520,
      size: 54,
      font: bold,
      color: rgb(0.8, 0.1, 0.1),
      opacity: 0.25,
      rotate: degrees(30),
    });
  }
  return doc.save();
}
