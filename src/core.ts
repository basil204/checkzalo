import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, mkdir, open } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { once } from 'node:events';
import ExcelJS from 'exceljs';

export type Kind = 'mst' | 'phone' | 'invalid';
export type Status = 'found' | 'not_found' | 'lookup_failed' | 'unavailable' | 'invalid';

export interface ZaloUserInfo {
  hasPublicInfo: boolean;
  name: string;
  zaloName?: string;
  displayName?: string;
  uid?: string;
  gender?: string;
  avatar?: string;
  cover?: string;
  dob?: string;
  bio?: string;
  isBusiness?: boolean;
}

export interface Input {
  value: string;
  originalPhone?: string;
  type: Kind;
  line: number;
  companyName?: string;
  contactName?: string;
}

export interface Result extends Input {
  originalPhone?: string;
  phone: string;
  hasPublicInfo: boolean;
  hasPublicInfoText: string;
  name: string;
  zaloId?: string;
  gender?: string;
  dob?: string;
  bio?: string;
  avatar?: string;
  mst: string;
  status: Status;
  statusText: string;
  source: string;
  error: string;
  legalRepresentative?: string;
  representativeStatus?: string;
}

export interface Lookup {
  find(mst: string): Promise<string | null>;
  source: string;
}

export interface PhoneLookup {
  find(phone: string): Promise<string | null>;
  check?(phone: string): Promise<ZaloUserInfo | null>;
  source: string;
}

const columns = [
  'line',
  'phone',
  'originalPhone',
  'hasPublicInfoText',
  'name',
  'zaloId',
  'gender',
  'dob',
  'bio',
  'avatar',
  'status',
  'statusText',
  'companyName',
  'contactName',
  'mst',
  'legalRepresentative',
  'representativeStatus',
  'source',
  'error'
] as const;

const tax = /^\d{10}(?:-?\d{3})?$/;
const phoneRegex = /^0\d{9}$/;

export function normalizePhone(raw: string | number | null | undefined): string {
  if (raw == null) return '';
  let str = String(raw).trim();
  str = str.replace(/[\s.\-()]/g, '');
  if (str.startsWith('+840')) {
    str = '0' + str.slice(4);
  } else if (str.startsWith('+84')) {
    str = '0' + str.slice(3);
  } else if (str.startsWith('840') && str.length >= 12) {
    str = '0' + str.slice(3);
  } else if (str.startsWith('84') && str.length >= 11) {
    str = '0' + str.slice(2);
  } else if (str.length === 9 && /^[35789]\d{8}$/.test(str)) {
    str = '0' + str;
  }
  if (str.startsWith('00')) {
    str = '0' + str.slice(2);
  }
  return str;
}

export function isPhone(value: string | number | null | undefined): boolean {
  if (value == null) return false;
  const norm = normalizePhone(value);
  return phoneRegex.test(norm);
}

export function classify(value: string, explicit?: string): Kind {
  const v = value.trim();
  if (explicit && !['mst', 'phone'].includes(explicit.toLowerCase())) return 'invalid';
  const kind = explicit?.toLowerCase();
  if (kind === 'mst') return tax.test(v) ? 'mst' : 'invalid';
  if (kind === 'phone') {
    const norm = normalizePhone(v);
    return phoneRegex.test(norm) ? 'phone' : 'invalid';
  }
  const cleaned = v.replace(/[\s.\-()]/g, '');
  if (/^(?:\+84|84)\d{9}$/.test(cleaned)) return 'phone';
  if (/^\d{13}$/.test(v) || /^\d{10}-\d{3}$/.test(v)) return 'mst';
  return 'invalid';
}

function cell(row: ExcelJS.Row, index: number): string {
  const v = row.getCell(index).value;
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('text' in v) return String(v.text);
    if ('result' in v) return String(v.result ?? '');
    throw new Error(`Ô ${row.number}:${index} không phải văn bản; định dạng cột là Text để giữ số 0 đầu.`);
  }
  if (typeof v === 'number') throw new Error(`Ô ${row.number}:${index} là số; định dạng cột là Text để giữ số 0 đầu.`);
  return String(v).trim();
}

function phoneCell(row: ExcelJS.Row, index: number): string {
  const v = row.getCell(index).value;
  if (typeof v === 'number') {
    if (!Number.isSafeInteger(v)) throw new Error(`Số điện thoại dạng Number không an toàn ở dòng ${row.number}; hãy dùng định dạng Text.`);
    return String(v);
  }
  return cell(row, index);
}

export async function readInputs(path: string): Promise<Input[]> {
  const rows: Input[] = [];
  const ext = extname(path).toLowerCase();

  if (ext === '.txt' || ext === '.csv') {
    const text = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).filter(r => r.trim());
    const hasAnyMst = lines.some(r => /^\s*mst\s*[:;,\t]/i.test(r));

    lines.forEach((raw, i) => {
      const match = raw.trim().match(/^(mst|phone|sdt|tel)\s*[:;,\t]\s*(.*)$/i);
      const rawVal = (match ? match[2] : raw).trim();
      let explicitType = match ? (match[1].toLowerCase() === 'mst' ? 'mst' : 'phone') : undefined;

      let type: Kind;
      if (explicitType) {
        type = classify(rawVal, explicitType);
      } else if (!hasAnyMst && isPhone(rawVal)) {
        type = 'phone';
      } else {
        type = classify(rawVal);
      }

      let val = rawVal;
      let origPhone: string | undefined;
      if (type === 'phone') {
        origPhone = rawVal;
        val = normalizePhone(rawVal);
      }

      rows.push({
        value: val,
        originalPhone: origPhone,
        type,
        line: i + 1
      });
    });
  } else if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const sheet = wb.worksheets[0];
    if (!sheet) throw new Error('Tệp Excel không có sheet.');
    const headers = Array.from({ length: sheet.columnCount }, (_, i) => cell(sheet.getRow(1), i + 1).toLowerCase());

    if (headers[0] === 'type' && headers[1] === 'value') {
      sheet.eachRow((row, n) => {
        if (n === 1) return;
        const typeStr = cell(row, 1);
        const rawVal = cell(row, 2);
        if (typeStr || rawVal) {
          const type = classify(rawVal, typeStr);
          const origPhone = type === 'phone' ? rawVal : undefined;
          const val = type === 'phone' ? normalizePhone(rawVal) : rawVal;
          rows.push({ value: val, originalPhone: origPhone, type, line: n });
        }
      });
    } else {
      const phoneHeaders = ['phone', 'sdt', 'so_dien_thoai', 'dien_thoai', 'mobile', 'tel', 'phone_number', 'so_dt', 'hotline'];
      const phoneIdx = headers.findIndex(h => phoneHeaders.includes(h));
      const phoneColumn = phoneIdx >= 0 ? phoneIdx + 1 : 1;
      const companyColumn = headers.findIndex(h => ['ten_khach_hang', 'khach_hang', 'ten_cong_ty', 'company'].includes(h)) + 1;
      const contactColumn = headers.findIndex(h => ['ten_nguoi_lien_he', 'nguoi_lien_he', 'ten', 'ho_ten', 'name'].includes(h)) + 1;

      sheet.eachRow((row, n) => {
        if (n === 1 && phoneIdx >= 0) return; // skip header row if headers were found
        const rawVal = phoneCell(row, phoneColumn).trim();
        if (n === 1 && !isPhone(rawVal) && !phoneRegex.test(normalizePhone(rawVal))) return; // skip generic header row

        const companyName = companyColumn ? cell(row, companyColumn) : '';
        const contactName = contactColumn ? cell(row, contactColumn) : '';
        if (rawVal || companyName || contactName) {
          const norm = normalizePhone(rawVal);
          const type = isPhone(rawVal) ? 'phone' : classify(rawVal, 'phone');
          rows.push({
            value: norm || rawVal,
            originalPhone: rawVal,
            type,
            line: n,
            companyName,
            contactName
          });
        }
      });
    }
  } else {
    throw new Error('Chỉ nhận .txt, .csv hoặc .xlsx');
  }

  return rows;
}

export async function loadTaxTable(path: string): Promise<Lookup> {
  const table = new Map<string, string>();
  const add = (mst: string, name: string, line: number) => {
    if (classify(mst, 'mst') !== 'mst' || !name.trim()) throw new Error(`Dữ liệu MST sai ở dòng ${line}`);
    if (table.has(mst) && table.get(mst) !== name.trim()) throw new Error(`MST trùng nhưng tên khác nhau ở dòng ${line}`);
    table.set(mst, name.trim());
  };

  const ext = extname(path).toLowerCase();
  if (ext === '.xlsx') {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const sheet = wb.worksheets[0];
    if (!sheet || cell(sheet.getRow(1), 1).toLowerCase() !== 'mst' || cell(sheet.getRow(1), 2).toLowerCase() !== 'ten_cong_ty')
      throw new Error('Bảng nguồn cần tiêu đề mst, ten_cong_ty.');
    sheet.eachRow((row, n) => { if (n > 1 && (cell(row, 1) || cell(row, 2))) add(cell(row, 1), cell(row, 2), n); });
  } else if (ext === '.csv') {
    const content = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '');
    const lines = content.split(/\r?\n/).filter(Boolean);
    if (lines.shift()?.trim().toLowerCase() !== 'mst,ten_cong_ty') throw new Error('CSV nguồn cần tiêu đề mst,ten_cong_ty.');
    lines.forEach((line, i) => {
      const fields = parseCsv(line);
      if (fields.length !== 2) throw new Error(`CSV nguồn sai ở dòng ${i + 2}`);
      add(fields[0], fields[1], i + 2);
    });
  } else {
    throw new Error('Bảng nguồn phải là .csv hoặc .xlsx');
  }

  const digest = createHash('sha256').update(await readFile(path)).digest('hex');
  return { source: `bang-noi-bo:${digest.slice(0, 12)}`, async find(mst) { return table.get(mst) ?? null; } };
}

export function parseCsv(line: string): string[] {
  const out: string[] = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else if (!quoted && value !== '') throw new Error('CSV sai dấu nháy');
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { out.push(value); value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('CSV thiếu dấu nháy đóng');
  out.push(value);
  return out;
}

export async function processRows(inputs: Input[], lookup: Lookup | undefined, options: {
  concurrency: number;
  delayMs: number;
  checkpoint: string;
  key: string;
  retryFailed?: boolean;
  onProgress?: (completed: number, total: number, latestResult?: Result) => void;
  phoneLookup?: PhoneLookup;
}): Promise<Result[]> {
  const { concurrency, delayMs, checkpoint, key } = options;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 20 || !Number.isSafeInteger(delayMs) || delayMs < 0)
    throw new Error('concurrency phải từ 1–20, delay-ms phải >= 0.');

  await mkdir(dirname(checkpoint), { recursive: true });
  const results = new Map<number, Result>();
  const byLine = new Map(inputs.map(item => [item.line, item]));

  try {
    const raw = await readFile(checkpoint);
    const finalNewline = raw.lastIndexOf(10);
    if (finalNewline !== raw.length - 1) {
      const file = await open(checkpoint, 'r+');
      try { await file.truncate(finalNewline + 1); } finally { await file.close(); }
    }
    for (const line of raw.subarray(0, finalNewline + 1).toString('utf8').split('\n')) {
      if (!line) continue;
      try {
        const item = JSON.parse(line) as { key: string; result: Result };
        const original = byLine.get(item.result.line);
        if (item.key === key && original?.value === item.result.value && original.type === item.result.type && original.companyName === item.result.companyName)
          results.set(item.result.line, item.result);
      } catch { /* ignore damaged line */ }
    }
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }

  const handle = await open(checkpoint, 'a');
  const cache = new Map<string, Promise<{ name: string | null; zaloInfo?: ZaloUserInfo | null }>>();
  let next = 0, lastStart = 0;
  let gate = Promise.resolve();

  const schedule = () => {
    const reservation = gate.then(async () => {
      const wait = Math.max(0, lastStart + delayMs - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastStart = Date.now();
    });
    gate = reservation;
    return reservation;
  };

  const pending = inputs.filter(x => !results.has(x.line) || (options.retryFailed && results.get(x.line)?.status === 'lookup_failed'));
  options.onProgress?.(results.size, inputs.length);

  async function worker() {
    while (next < pending.length) {
      const item = pending[next++];
      const normPhone = item.type === 'phone' ? normalizePhone(item.value) : item.value;
      const origPhone = item.type === 'phone' ? (item.originalPhone || item.value) : '';

      let result: Result = {
        ...item,
        value: normPhone,
        phone: item.type === 'phone' ? normPhone : '',
        originalPhone: origPhone,
        hasPublicInfo: false,
        hasPublicInfoText: 'Không có thông tin public',
        name: '',
        zaloId: '',
        gender: '',
        dob: '',
        bio: '',
        avatar: '',
        mst: item.type === 'mst' ? item.value : '',
        status: 'invalid',
        statusText: 'Sai định dạng',
        source: '',
        error: '',
        legalRepresentative: '',
        representativeStatus: item.companyName ? 'Chưa có nguồn xác minh đại diện pháp luật' : ''
      };

      if (item.type === 'invalid') {
        result.error = 'Sai định dạng hoặc số điện thoại không hợp lệ';
        result.hasPublicInfoText = 'Không hợp lệ';
        result.statusText = 'Sai định dạng';
      } else if (item.type === 'phone' && !options.phoneLookup) {
        result.status = 'unavailable';
        result.statusText = 'Chưa kết nối Zalo';
        result.hasPublicInfoText = 'Chưa kiểm tra';
        result.error = 'Chưa kết nối tài khoản Zalo';
      } else if (item.type === 'mst' && !lookup) {
        result.status = 'unavailable';
        result.statusText = 'Chưa có bảng MST';
        result.error = 'Chưa cung cấp bảng MST được phép sử dụng';
      } else {
        const provider = item.type === 'phone' ? options.phoneLookup! : lookup!;
        result.source = provider.source;
        try {
          const cacheKey = `${item.type}:${normPhone}`;
          let task = cache.get(cacheKey);
          if (!task) {
            task = (async () => {
              await schedule();
              if (item.type === 'phone' && options.phoneLookup) {
                if (typeof options.phoneLookup.check === 'function') {
                  const checkInfo = await options.phoneLookup.check(normPhone);
                  return { name: checkInfo?.name ?? null, zaloInfo: checkInfo };
                }
                const name = await options.phoneLookup.find(normPhone);
                return { name, zaloInfo: name ? { hasPublicInfo: true, name } : null };
              }
              const name = await lookup!.find(item.value);
              return { name, zaloInfo: null };
            })();
            cache.set(cacheKey, task);
          }

          const res = await task;
          const { name, zaloInfo } = res;

          if (item.type === 'phone') {
            if (zaloInfo && (zaloInfo.hasPublicInfo || zaloInfo.name || zaloInfo.uid)) {
              result.hasPublicInfo = true;
              result.hasPublicInfoText = 'Có thông tin public';
              result.name = zaloInfo.name || '';
              result.zaloId = zaloInfo.uid || '';
              result.gender = zaloInfo.gender || '';
              result.dob = zaloInfo.dob || '';
              result.bio = zaloInfo.bio || '';
              result.avatar = zaloInfo.avatar || '';
              result.status = 'found';
              result.statusText = 'Có thông tin public';
            } else if (name) {
              result.hasPublicInfo = true;
              result.hasPublicInfoText = 'Có thông tin public';
              result.name = name;
              result.status = 'found';
              result.statusText = 'Có thông tin public';
            } else {
              result.hasPublicInfo = false;
              result.hasPublicInfoText = 'Không có thông tin public';
              result.status = 'not_found';
              result.statusText = 'Không tìm thấy / Riêng tư';
            }
          } else {
            result = {
              ...result,
              name: name ?? '',
              status: name ? 'found' : 'not_found',
              statusText: name ? 'Tìm thấy trong bảng' : 'Không tìm thấy'
            };
          }
        } catch {
          cache.delete(`${item.type}:${normPhone}`);
          result.status = 'lookup_failed';
          result.hasPublicInfoText = 'Lỗi tra cứu';
          result.statusText = 'Lỗi tra cứu';
          result.error = 'Nguồn tra cứu gặp lỗi; có thể chạy lại sau';
        }
      }

      const write = gateWrite.then(async () => {
        await handle.writeFile(JSON.stringify({ key, result }) + '\n');
        await handle.sync();
        results.set(item.line, result);
        options.onProgress?.(results.size, inputs.length, result);
      });
      gateWrite = write;
      await write;
    }
  }

  let gateWrite = Promise.resolve();
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    await handle.close();
  }

  return inputs.map(x => results.get(x.line)!);
}

function csv(value: unknown): string {
  return `"${String(value ?? '').replaceAll('"', '""').replace(/^[=+\-@\t\r]/, "'$&")}"`;
}

export async function exportResults(path: string, results: Result[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const ext = extname(path).toLowerCase();

  if (ext === '.csv') {
    const stream = createWriteStream(path, { encoding: 'utf8' });
    stream.write('\uFEFF' + columns.join(',') + '\r\n');
    for (const result of results) {
      if (!stream.write(columns.map(k => csv(result[k])).join(',') + '\r\n')) {
        await once(stream, 'drain');
      }
    }
    stream.end();
    await once(stream, 'finish');
  } else if (ext === '.xlsx') {
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path });
    const sheet = wb.addWorksheet('KiemTraZalo');
    sheet.columns = [
      { header: 'STT', key: 'line', width: 8 },
      { header: 'Số điện thoại (đầu 0)', key: 'phone', width: 22 },
      { header: 'Số gốc (đầu 84)', key: 'originalPhone', width: 20 },
      { header: 'Thông tin Zalo public', key: 'hasPublicInfoText', width: 24 },
      { header: 'Tên Zalo', key: 'name', width: 26 },
      { header: 'Zalo UID', key: 'zaloId', width: 22 },
      { header: 'Giới tính', key: 'gender', width: 14 },
      { header: 'Ngày sinh', key: 'dob', width: 16 },
      { header: 'Tiểu sử (Bio)', key: 'bio', width: 30 },
      { header: 'Ảnh đại diện (Avatar)', key: 'avatar', width: 35 },
      { header: 'Trạng thái', key: 'statusText', width: 24 },
      { header: 'Tên khách hàng', key: 'companyName', width: 24 },
      { header: 'Tên người liên hệ', key: 'contactName', width: 22 },
      { header: 'Ghi chú / Lỗi', key: 'error', width: 28 },
    ];
    for (const result of results) {
      const rowData = {
        ...result,
        phone: result.phone ? String(result.phone) : '',
        originalPhone: result.originalPhone ? String(result.originalPhone) : ''
      };
      sheet.addRow(rowData).commit();
    }
    sheet.commit();
    await wb.commit();
  } else {
    throw new Error('Đầu ra phải là .csv hoặc .xlsx');
  }
}

export function fingerprint(input: Buffer, source: string): string {
  return createHash('sha256').update(input).update('\0').update(source).digest('hex');
}
