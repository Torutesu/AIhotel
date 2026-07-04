# Vercel デプロイ設定ガイド

## 問題
Vercelが「No Next.js version detected」エラーを出している場合、Root Directoryの設定が必要です。

## 解決方法

### 方法1: Vercelダッシュボードで設定（推奨）

1. Vercelのダッシュボード（https://vercel.com）にログイン
2. プロジェクトの設定（Settings）を開く
3. **General** セクションを開く
4. **Root Directory** を設定：
   - 「Edit」をクリック
   - 「Override」を選択
   - `frontend` と入力
   - 「Save」をクリック

5. **Build & Development Settings** セクションで確認：
   - **Framework Preset**: Next.js（自動検出されるはず）
   - **Build Command**: `pnpm --filter frontend build` または空欄（自動検出）
   - **Output Directory**: `.next` または空欄（自動検出）
   - **Install Command**: `pnpm install --no-frozen-lockfile` または空欄

6. 再度デプロイを実行

### 方法2: vercel.jsonで設定

現在の`vercel.json`は以下のようになっています：

```json
{
  "buildCommand": "pnpm --filter frontend build",
  "installCommand": "pnpm install --no-frozen-lockfile",
  "outputDirectory": "frontend/.next"
}
```

**重要**: Vercelのダッシュボードで**Root Directory**を`frontend`に設定する必要があります。

`vercel.json`だけではRoot Directoryを設定できません（Vercelの制限）。

## 確認事項

- ✅ `frontend/package.json`に`next`が`dependencies`に含まれている
- ✅ `pnpm-workspace.yaml`がルートディレクトリに存在する
- ✅ `vercel.json`がルートディレクトリに存在する
- ✅ Vercelダッシュボードで**Root Directory**が`frontend`に設定されている

## トラブルシューティング

### エラー: "No Next.js version detected"

**原因**: Vercelが`frontend/package.json`を見つけられていない

**解決策**:
1. VercelダッシュボードでRoot Directoryを`frontend`に設定
2. プロジェクトを再デプロイ

### エラー: "Cannot install with frozen-lockfile"

**原因**: ロックファイルが古い

**解決策**: `installCommand`に`--no-frozen-lockfile`を追加（既に設定済み）

### エラー: "pnpm: command not found"

**原因**: Vercelがpnpmを認識していない

**解決策**: 
1. Vercelのダッシュボードで**Package Manager**を`pnpm`に設定
2. または、プロジェクトのルートに`.npmrc`があることを確認

