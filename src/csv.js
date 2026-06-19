import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * @param {unknown} value
 */
function escapeCsv(value) {
  const str = value == null ? '' : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * @param {string} filePath
 * @returns {Promise<Record<string, string>[]>}
 */
export async function readCsv(filePath) {
  const content = await readFile(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    /** @type {Record<string, string>} */
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx]?.trim() ?? '';
    });
    rows.push(row);
  }

  return rows;
}

/**
 * @param {string} filePath
 * @param {string[]} headers
 * @param {Record<string, unknown>[]} rows
 */
export async function writeCsv(filePath, headers, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsv(row[h])).join(','));
  }

  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}
