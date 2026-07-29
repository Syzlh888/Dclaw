/** 流式 CSV / TSV / SQL / JSON / XLSX 导出器。 */
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { transformValue, toSqlLiteral, valueToText } from '../transformer.mjs';
import { createRequire } from 'node:module';

// 加载 exceljs（cjs bundle 不支持 top-level await）
// 未安装时降级为 CSV
const _require = createRequire(import.meta.url);
let ExcelJS = null;
try {
  ExcelJS = _require('exceljs');
} catch (err) {
  console.warn('[fileExporters] exceljs 未安装，XLSX 导出将降级为 CSV:', err.message);
}

let iconvPromise;
async function encodeText(text, encoding) {
  const normalized = String(encoding || 'utf-8').toLowerCase();
  if (!['gbk', 'gb2312', 'cp936'].includes(normalized)) return Buffer.from(text, 'utf8');
  try {
    iconvPromise ||= import('iconv-lite');
    const iconv = await iconvPromise;
    return (iconv.default || iconv).encode(text, 'gbk');
  } catch {
    // iconv-lite 是可选的运行时依赖；没有它时仍输出合法 UTF-8，而不是丢失数据。
    return Buffer.from(text, 'utf8');
  }
}

function columnsOf(columns = []) {
  return columns.map((column, index) => ({
    name: column.name ?? column.column_name ?? column.sourceName ?? String(column),
    type: column.type ?? column.data_type ?? 'text',
    targetType: column.targetType ?? column.target_type ?? column.type ?? column.data_type ?? 'text',
    index,
  }));
}

function rowValue(row, column, index) {
  if (Array.isArray(row)) return row[index];
  return row?.[column.name];
}

async function* rowIterator(rowsStream) {
  if (!rowsStream) return;
  for await (const item of rowsStream) {
    if (Array.isArray(item)) {
      for (const row of item) yield row;
    } else if (item && Array.isArray(item.rows)) {
      for (const row of item.rows) yield row;
    } else {
      yield item;
    }
  }
}

function partialPath(outputPath) {
  const ext = path.extname(outputPath);
  return path.join(path.dirname(outputPath), `${path.basename(outputPath, ext)}_partial${ext}`);
}

async function movePartial(outputPath) {
  try {
    if (fs.existsSync(outputPath)) await fs.promises.rename(outputPath, partialPath(outputPath));
  } catch { /* best effort */ }
}

async function withTextWriter(outputPath, encoding, writerFn) {
  const stream = fs.createWriteStream(outputPath, { flags: 'w' });
  let streamError;
  stream.on('error', (error) => { streamError = error; });
  const write = async (text) => {
    if (streamError) throw streamError;
    const ok = stream.write(await encodeText(String(text), encoding));
    if (!ok) await once(stream, 'drain');
    if (streamError) throw streamError;
  };
  try {
    await writerFn(write);
    if (streamError) throw streamError;
    stream.end();
    await once(stream, 'finish');
    if (streamError) throw streamError;
  } catch (error) {
    stream.destroy();
    await movePartial(outputPath);
    throw error;
  }
}

async function fileStats(outputPath, started, totalRows, warnings = []) {
  const stat = await fs.promises.stat(outputPath);
  return { totalRows, durationMs: Date.now() - started, fileSize: stat.size, warnings };
}

function escapeDelimited(value, delimiter, quote) {
  const text = valueToText(value);
  if (!quote) return text;
  if (text.includes(delimiter) || text.includes(quote) || /[\r\n]/.test(text)) {
    return `${quote}${text.replaceAll(quote, quote + quote)}${quote}`;
  }
  return text;
}

async function exportDelimited(rowsStream, columns, outputPath, options = {}, delimiter = ',') {
  const started = Date.now();
  const cols = columnsOf(columns);
  const encoding = options.encoding || 'utf-8';
  const quote = options.quote === undefined ? '"' : options.quote;
  const includeHeader = options.includeHeader !== false;
  let totalRows = 0;
  await withTextWriter(outputPath, encoding, async (write) => {
    if (includeHeader) await write(`${cols.map((column) => escapeDelimited(column.name, delimiter, quote)).join(delimiter)}\n`);
    for await (const row of rowIterator(rowsStream)) {
      const values = cols.map((column, index) => {
        const value = transformValue(rowValue(row, column, index), column.type, column.targetType);
        return escapeDelimited(value, delimiter, quote);
      });
      await write(`${values.join(delimiter)}\n`);
      totalRows += 1;
      if (options.onRow) await options.onRow(totalRows);
    }
  });
  const warnings = totalRows > 500000 ? ['行数超过 50 万，建议改用数据库导出或分批导出'] : [];
  return fileStats(outputPath, started, totalRows, warnings);
}

export async function exportCsv(rowsStream, columns, outputPath, options = {}) {
  return exportDelimited(rowsStream, columns, outputPath, options, options.delimiter || ',');
}

export async function exportTsv(rowsStream, columns, outputPath, options = {}) {
  return exportDelimited(rowsStream, columns, outputPath, { ...options, delimiter: '\t' }, '\t');
}

export async function exportSql(rowsStream, columns, outputPath, options = {}) {
  const started = Date.now();
  const cols = columnsOf(columns);
  const tableName = options.tableName || 'Data';
  const quoteIdentifier = (name) => `"${String(name).replaceAll('"', '""')}"`;
  const header = [
    `-- DClaw temporary export ${new Date().toISOString()}`,
    `-- Source table: ${tableName}`,
    `SET client_encoding TO 'UTF8';`,
    '',
  ].join('\n');
  let totalRows = 0;
  await withTextWriter(outputPath, 'utf-8', async (write) => {
    await write(`${header}\n`);
    for await (const row of rowIterator(rowsStream)) {
      const values = cols.map((column, index) => toSqlLiteral(transformValue(
        rowValue(row, column, index), column.type, column.targetType
      ))).join(', ');
      await write(`INSERT INTO ${quoteIdentifier(tableName)} (${cols.map((column) => quoteIdentifier(column.name)).join(', ')}) VALUES (${values});\n`);
      totalRows += 1;
      if (options.onRow) await options.onRow(totalRows);
    }
    await write('\nCOMMIT;\n');
  });
  const warnings = totalRows > 500000 ? ['行数超过 50 万，建议分批生成 SQL'] : [];
  return fileStats(outputPath, started, totalRows, warnings);
}

export async function exportJson(rowsStream, columns, outputPath, options = {}) {
  const started = Date.now();
  const cols = columnsOf(columns);
  let totalRows = 0;
  let first = true;
  await withTextWriter(outputPath, options.encoding || 'utf-8', async (write) => {
    await write('[\n');
    for await (const row of rowIterator(rowsStream)) {
      const object = {};
      cols.forEach((column, index) => {
        object[column.name] = transformValue(rowValue(row, column, index), column.type, column.targetType);
      });
      if (!first) await write(',\n');
      first = false;
      await write(JSON.stringify(object, (_key, value) => {
        if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value).toString('base64');
        return value;
      }, options.pretty ? 2 : 0));
      totalRows += 1;
      if (options.onRow) await options.onRow(totalRows);
    }
    await write('\n]\n');
  });
  const warnings = totalRows > 500000 ? ['行数超过 50 万，建议改用数据库导出'] : [];
  return fileStats(outputPath, started, totalRows, warnings);
}

export async function exportXlsx(rowsStream, columns, outputPath, options = {}) {
  // 如果模块顶层未加载到 exceljs（容器环境缺包），降级为 CSV
  if (!ExcelJS) {
    console.warn('[exportXlsx] exceljs 未就绪，降级为 CSV');
    const csvPath = outputPath.replace(/\.xlsx$/i, '.csv');
    return await exportCsv(rowsStream, columns, csvPath, options);
  }
  return await exportXlsxImpl(rowsStream, columns, outputPath, options);
}

async function exportXlsxImpl(rowsStream, columns, outputPath, options = {}) {
  const started = Date.now();
  const cols = columnsOf(columns);
  let totalRows = 0;
  let workbook;
  try {
    workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: outputPath, useStyles: false, useSharedStrings: false });
    const worksheet = workbook.addWorksheet(options.sheetName || 'Data');
    worksheet.addRow(cols.map((column) => column.name)).commit();
    for await (const row of rowIterator(rowsStream)) {
      const values = cols.map((column, index) => {
        const value = transformValue(rowValue(row, column, index), column.type, column.targetType);
        return Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value && typeof value === 'object' ? JSON.stringify(value) : value;
      });
      worksheet.addRow(values).commit();
      totalRows += 1;
      if (options.onRow) await options.onRow(totalRows);
    }
    worksheet.commit();
    await workbook.commit();
  } catch (error) {
    try { await workbook?.commit(); } catch { /* incomplete workbook */ }
    await movePartial(outputPath);
    throw error;
  }
  const warnings = totalRows > 100000 ? ['行数超过 10 万，XLSX 可能较慢，建议分批导出'] : [];
  return fileStats(outputPath, started, totalRows, warnings);
}

export default { exportCsv, exportTsv, exportSql, exportJson, exportXlsx };
