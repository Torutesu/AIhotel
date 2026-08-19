# connector-agent — クライアントPC常駐コネクタエージェント

リンカーン（Web）・ねほっぷす（ネイティブWindows）への画面操作ベース読み書きを担う
常駐エージェントのワークスペース。設計は `docs/コネクタ連携設計.md` を参照。

**現状は調査（recon）ツールのみ。** ジョブポーリング・実行本体は調査完了後にここへ実装する。

## セットアップ（クライアントPC / Windows）

```powershell
# Node.js 18+ と pnpm を導入済みであること
pnpm install
pnpm --filter @hotel-revenue-system/connector-agent exec playwright install chromium
```

## リンカーン調査（Playwright）

```powershell
pnpm --filter @hotel-revenue-system/connector-agent recon:lincoln
```

1. 開いたブラウザでリンカーンにログインし、料金ランク一覧・編集画面まで遷移する
2. 記録したい画面でターミナルに **Enter** → 全タブの DOM(html) + スクリーンショット(png) + URL(meta.json) を保存
3. `rank-list` のようにラベルを入力して Enter するとファイル名に付く
4. **q + Enter で終了**（HAR＝全通信記録はこの正常終了時にのみ書き出される）

採取物は `connector-agent/recon-out/<日時>/` に入る。ログインセッションは
`connector-agent/.recon-profile/` に保持され、次回起動時に再ログイン不要（2FAの有無確認にも使う）。

> ⚠️ 採取物・プロファイルにはセッションCookie等の認証情報が含まれ得る。
> どちらも .gitignore 済み。共有時は中身を確認してから渡すこと。

### 採取してほしいもの（設計書 §9 チェックリスト対応）

- ログイン画面（2段階認証・画像認証の有無がわかる状態）
- 料金ランクの一覧画面・編集画面（保存ボタン押下の前後それぞれ）
- 上記操作を一通り行ったセッションのHAR（裏で叩いているXHRの観測用）
- メニュー全体（CSV入出力画面が本当に無いかの再確認用）

## ねほっぷす調査（UIAツリー確認）

コードは不要。クライアントPCで以下を確認する。**この結果が実装方式と工数を最も左右する。**

1. [Accessibility Insights for Windows](https://accessibilityinsights.io/docs/windows/overview/)
   （または FlaUInspect / Windows SDK の inspect.exe）をインストール
2. ねほっぷすを起動し、料金を入力する画面を開く
3. Accessibility Insights の「Inspect」で料金入力欄・保存ボタンにカーソルを当て、以下を記録:
   - コントロールが個別に認識されるか（ウィンドウ全体が1つの塊に見えないか）
   - `AutomationId` / `Name` / `ControlType` に値が入っているか
   - ツリー構造のスクリーンショット
4. あわせて記録: アプリのUIフレームワークの手がかり（タイトルバー表示、インストールフォルダの
   DLL名など）、多重起動可否、料金入力の画面遷移スクリーンショット一式

判定の目安:

| 観察結果 | 実装方式 |
| --- | --- |
| コントロールが個別認識され AutomationId/Name がある | FlaUI で安定自動化（想定どおり） |
| 認識されるが Name が空・座標依存 | FlaUI＋座標補助。定義メンテ頻度が上がる |
| ウィンドウが1枚の絵として認識される（独自描画） | 座標クリック＋OCR / computer use。要再見積もり |
