/**
 * リンカーン調査ツール（クライアントPCで実行する）
 *
 * headedブラウザを永続プロファイルで起動し、人が手動でログイン・画面遷移しながら
 * 証跡（HAR / DOMスナップショット / スクリーンショット）を採取する。
 * 採取結果は docs/コネクタ連携設計.md §9 の調査チェックリストの入力になる。
 *
 * 使い方:
 *   pnpm --filter @hotel-revenue-system/connector-agent recon:lincoln
 *
 *   1. 開いたブラウザでリンカーンにログインし、料金ランク画面まで遷移する
 *   2. 記録したい画面でターミナルに Enter → 全タブのDOM+スクリーンショットを保存
 *   3. ラベルを付けたい場合は「rank-list」のように入力して Enter
 *   4. 終了は q + Enter（★HARはこの正常終了時にのみ書き出される。×ボタンやCtrl+Cで
 *      ブラウザ/プロセスを落とすとHARは保存されない）
 *
 * 注意: 採取物にはセッションCookie等の認証情報が含まれ得る。recon-out/ と
 * .recon-profile/ は共有前に必ず中身を確認し、リポジトリにコミットしない（.gitignore済み）。
 */
import { chromium, type BrowserContext } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';

const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(process.env.RECON_OUT_DIR ?? path.join('recon-out', startedAt));
const profileDir = path.resolve(process.env.RECON_PROFILE_DIR ?? '.recon-profile');
fs.mkdirSync(outDir, { recursive: true });

let snapshotSeq = 0;

async function snapshotAllPages(context: BrowserContext, label: string): Promise<void> {
  const pages = context.pages();
  if (pages.length === 0) {
    console.log('開いているページがありません');
    return;
  }
  snapshotSeq += 1;
  const prefix = `${String(snapshotSeq).padStart(3, '0')}-${label}`;
  for (const [i, page] of pages.entries()) {
    const base = path.join(outDir, pages.length === 1 ? prefix : `${prefix}-tab${i + 1}`);
    try {
      const meta = { url: page.url(), title: await page.title(), capturedAt: new Date().toISOString() };
      fs.writeFileSync(`${base}.meta.json`, JSON.stringify(meta, null, 2));
      fs.writeFileSync(`${base}.html`, await page.content());
      await page.screenshot({ path: `${base}.png`, fullPage: true });
      console.log(`保存: ${base}.{html,png,meta.json} (${meta.url})`);
    } catch (err) {
      console.warn(`タブ${i + 1} の採取に失敗:`, err instanceof Error ? err.message : err);
    }
  }
}

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: null,
  recordHar: { path: path.join(outDir, 'session.har'), content: 'embed' },
});

console.log(`出力先: ${outDir}`);
console.log('ブラウザでリンカーンを操作してください。Enter=スナップショット / <ラベル>+Enter=ラベル付き / q+Enter=終了(HAR書き出し)');

if (context.pages().length === 0) {
  await context.newPage();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
for await (const line of rl) {
  const input = line.trim();
  if (input === 'q') break;
  const label = input === '' ? 'snapshot' : input.replace(/[^\w-]/g, '_');
  await snapshotAllPages(context, label);
}
rl.close();

console.log('HARを書き出して終了します…');
await context.close();
console.log(`完了。採取物: ${outDir}`);
