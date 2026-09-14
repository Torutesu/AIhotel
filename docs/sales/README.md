# レベスト 営業資料

本プロジェクト（AIレベニュー管理システム）を **レベスト** の名称で外販するための営業資料。
読み手別に3本を作り分けている。16:9・HTML（1 section = 1スライド）と、Chrome で印刷した PDF。

| ファイル | 読み手 | 使う場面 | 本文 |
|---|---|---|---|
| `revest_keieiso.html` / `.pdf` | ホテル運営会社の経営層 | 初回商談 | 8枚 |
| `revest_jitsumusha.html` / `.pdf` | レベニューマネージャー・支配人 | 画面と日々の運用の説明 | 11枚 |
| `revest_partner.html` / `.pdf` | 販売代理店・パートナー | 再販の提案と役割分担の合意 | 9枚 |

## 記載範囲のルール

**現時点で実装済みの機能だけを書く。** `AGENTS.md` の「未実装領域（Phase 4）は『実装済み』と報告しない」に従い、
PMS／サイトコントローラー／OTA連携、需要予測MLモデル、Claude API によるAIコメント生成には
3本とも一切触れていない。効果の数値（「収益◯%向上」「予測精度◯%」等）は実測値を持たないため書いていない。

記載内容の出どころ:

- 機能・権限・上限値（料金ランク40段階、競合5件、重み合計100%、アラート5段階、週末の既定は金・土）
  … `要件定義書.md` §6 と `README.md` の API エンドポイント節、`backend/prisma/schema.prisma`
- 月間着地の計算（実績のある日は実績、無い日は予測稼働率×客室数と予測ADR、どちらも無い日は除外）
  … `backend/src/services/pricingService.ts` の `computeLandingProjection`
- 継続的インテグレーションの4段 … `.github/workflows/ci.yml`
- 課題の整理 … `要件定義書.md` §3（初期導入先の社名は外部資料のため伏せている）

ブッキングカーブの図（実務者向け P.8）だけはサンプル形状で、スライド上に「画面イメージ」「数値は実データではない」と明示している。

## 作り直し方

[consulting-pptx-skill](https://github.com/carnot-tech/consulting-pptx-skill)（MIT License, Carnot AI Inc.）の
基本パーツ集を土台にしている。`src/base.css` は同スキルの `templates/freeform_parts_16x9.html` から
スタイルを取り出し、ネイビー系スキンに差し替えたもの。

```bash
cd docs/sales/src
python3 deck_a.py   # → ../revest_keieiso.html
python3 deck_b.py   # → ../revest_jitsumusha.html
python3 deck_c.py   # → ../revest_partner.html
```

出力先は各スクリプト末尾の `render(...)` で指定している。

検証（スキル同梱のスクリプトを使う。3本とも FAIL 0 / layout OK）:

```bash
python3 scripts/check_deck.py <deck>.html      # 規約の機械チェック
node scripts/check_layout.mjs <deck>.html      # 重なり・はみ出しの実レンダリング検査
```

PDF 化:

```bash
chrome --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf=<deck>.pdf <deck>.html
```

## 配布する前に決めること

3本とも「実装済みの機能を正確に説明する」ところまでで、次の項目は意図的に空けてある。
商談で使う前に、ビジネス側で決めて追記すること。

- **価格・契約形態** … 未確定（`要件定義書.md` §3「事業計画」）。経営層向け P.8 とパートナー向け
  P.7・P.9 では「当社に確認」に寄せてある。決まり次第、経営層向けに費用の1枚を足す
- **導入効果の実数** … 実測値がないため、効果を示すページを置いていない。初期導入先で
  時間・ADR・稼働率のいずれかが取れたら、経営層向けの意思決定ページの手前に1枚足す
- **導入実績・事例** … 同上。ロゴや社名を載せる場合は先方の許諾を取る
- **機密区分・版数・問い合わせ先** … 社外配布するなら裏表紙に足す

各デッキの裏表紙左下に「本資料は consulting-pptx-skill … で作成」の1行が入っている
（スキルの既定）。顧客配布時に外す場合は、`src/deck_*.py` 末尾の裏表紙ブロックから
`<div class="src" …>` の行を削除して作り直す。

## 更新するとき

機能を追加したら、対応するスライドの記述と `README.md` の「記載内容の出どころ」を合わせて直す。
Phase 4 の機能が実装されたら、まず `要件定義書.md` §6 の実装状況を更新し、そのあとで資料に反映する。

文章を直したら、必ず `check_deck.py`（FAIL 0）と `check_layout.mjs`（OK）を通し、
PDF を全ページ目視する。機械チェックは重なり・はみ出し・規約違反しか見ないため、
図が潰れる・下半分が空く・泣き別れするといった不具合は目視でしか見つからない。
