import { useEffect, useMemo, useRef } from 'react';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import * as XLSX from 'xlsx';
import { tx } from '../i18n.js';

export const emptySheets = () => [{ name: tx("Лист1"), id: 's' + Date.now(), order: 0, status: 1, celldata: [], row: 100, column: 30, config: {} }];

/** Матрица data -> компактный celldata для хранения */
export function compactSheets(sheets) {
  return sheets.map((s) => {
    const { data, ...rest } = s;
    if (!data) return rest;
    const celldata = [];
    data.forEach((row, r) => row?.forEach((v, c) => { if (v != null && (v.v != null || v.f || v.m || v.bg || v.bl || v.it || v.mc)) celldata.push({ r, c, v }); }));
    return { ...rest, celldata, row: Math.max(rest.row || 0, data.length), column: Math.max(rest.column || 0, data[0]?.length || 0) };
  });
}

export function sheetsToXlsx(sheets) {
  const wb = XLSX.utils.book_new();
  for (const s of compactSheets(sheets)) {
    const ws = {};
    let maxR = 0, maxC = 0;
    for (const { r, c, v } of s.celldata || []) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const val = v.v;
      const cell = { t: typeof val === 'number' ? 'n' : typeof val === 'boolean' ? 'b' : 's', v: val ?? v.m ?? '' };
      if (v.f) cell.f = String(v.f).replace(/^=/, '');
      ws[addr] = cell;
      maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
    XLSX.utils.book_append_sheet(wb, ws, (s.name || tx("Лист")).slice(0, 31));
  }
  return XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
}

export function xlsxToSheets(base64) {
  const wb = XLSX.read(base64, { type: 'base64', cellFormula: true });
  return wb.SheetNames.map((name, i) => {
    const ws = wb.Sheets[name];
    const celldata = [];
    const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { e: { r: 0, c: 0 } };
    for (const addr of Object.keys(ws)) {
      if (addr[0] === '!') continue;
      const cell = ws[addr];
      const { r, c } = XLSX.utils.decode_cell(addr);
      const v = { v: cell.v, m: cell.w ?? String(cell.v ?? ''), ct: { fa: 'General', t: cell.t === 'n' ? 'n' : 'g' } };
      if (cell.f) v.f = '=' + cell.f;
      celldata.push({ r, c, v });
    }
    return { name, id: 's' + i + Date.now(), order: i, status: i === 0 ? 1 : 0, celldata, row: Math.max(100, range.e.r + 20), column: Math.max(30, range.e.c + 5), config: {} };
  });
}

export function csvToSheets(text) {
  const wb = XLSX.read(text, { type: 'string' });
  return xlsxToSheets(XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }));
}

export default function SheetEditor({ doc, onChange }) {
  // Workbook неуправляемый: начальные данные берём один раз (компонент пересоздаётся по key=doc.id)
  const initial = useMemo(() => (doc.sheets?.length ? doc.sheets : emptySheets()), [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = useRef(null);
  const timer = useRef(0);
  const cb = useRef(onChange);
  cb.current = onChange;
  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current) { const v = pending.current; pending.current = null; cb.current(compactSheets(v)); }
  };
  useEffect(() => {
    window.addEventListener('poe-flush-editors', flush);
    return () => { window.removeEventListener('poe-flush-editors', flush); flush(); };
  }, []);
  return (
    <div className="sheet-host">
      <Workbook
        data={initial}
        lang="en"
        showToolbar
        showFormulaBar
        onChange={(sheets) => {
          pending.current = sheets;
          clearTimeout(timer.current);
          timer.current = setTimeout(flush, 400);
        }}
      />
    </div>
  );
}
