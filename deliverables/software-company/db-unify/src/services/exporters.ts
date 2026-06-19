import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { ResultRow } from '../types/result';

/**
 * Export data as CSV file.
 */
export function exportCsv(rows: ResultRow[], columns: string[], filename: string): void {
  const data = rows.map((row) => {
    const obj: Record<string, any> = {};
    columns.forEach((col) => {
      const cellValue = row.values[col];
      obj[col] = cellValue ? cellValue.value : '';
    });
    return obj;
  });

  const csv = Papa.unparse(data, { columns });
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${filename}.csv`);
}

/**
 * Export data as Excel file with multiple sheets.
 */
export function exportExcel(
  sheets: { name: string; rows: ResultRow[]; columns: string[] }[],
  filename: string
): void {
  const wb = XLSX.utils.book_new();

  sheets.forEach(({ name, rows, columns }) => {
    const data = rows.map((row) => {
      const obj: Record<string, any> = {};
      columns.forEach((col) => {
        const cellValue = row.values[col];
        obj[col] = cellValue ? cellValue.value : '';
      });
      return obj;
    });

    const ws = XLSX.utils.json_to_sheet(data, { header: columns });
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31)); // Sheet name max 31 chars
  });

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  downloadBlob(blob, `${filename}.xlsx`);
}

/**
 * Export data as JSON file.
 */
export function exportJson(rows: ResultRow[], columns: string[], filename: string): void {
  const data = rows.map((row) => {
    const obj: Record<string, any> = {};
    columns.forEach((col) => {
      const cellValue = row.values[col];
      obj[col] = cellValue ? cellValue.value : '';
    });
    return obj;
  });
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob(['\uFEFF' + json], { type: 'application/json;charset=utf-8;' });
  downloadBlob(blob, `${filename}.json`);
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
