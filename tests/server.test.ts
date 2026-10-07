import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

test('giao diện: tải tệp, xem tiến độ, tải kết quả', async () => {
  const port = String(33000 + Math.floor(Math.random() * 20000));
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: process.cwd(), env: { ...process.env, PORT: port }, stdio: 'ignore' });
  try {
    let online = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try { const r = await fetch(base); online = r.ok; if (online) { assert.match(await r.text(), /Đối chiếu dữ liệu/); assert.match(r.headers.get('content-security-policy') ?? '', /img-src 'self' data:/); break; } }
      catch { await wait(100); }
    }
    assert.ok(online, 'máy chủ cần khởi động');
    const form = new FormData();
    form.append('input', new Blob([await readFile(join('examples', 'input.txt'))]), 'input.txt');
    form.append('table', new Blob([await readFile(join('examples', 'companies.csv'))]), 'companies.csv');
    form.append('format', 'csv'); form.append('concurrency', '1'); form.append('delayMs', '0');
    const response = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { Origin: base }, body: form });
    assert.equal(response.status, 202);
    const { id } = await response.json() as { id: string };
    let status = '';
    for (let attempt = 0; attempt < 60; attempt++) {
      const result = await (await fetch(`${base}/api/jobs/${id}`)).json() as { state: string; error?: string; completed: number };
      status = result.state;
      if (status === 'error') throw Error(result.error);
      if (status === 'done') { assert.equal(result.completed, 4); break; }
      await wait(100);
    }
    assert.equal(status, 'done');
    const download = await fetch(`${base}/api/jobs/${id}/download`);
    assert.equal(download.status, 200);
    assert.match(await download.text(), /not_found/);
    const forbidden = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { Origin: 'http://evil.invalid' } });
    assert.equal(forbidden.status, 403);
    const withoutTable = new FormData();
    withoutTable.append('input', new Blob([await readFile(join('examples', 'input.txt'))]), 'input.txt');
    withoutTable.append('table', new Blob([]), ''); // Empty optional file sent by some browsers.
    withoutTable.append('format', 'csv'); withoutTable.append('concurrency', '1'); withoutTable.append('delayMs', '0');
    const noTableResponse = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { Origin: base }, body: withoutTable });
    assert.equal(noTableResponse.status, 202);
    const emptyInput = new FormData();
    emptyInput.append('input', new Blob([]), 'empty.txt');
    emptyInput.append('format', 'csv'); emptyInput.append('concurrency', '1'); emptyInput.append('delayMs', '0');
    const emptyResponse = await fetch(`${base}/api/jobs`, { method: 'POST', headers: { Origin: base }, body: emptyInput });
    assert.equal(emptyResponse.status, 400);
    assert.match(JSON.stringify(await emptyResponse.json()), /Tệp đầu vào trống/);
  } finally { child.kill(); }
});
