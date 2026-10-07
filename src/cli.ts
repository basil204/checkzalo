import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { exportResults, fingerprint, loadTaxTable, processRows, readInputs } from './core.js';

async function main() {
  const args = process.argv.slice(2);
  const get = (key: string) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
  if (args.includes('--help') || !get('--input') || !get('--output')) {
    console.log('npm start -- --input data.txt --output result.csv [--tax-table companies.csv] [--checkpoint state.checkpoint.jsonl] [--concurrency 1] [--delay-ms 1000] [--retry-failed]');
    if (!args.includes('--help')) process.exitCode = 1;
    return;
  }
  const input = resolve(get('--input')!), output = resolve(get('--output')!);
  const table = get('--tax-table') ? resolve(get('--tax-table')!) : undefined;
  const checkpoint = resolve(get('--checkpoint') ?? `${output}.checkpoint.jsonl`);
  if (new Set([input, output, checkpoint, table].filter(Boolean)).size !== [input, output, checkpoint, table].filter(Boolean).length)
    throw new Error('Đường dẫn input, output, checkpoint và bảng nguồn phải khác nhau.');
  const lookup = table ? await loadTaxTable(table) : undefined;
  const rows = await readInputs(input);
  const key = fingerprint(await readFile(input), lookup?.source ?? 'no-table');
  const concurrency = Number(get('--concurrency') ?? '1');
  const delayMs = Number(get('--delay-ms') ?? '1000');
  const results = await processRows(rows, lookup, { concurrency, delayMs, checkpoint, key, retryFailed: args.includes('--retry-failed') });
  await exportResults(output, results);
  const counts = Object.fromEntries([...new Set(results.map(r => r.status))].map(s => [s, results.filter(r => r.status === s).length]));
  console.log(`Đã xuất ${results.length} dòng vào ${output}. Trạng thái: ${JSON.stringify(counts)}`);
}
main().catch((e: unknown) => { console.error('Lỗi:', e instanceof Error ? e.message : 'Không rõ'); process.exitCode = 1; });
