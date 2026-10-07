import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { classify, exportResults, fingerprint, loadTaxTable, processRows, readInputs } from '../src/core.js';

async function dir() { return mkdtemp(join(tmpdir(), 'bulk-lookup-')); }
test('phân loại số mơ hồ, TXT và dữ liệu sai', async () => {
  const path = join(await dir(), 'in.txt');
  await writeFile(path, 'mst:0101234567\nphone:0912345678\n0912345678\nmst:123\n\nmst:0101234567\n');
  const rows = await readInputs(path);
  assert.deepEqual(rows.map(x => x.type), ['mst', 'phone', 'invalid', 'invalid', 'mst']);
  assert.equal(classify('0101234567001'), 'mst');
  assert.equal(classify('0912345678'), 'invalid');
});
test('Excel giữ số 0; không chấp nhận ô dạng số', async () => {
  const path = join(await dir(), 'in.xlsx');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Input');
  ws.addRow(['type', 'value']); ws.addRow(['mst', '0101234567']);
  await wb.xlsx.writeFile(path);
  assert.equal((await readInputs(path))[0].value, '0101234567');
  ws.getRow(2).getCell(2).value = 101234567;
  await wb.xlsx.writeFile(path);
  await assert.rejects(readInputs(path), /Text/);
});
test('Excel danh bạ giữ tên công ty, nhận phone dạng Number an toàn và không đoán đại diện pháp luật', async () => {
  const path = join(await dir(), 'contacts.xlsx');
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('sample');
  ws.addRow(['phone', 'ngay', 'ten_khach_hang', '']);
  ws.addRow([84904461106, '06/10/2026', 'Công ty ví dụ', 'Người ở cột chưa xác định']);
  ws.addRow(['84903282946', '06/10/2026', 'Công ty khác', '']);
  await wb.xlsx.writeFile(path);
  const rows = await readInputs(path);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].value, '0904461106');
  assert.equal(rows[0].originalPhone, '84904461106');
  assert.equal(rows[1].value, '0903282946');
  assert.equal(rows[0].type, 'phone');
  assert.equal(rows[0].companyName, 'Công ty ví dụ');
  assert.equal(rows[0].contactName, '');
  const output = await processRows(rows, undefined, {
    checkpoint: join(await dir(), 'progress.jsonl'), key: 'contacts', concurrency: 1, delayMs: 0,
    phoneLookup: { source: 'test:Zalo', async find() { return 'Tên Zalo'; } },
  });
  assert.equal(output[0].name, 'Tên Zalo');
  assert.equal(output[0].phone, '0904461106');
  assert.equal(output[0].hasPublicInfo, true);
  assert.equal(output[0].legalRepresentative, '');
  assert.match(output[0].representativeStatus ?? '', /Chưa có nguồn xác minh/);
});
test('bảng nội bộ, trùng, tra lỗi, lưu và tiếp tục', async () => {
  const d = await dir(), table = join(d, 'source.csv'), checkpoint = join(d, 'state.jsonl');
  await writeFile(table, 'mst,ten_cong_ty\n0101234567,"Công ty, A"\n');
  const lookup = await loadTaxTable(table);
  const inputs = [
    { value: '0101234567', type: 'mst' as const, line: 1 },
    { value: '0101234567', type: 'mst' as const, line: 2 },
    { value: '0201234567', type: 'mst' as const, line: 3 },
    { value: '0912345678', type: 'phone' as const, line: 4 },
  ];
  let calls = 0;
  const counting = { ...lookup, async find(mst: string) { calls++; return lookup.find(mst); } };
  const key = fingerprint(Buffer.from('input'), lookup.source);
  const opts = { checkpoint, key, concurrency: 2, delayMs: 2 };
  const results = await processRows(inputs, counting, opts);
  assert.deepEqual(results.map(x => x.status), ['found', 'found', 'not_found', 'unavailable']);
  assert.equal(results[0].name, 'Công ty, A'); assert.equal(calls, 2);
  await processRows(inputs, counting, opts); assert.equal(calls, 2);
  await processRows(inputs, counting, { ...opts, key: 'new' }); assert.equal(calls, 4);
  const failed = await processRows([{ value: '0301234567', type: 'mst', line: 5 }],
    { source: 'broken', async find() { throw Error('secret'); } }, { ...opts, key: 'error' });
  assert.equal(failed[0].status, 'lookup_failed'); assert.doesNotMatch(failed[0].error, /secret/);
  const csv = join(d, 'out.csv'), xlsx = join(d, 'out.xlsx');
  await exportResults(csv, results); await exportResults(xlsx, results);
  assert.match(await readFile(csv, 'utf8'), /Công ty, A/);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(xlsx);
  assert.equal(wb.worksheets[0].rowCount, 5);
});
test('giới hạn tốc độ giữa các lượt gọi và tiếp tục lỗi', async () => {
  const checkpoint = join(await dir(), 'state.jsonl'); let tries = 0;
  const rows = [1, 2, 3].map(n => ({ line: n, value: `010123456${n}`, type: 'mst' as const }));
  const times: number[] = [];
  const source = { source: 'test', async find() { times.push(Date.now()); tries++; if (tries === 1) throw Error('offline'); return 'Công ty'; } };
  const options = { checkpoint, key: 'x', concurrency: 3, delayMs: 20 };
  const first = await processRows(rows, source, options);
  assert.equal(first[0].status, 'lookup_failed');
  assert.ok(times[1] - times[0] >= 15 && times[2] - times[1] >= 15);
  const second = await processRows(rows, source, { ...options, retryFailed: true });
  assert.equal(second[0].status, 'found'); assert.equal(tries, 4);
});
test('tra số điện thoại qua provider tùy chọn, phân biệt lỗi và không tìm thấy', async () => {
  const checkpoint = join(await dir(), 'state.jsonl');
  const rows = [
    { line: 1, value: '0912345678', type: 'phone' as const },
    { line: 2, value: '0987654321', type: 'phone' as const },
    { line: 3, value: '0934567890', type: 'phone' as const },
  ];
  const phoneLookup = { source: 'zca-js:Zalo', async find(phone: string) {
    if (phone === rows[2].value) throw Error('internal credentials');
    return phone === rows[0].value ? 'Tên Zalo' : null;
  } };
  const results = await processRows(rows, undefined, { checkpoint, key: 'phones', concurrency: 1, delayMs: 0, phoneLookup });
  assert.deepEqual(results.map(r => r.status), ['found', 'not_found', 'lookup_failed']);
  assert.equal(results[0].name, 'Tên Zalo');
  assert.equal(results[0].source, 'zca-js:Zalo');
  assert.equal(results[0].mst, '');
  assert.doesNotMatch(results[2].error, /credentials/);
});
