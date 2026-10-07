import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import formidable from 'formidable';
import { exportResults, fingerprint, loadTaxTable, processRows, readInputs, normalizePhone, isPhone, type Result } from './core.js';
import { ZaloSession } from './zalo.js';

type Job = {
  id: string;
  state: 'running' | 'done' | 'error';
  completed: number;
  total: number;
  error?: string;
  output?: string;
  format: 'csv' | 'xlsx';
  folder: string;
  results: Result[];
};

export type CachedZaloContact = {
  phone: string;
  originalPhone?: string;
  name: string;
  zaloId?: string;
  gender?: string;
  dob?: string;
  bio?: string;
  avatar?: string;
  companyName?: string;
  contactName?: string;
  savedAt: number;
};

const CACHE_FILE = resolve(process.cwd(), '.zalo_contacts_cache.json');
let contactsCache = new Map<string, CachedZaloContact>();

async function loadContactsCache() {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8');
    const items = JSON.parse(raw) as CachedZaloContact[];
    if (Array.isArray(items)) {
      contactsCache = new Map(items.map(c => [c.phone, c]));
    }
  } catch {}
}

async function saveContactsCache() {
  try {
    const list = Array.from(contactsCache.values());
    await writeFile(CACHE_FILE, JSON.stringify(list, null, 2), 'utf8');
  } catch {}
}

function addContactToCache(result: Result) {
  if (!result.hasPublicInfo && result.status !== 'found') return;
  const phone = result.phone || result.value;
  if (!phone) return;
  contactsCache.set(phone, {
    phone,
    originalPhone: result.originalPhone || phone,
    name: result.name || '',
    zaloId: result.zaloId || '',
    gender: result.gender || '',
    dob: result.dob || '',
    bio: result.bio || '',
    avatar: result.avatar || '',
    companyName: result.companyName || '',
    contactName: result.contactName || '',
    savedAt: Date.now()
  });
}

const jobs = new Map<string, Job>();
const zalo = new ZaloSession();
const host = '127.0.0.1';
const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('PORT không hợp lệ');

function respond(res: ServerResponse, code: number, data: object) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function fail(res: ServerResponse, code: number, message: string) {
  respond(res, code, { error: message });
}

function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  const hostHeader = req.headers.host;
  if (origin === `http://${host}:${port}` || origin === `http://localhost:${port}`) return true;
  if (hostHeader && (origin === `http://${hostHeader}` || origin === `https://${hostHeader}`)) return true;
  if (origin.endsWith('.trycloudflare.com') || origin.endsWith('.cloudflare.com')) return true;
  return false;
}

function one(fields: Record<string, string[] | undefined>, name: string): string | undefined {
  return fields[name]?.[0];
}

async function start(req: IncomingMessage, res: ServerResponse) {
  if (!isAllowedOrigin(req)) return fail(res, 403, 'Yêu cầu không cùng nguồn với giao diện.');
  const folder = await mkdtemp(join(tmpdir(), 'zalo-checker-ui-'));

  try {
    const [fields, files] = await formidable({
      uploadDir: folder,
      keepExtensions: true,
      maxFileSize: 20 * 1024 * 1024,
      maxTotalFileSize: 40 * 1024 * 1024,
      maxFiles: 2,
      allowEmptyFiles: true,
      minFileSize: 0
    }).parse(req);

    const input = files.input?.[0];
    const optionalTable = files.table?.[0];
    const table = optionalTable?.size && optionalTable.originalFilename ? optionalTable : undefined;
    const format = (one(fields, 'format') === 'csv' ? 'csv' : 'xlsx') as 'csv' | 'xlsx';
    const useZalo = one(fields, 'useZalo') === 'on' || one(fields, 'useZalo') === 'true';
    const concurrency = Number(one(fields, 'concurrency') || '1');
    const delayMs = Number(one(fields, 'delayMs') || '1500');
    const phoneText = one(fields, 'phoneText')?.trim();

    let inputPath = input?.filepath;
    if ((!input || !input.size) && phoneText) {
      inputPath = join(folder, 'pasted_phones.txt');
      await writeFile(inputPath, phoneText, 'utf8');
    } else if (!input || !input.size) {
      throw Error('Tệp đầu vào trống; vui lòng chọn tệp TXT hoặc XLSX có dữ liệu.');
    }

    if (inputPath && !['.txt', '.xlsx', '.csv'].includes(extname(input?.originalFilename ?? inputPath).toLowerCase())) {
      throw Error('Tệp đầu vào phải là TXT, CSV hoặc XLSX.');
    }
    if (optionalTable?.originalFilename && !optionalTable.size) {
      throw Error('Bảng MST đã chọn là tệp trống. Hãy chọn tệp có dữ liệu hoặc bỏ chọn bảng MST.');
    }
    if (table && !['.csv', '.xlsx'].includes(extname(table.originalFilename ?? '').toLowerCase())) {
      throw Error('Bảng MST phải là CSV hoặc XLSX.');
    }
    if (format !== 'csv' && format !== 'xlsx') throw Error('Định dạng đầu ra phải là CSV hoặc XLSX.');
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 20 || !Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 60000) {
      throw Error('Số tác vụ phải từ 1–20; thời gian chờ từ 0–60000 ms.');
    }
    if (useZalo && zalo.status.phase !== 'ready') {
      throw Error('Vui lòng đăng nhập Zalo bằng QR trước khi tra số điện thoại.');
    }
    if (useZalo && (concurrency !== 1 || delayMs < 1500)) {
      throw Error('Tra Zalo giới hạn 1 tác vụ đồng thời, cách nhau tối thiểu 1500 ms.');
    }

    const id = randomUUID();
    const job: Job = {
      id,
      state: 'running',
      completed: 0,
      total: 0,
      folder,
      format,
      results: []
    };
    jobs.set(id, job);
    respond(res, 202, { id });

    void (async () => {
      try {
        const lookup = table ? await loadTaxTable(table.filepath) : undefined;
        const rows = await readInputs(inputPath!);
        job.total = rows.length;
        const key = fingerprint(await readFile(inputPath!), `${lookup?.source ?? 'no-table'}:${useZalo ? 'zalo' : 'no-zalo'}`);
        const results = await processRows(rows, lookup, {
          key,
          concurrency,
          delayMs,
          checkpoint: join(folder, 'state.checkpoint.jsonl'),
          phoneLookup: useZalo ? zalo : undefined,
          onProgress: (done, total, latestResult) => {
            job.completed = done;
            job.total = total;
            if (latestResult) {
              job.results.push(latestResult);
              if (latestResult.hasPublicInfo || latestResult.status === 'found') {
                addContactToCache(latestResult);
              }
            }
          }
        });
        job.results = results;
        job.output = join(folder, `ket-qua-zalo.${format}`);
        await exportResults(job.output, results);

        const foundResults = results.filter(r => r.hasPublicInfo || r.status === 'found');
        const txtPath = join(folder, 'chi-sdt-co-zalo.txt');
        await writeFile(txtPath, foundResults.map(r => r.phone || r.value).join('\r\n'), 'utf8');

        const xlsxFoundPath = join(folder, 'danh-sach-co-zalo.xlsx');
        await exportResults(xlsxFoundPath, foundResults);

        await saveContactsCache();
        job.state = 'done';
      } catch (error) {
        job.state = 'error';
        job.error = error instanceof Error ? error.message : 'Lỗi xử lý không rõ';
      }
    })();
  } catch (error) {
    await rm(folder, { recursive: true, force: true });
    fail(res, 400, error instanceof Error ? error.message : 'Không thể nhận tệp.');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${host}:${port}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self' data: https:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https: http:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
      });
      res.end(await readFile(new URL('../public/index.html', import.meta.url)));
    } else if (req.method === 'GET' && url.pathname === '/app.js') {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(await readFile(new URL('../public/app.js', import.meta.url)));
    } else if (req.method === 'GET' && url.pathname === '/style.css') {
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(await readFile(new URL('../public/style.css', import.meta.url)));
    } else if (req.method === 'GET' && url.pathname === '/api/zalo') {
      respond(res, 200, zalo.status);
    } else if (req.method === 'POST' && url.pathname === '/api/zalo/connect') {
      if (!isAllowedOrigin(req)) return fail(res, 403, 'Yêu cầu không cùng nguồn với giao diện.');
      zalo.connect();
      respond(res, 202, zalo.status);
    } else if (req.method === 'POST' && url.pathname === '/api/zalo/disconnect') {
      if (!isAllowedOrigin(req)) return fail(res, 403, 'Yêu cầu không cùng nguồn với giao diện.');
      zalo.disconnect();
      respond(res, 200, zalo.status);
    } else if (req.method === 'POST' && url.pathname === '/api/check-single') {
      if (!isAllowedOrigin(req)) return fail(res, 403, 'Yêu cầu không cùng nguồn với giao diện.');
      if (zalo.status.phase !== 'ready') return fail(res, 400, 'Chưa đăng nhập Zalo. Hãy quét mã QR để kết nối trước khi tra cứu.');

      let body = '';
      for await (const chunk of req) body += chunk;
      let rawPhone = '';
      try {
        const parsed = JSON.parse(body);
        rawPhone = parsed.phone || '';
      } catch {
        const params = new URLSearchParams(body);
        rawPhone = params.get('phone') || '';
      }

      rawPhone = rawPhone.trim();
      if (!rawPhone) return fail(res, 400, 'Vui lòng nhập số điện thoại.');

      const norm = normalizePhone(rawPhone);
      if (!isPhone(norm) && !isPhone(rawPhone)) {
        return fail(res, 400, `Số điện thoại "${rawPhone}" không đúng định dạng (cần 10 số sau khi đổi 84 sang 0).`);
      }

      try {
        const info = await zalo.check(norm);
        const hasPub = Boolean(info && (info.hasPublicInfo || info.name || info.uid));
        if (info && hasPub) {
          const singleResult: Result = {
            line: 1,
            value: norm,
            phone: norm,
            originalPhone: rawPhone,
            type: 'phone',
            hasPublicInfo: true,
            hasPublicInfoText: 'Có thông tin public',
            name: info.name || '',
            zaloId: info.uid || '',
            gender: info.gender || '',
            dob: info.dob || '',
            bio: info.bio || '',
            avatar: info.avatar || '',
            mst: '',
            status: 'found',
            statusText: 'Có thông tin public',
            source: 'zalo',
            error: ''
          };
          addContactToCache(singleResult);
          void saveContactsCache();
        }

        respond(res, 200, {
          originalPhone: rawPhone,
          phone: norm,
          hasPublicInfo: hasPub,
          user: info ?? null
        });
      } catch (err) {
        fail(res, 500, err instanceof Error ? err.message : 'Lỗi khi tra cứu Zalo.');
      }
    } else if (req.method === 'POST' && url.pathname === '/api/jobs') {
      await start(req, res);
    } else if (req.method === 'GET' && /^\/api\/jobs\/[a-f0-9-]{36}$/.test(url.pathname)) {
      const job = jobs.get(url.pathname.split('/')[3]);
      if (!job) return fail(res, 404, 'Không tìm thấy lượt xử lý.');
      const foundResults = job.results.filter(r => r.hasPublicInfo || r.status === 'found');
      const privateResults = job.results.filter(r => r.status === 'not_found' || (!r.hasPublicInfo && r.status !== 'invalid' && r.status !== 'lookup_failed'));
      const errorResults = job.results.filter(r => r.status === 'invalid' || r.status === 'lookup_failed');
      respond(res, 200, {
        id: job.id,
        state: job.state,
        completed: job.completed,
        total: job.total,
        error: job.error,
        foundCount: foundResults.length,
        privateCount: privateResults.length,
        errorCount: errorResults.length,
        foundPhones: foundResults.map(r => r.phone || r.value),
        preview: foundResults.slice(-50) // CHỈ HIỆN NHỮNG SỐ CHECK ĐƯỢC ZALO
      });
    } else if (req.method === 'GET' && /^\/api\/jobs\/[a-f0-9-]{36}\/download$/.test(url.pathname)) {
      const job = jobs.get(url.pathname.split('/')[3]);
      if (!job?.output || job.state !== 'done') return fail(res, 404, 'Chưa có kết quả để tải.');

      const filter = url.searchParams.get('filter');
      const fileType = url.searchParams.get('type');

      let filePath = job.output;
      let contentType = job.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      let fileName = basename(job.output);

      if (filter === 'found' && fileType === 'txt') {
        filePath = join(job.folder, 'chi-sdt-co-zalo.txt');
        contentType = 'text/plain; charset=utf-8';
        fileName = 'chi-sdt-co-zalo.txt';
      } else if (filter === 'found') {
        filePath = join(job.folder, 'danh-sach-co-zalo.xlsx');
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        fileName = 'danh-sach-co-zalo.xlsx';
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(await readFile(filePath));
    } else if (req.method === 'GET' && url.pathname === '/api/cache') {
      const list = Array.from(contactsCache.values()).reverse();
      respond(res, 200, { total: list.length, contacts: list });
    } else if (req.method === 'POST' && url.pathname === '/api/cache/clear') {
      if (!isAllowedOrigin(req)) return fail(res, 403, 'Yêu cầu không cùng nguồn.');
      contactsCache.clear();
      await saveContactsCache();
      respond(res, 200, { total: 0, contacts: [] });
    } else if (req.method === 'GET' && url.pathname === '/api/cache/download') {
      const format = url.searchParams.get('format') || 'xlsx';
      const contacts = Array.from(contactsCache.values());
      if (format === 'txt') {
        const text = contacts.map(c => c.phone).join('\r\n');
        res.writeHead(200, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': 'attachment; filename="danh-ba-zalo-da-luu.txt"',
          'Cache-Control': 'no-store'
        });
        res.end(text);
      } else {
        const tempPath = join(tmpdir(), `zalo-cache-${Date.now()}.xlsx`);
        const results: Result[] = contacts.map((c, i) => ({
          line: i + 1,
          value: c.phone,
          phone: c.phone,
          originalPhone: c.originalPhone || c.phone,
          type: 'phone',
          hasPublicInfo: true,
          hasPublicInfoText: 'Có thông tin public',
          name: c.name,
          zaloId: c.zaloId,
          gender: c.gender,
          dob: c.dob,
          bio: c.bio,
          avatar: c.avatar,
          mst: '',
          status: 'found',
          statusText: 'Đã lưu trong cache',
          source: 'cache',
          error: '',
          companyName: c.companyName,
          contactName: c.contactName
        }));
        await exportResults(tempPath, results);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="danh-ba-zalo-da-luu.xlsx"',
          'Cache-Control': 'no-store'
        });
        res.end(await readFile(tempPath));
        void rm(tempPath, { force: true });
      }
    } else {
      fail(res, 404, 'Không tìm thấy trang.');
    }
  } catch {
    if (!res.headersSent) fail(res, 500, 'Lỗi máy chủ.');
    else res.end();
  }
});

void loadContactsCache();
void zalo.tryResumeSession();
server.listen(port, host, () => console.log(`Giao diện: http://${host}:${port} (chỉ truy cập từ máy này)`));

async function close() {
  server.close();
  for (const job of jobs.values()) {
    if (job.state !== 'running') await rm(job.folder, { recursive: true, force: true });
  }
}

process.once('SIGINT', () => { void close().then(() => process.exit()); });
