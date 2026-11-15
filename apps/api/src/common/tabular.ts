import ExcelJS from 'exceljs';

/** A report as a table, ready to download. Money columns are rupees (numbers). */
export interface Table {
  title: string;
  columns: Array<{ key: string; label: string; money?: boolean; width?: number }>;
  rows: Array<Record<string, string | number | null>>;
  /** Optional final row of totals. */
  totals?: Record<string, string | number | null>;
}

const BOM = String.fromCharCode(0xfeff);
const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas (CSV injection) and quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const shown = (t: Table, v: string | number | null | undefined, money?: boolean) =>
  money && typeof v === 'number' ? (v / 100).toFixed(2) : v;

export function toCsv(t: Table): string {
  const lines = [t.columns.map((c) => c.label)];
  for (const r of [...t.rows, ...(t.totals ? [t.totals] : [])]) {
    lines.push(t.columns.map((c) => String(shown(t, r[c.key], c.money) ?? '')));
  }
  return `${BOM}${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
}

export async function toXlsx(t: Table): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  ws.columns = t.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.width ?? (c.money ? 14 : 18),
    style: c.money ? { numFmt: '#,##,##0.00' } : {},
  }));
  ws.getRow(1).font = { bold: true };
  const plain = (v: string | number | null | undefined) =>
    // Text is stored as text, never as a formula.
    typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v;
  for (const r of t.rows) {
    ws.addRow(
      Object.fromEntries(
        t.columns.map((c) => [c.key, plain(shown(t, r[c.key], c.money) as never)]),
      ),
    );
  }
  if (t.totals) {
    const row = ws.addRow(
      Object.fromEntries(
        t.columns.map((c) => [c.key, plain(shown(t, t.totals![c.key], c.money) as never)]),
      ),
    );
    row.font = { bold: true };
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const c of t.columns) {
    if (c.money)
      ws.getColumn(c.key).eachCell((cl, n) => n > 1 && (cl.value = Number(cl.value ?? 0)));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
