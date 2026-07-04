# トラブルシューティングガイド

## TypeScriptエラーが表示される場合

VS CodeでTypeScriptエラーが表示される場合、以下の手順を試してください：

### 1. TypeScriptサーバーの再起動

1. VS Codeで `Cmd+Shift+P` (Mac) または `Ctrl+Shift+P` (Windows/Linux) を押す
2. 「TypeScript: Restart TS Server」を選択

### 2. ワークスペースの再読み込み

1. `Cmd+Shift+P` / `Ctrl+Shift+P` を押す
2. 「Developer: Reload Window」を選択

### 3. node_modulesの再インストール

```bash
# ルートディレクトリで実行
rm -rf node_modules frontend/node_modules backend/node_modules shared/node_modules
npm install
```

### 4. ファイルパスの確認

エラーが `components/main-layout.tsx` などのルートディレクトリのパスを参照している場合：
- 正しいファイルは `frontend/components/main-layout.tsx` にあります
- VS Codeで開いているファイルのパスを確認してください

## モジュール解決エラー

### `@/lib/utils` が見つからない

- `frontend/lib/utils.ts` が存在することを確認
- `frontend/tsconfig.json` の `paths` 設定を確認
- VS CodeのTypeScriptサーバーを再起動

### `@shared/types` が見つからない

- `shared/types/index.ts` が存在することを確認
- `npm install` を実行してワークスペースの依存関係をインストール

## React関連のエラー

Next.js 15では、通常 `import React from 'react'` は不要です。
しかし、JSXの使用でエラーが出る場合は、明示的にインポートしてください：

```typescript
import React from 'react'
```

## ビルドエラー

```bash
# 型チェックを実行
npm run type-check

# ビルドを実行
npm run build
```

エラーの詳細を確認してください。

