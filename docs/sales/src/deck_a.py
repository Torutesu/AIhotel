# -*- coding: utf-8 -*-
"""レベスト 営業資料 A：ホテル運営会社の経営層向け（初回商談）"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import bar, src, weight_dots, render

SRC_ISSUE = "初期導入先の運営会社との要件定義で整理した論点（2026年7月）"
SRC_SPEC = "レベスト機能仕様（2026年9月時点）"

S = []

# ── 表紙 ──────────────────────────────────────────────
S.append(dict(kind="cover", head=bar("経営層向け　2026年9月"), body="""
  <div class="big">担当者の経験で決めている客室料金を、<br>運用の仕組みに移す</div>
  <div class="rule"></div>
  <div class="sub">レベスト｜ホテル収益管理システム</div>
"""))

# ── P1 課題 ───────────────────────────────────────────
S.append(dict(kind="body", head=bar("収益管理の現状"), body="""
  <h1>収益管理の論点は、実績の把握・価格の決定・需要の把握・報告に分かれる</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:46mm">収益管理の局面</th><th>要件定義で挙がった論点</th></tr>
      <tr><td class="ax">実績の把握</td>
        <td><ul class="cb"><li>月別のKPI進捗を施設ごとに並べたい</li><li>月初時点や任意の日付との差を見たい</li><li>予算に届くかどうかを、月の途中で判断したい</li></ul></td></tr>
      <tr><td class="ax">価格の決定</td>
        <td><ul class="cb"><li>稼働率とADR（平均客室単価）のどちらを優先するかを、設定として残したい</li><li>料金ランクの段階を施設間で統一したい</li><li>催事や外部要因を、価格を決める前に把握したい</li></ul></td></tr>
      <tr><td class="ax">需要の把握</td>
        <td><ul class="cb"><li>宿泊日までの予約の積み上がりを見たい</li><li>競合の価格を利用人数別に比べたい</li></ul></td></tr>
      <tr><td class="ax">報告</td>
        <td><ul class="cb"><li>月次レポートを決まった形で出したい</li></ul></td></tr>
    </table>
""" + src(SRC_ISSUE) + """
  </div>
"""))

# ── P2 前提→帰結 ──────────────────────────────────────
S.append(dict(kind="body", head=bar("収益管理の現状"), body="""
  <h1>いまの進め方は、担当者が代わると引き継げず、<br>施設が増えるほど重くなる</h1>
  <div class="c">
    <div class="two">
      <div>
        <div class="colh">いまの進め方</div>
        <table>
          <tr><td class="ax" style="width:36mm">実績の集約</td><td>担当者が施設ごとに表計算へ手で転記する</td></tr>
          <tr><td class="ax">競合の確認</td><td>担当者が予約サイトを1件ずつ開いて記録する</td></tr>
          <tr><td class="ax">価格の決定</td><td>担当者が経験で決め、決めた理由は手元に残る</td></tr>
          <tr><td class="ax">予算との比較</td><td>月次で締めたあとに、予算との差を確かめる</td></tr>
        </table>
      </div>
      <div class="tri"></div>
      <div>
        <div class="colh">この進め方で起きること</div>
        <ul>
          <li>同じ数字を担当者ごとに作り直す</li>
          <li>担当者が異動すると価格の根拠を引き継げない</li>
          <li>施設が増えるほど集約に使う時間が伸びる</li>
          <li>予算とのずれに気づくのが遅れ、対応が翌月以降になる</li>
        </ul>
      </div>
    </div>
""" + src(SRC_ISSUE) + """
  </div>
"""))

# ── P3 提供範囲（柱＋土台） ─────────────────────────────
S.append(dict(kind="body", head=bar("レベストの提供範囲"), body="""
  <h1>レベストは、実績・価格・需要・報告を同じシステムにまとめる</h1>
  <div class="c" style="justify-content:center">
    <div class="pil grid g4 fix">
      <div class="p"><span class="pt">ダッシュボード</span><span class="px">室料売上・ADR・稼働率・REV-Per（販売可能客室1室あたりの収益。RevPARと同じ指標）など8つの指標を月別に並べ、予算比と前年比を同じ画面で確認できる</span></div>
      <div class="p"><span class="pt">ダイナミックプライシング</span><span class="px">推奨ADRと料金ランクを日別カレンダーに出す。イベントや外部要因は現場の担当者が登録する</span></div>
      <div class="p"><span class="pt">日別分析・各種分析</span><span class="px">宿泊日までの予約の積み上がりと、競合の価格を利用人数別に比べる。年間の月次推移も同じ画面で見る</span></div>
      <div class="p"><span class="pt">レポート</span><span class="px">対象月を選んで月次レポートを生成し、PDFとExcelで出力する</span></div>
    </div>
    <div class="base"><b>データの分離</b><span>契約企業ごとにデータを分け、他社のデータは参照できない</span></div>
    <div class="base" style="margin-top:2.5mm"><b>変更の記録</b><span>価格戦略・料金ランク・予算の変更を、誰がいつ変えたかの記録として残す</span></div>
""" + src(SRC_SPEC) + """
  </div>
"""))

# ── P4 重み付け ────────────────────────────────────────
S.append(dict(kind="body", head=bar("レベストの提供範囲"), body="""
  <h1>稼働率・ADR・競合追従度の重みを合計100%で決め、<br>価格の根拠を設定として残す</h1>
  <div class="c">
    <div class="two" style="grid-template-columns:1.45fr auto 1fr">
      <div>
        <div class="axh"><span>価格戦略の重み付け</span><span class="u">設定例、1目盛り＝1%</span></div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center">""" + weight_dots([
            ("稼働率", 45, "w1"), ("ADR", 35, "w2"), ("競合追従度", 20, "w3")]) + """</div>
      </div>
      <div class="tri"></div>
      <div>
        <div class="colh">重みを変えると動くもの</div>
        <ul>
          <li>今日以降の日別の推奨ADRを計算し直す</li>
          <li>日ごとの需要レベルを判定し直す</li>
          <li>月間着地のADRとREV-Perを更新する</li>
          <li>あわせて、変更した担当者と日時を記録する</li>
        </ul>
      </div>
    </div>
""" + src("重みの合計が100%にならない設定は保存できない　／　レベスト機能仕様（2026年9月時点）") + """
  </div>
"""))

# ── P5 設定の単位（主張パネル＋表） ───────────────────────
S.append(dict(kind="body", head=bar("複数施設での運用"), body="""
  <h1>設定は施設ごとに持ち、集計は施設をまたいで見られる</h1>
  <div class="c">
    <div class="side">
      <div class="sp">
        <div class="ct">設定を持つ単位</div>
        <div class="cm">施設ごとの事情を残したまま、全社を横断して見る</div>
      </div>
      <div class="sb">
        <div class="axh"><span>単位ごとに決まること</span><span class="u">レベストの設定構造</span></div>
        <table>
          <tr><th class="ax" style="width:36mm">設定の単位</th><th style="width:34mm">役割</th><th>そこで決まること</th></tr>
          <tr><td class="ax">契約企業</td><td class="b">契約の単位</td><td>所属する施設とユーザーをまとめる。この境界の外のデータは参照できない</td></tr>
          <tr><td class="ax">施設</td><td class="b">運用の単位</td><td>週末とする曜日・料金ランク・競合ホテル・月次予算を施設ごとに持つ</td></tr>
          <tr><td class="ax">ユーザー</td><td class="b">担当の単位</td><td>担当施設を1つに絞るか、契約企業内の全施設を横断して集計を見るかを選ぶ</td></tr>
        </table>
      </div>
    </div>
""" + src("週末の既定は金曜・土曜で、施設ごとに変更できる　／　レベスト機能仕様（2026年9月時点）") + """
  </div>
"""))

# ── P6 権限 ────────────────────────────────────────────
S.append(dict(kind="body", head=bar("複数施設での運用"), body="""
  <h1>契約企業を越えられるのは運営ロールだけで、<br>管理者も自社の外のデータは見られない</h1>
  <div class="c">
    <div class="legend"><span><span class="hb q4"><i></i></span>できる</span><span><span class="hb q2"><i></i></span>一部できる</span><span><span class="hb q0"><i></i></span>できない</span></div>
    <table>
      <tr><th class="ax" style="width:44mm">ロール</th><th class="hbc" style="width:26mm">実績の閲覧</th><th class="hbc" style="width:26mm">設定の変更</th><th class="hbc" style="width:30mm">ユーザー管理</th><th class="hbc" style="width:32mm">他社のデータ</th><th>権限が及ぶ範囲</th></tr>
      <tr><td class="ax">運営</td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td>レベストを提供する当社が持つ。顧客には渡さない</td></tr>
      <tr><td class="ax">管理者</td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q0"><i></i></span></td><td>自社のなかで最上位。施設の追加とユーザー登録を行う</td></tr>
      <tr><td class="ax">マネージャー</td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q2"><i></i></span></td><td class="hbc"><span class="hb q0"><i></i></span></td><td>価格戦略・料金ランク・予算・競合を変える。他のユーザーに管理者の権限は付与できない</td></tr>
      <tr><td class="ax">オペレーター</td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q2"><i></i></span></td><td class="hbc"><span class="hb q0"><i></i></span></td><td class="hbc"><span class="hb q0"><i></i></span></td><td>イベントの登録とアラートの確認を行う。価格は変えない</td></tr>
    </table>
""" + src(SRC_SPEC) + """
  </div>
"""))

# ── P7 導入 ────────────────────────────────────────────
S.append(dict(kind="body", head=bar("導入の進め方"), body="""
  <h1>初期設定・データ取り込み・試験運用・本運用の順に導入を進める</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:40mm">段階</th><th>当社が行うこと</th><th>貴社にお願いすること</th></tr>
      <tr><td class="ax">初期設定</td>
        <td><ul class="cb"><li>環境を用意し、施設とユーザーを登録する</li><li>料金ランクの段階を設定する</li></ul></td>
        <td><ul class="cb"><li>対象施設と利用するユーザーを決める</li><li>週末とする曜日と料金ランクの方針を示す</li></ul></td></tr>
      <tr><td class="ax">データ取り込み</td>
        <td><ul class="cb"><li>受け取った実績を取り込み、集計を突き合わせる</li></ul></td>
        <td><ul class="cb"><li>過去の日別実績と月次予算を提供する</li><li>競合とする施設を選ぶ</li></ul></td></tr>
      <tr><td class="ax">試験運用</td>
        <td><ul class="cb"><li>重み付けを調整し、推奨値の出方を確認する</li></ul></td>
        <td><ul class="cb"><li>現行の価格決定と並走し、ずれを指摘する</li></ul></td></tr>
      <tr><td class="ax">本運用</td>
        <td><ul class="cb"><li>問い合わせに対応し、設定変更を支援する</li></ul></td>
        <td><ul class="cb"><li>日々の価格決定でレベストの画面を使う</li></ul></td></tr>
    </table>
""" + src(SRC_SPEC) + """
  </div>
"""))

# ── P8 決めること ──────────────────────────────────────
S.append(dict(kind="body", head=bar("次に決めること"), body="""
  <h1>次回までに、対象施設・データの提供元・試験運用の期間・<br>ユーザーの範囲を決めていただきたい</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:46mm">決めること</th><th>選択肢</th><th>当社の考え</th></tr>
      <tr><td class="ax">対象施設</td>
        <td>1施設から始めるか、同じ地域の複数施設をまとめて始めるか</td>
        <td>競合が重なる複数施設のほうが、競合比較と重み付けの効果を確かめやすい</td></tr>
      <tr><td class="ax">データの提供元</td>
        <td>既存システムからの書き出しを使うか、表計算で管理している実績を使うか</td>
        <td>日別の販売室数と室料売上がそろっていれば取り込める。形式は事前に確認する</td></tr>
      <tr><td class="ax">試験運用の期間</td>
        <td>現行の価格決定と並走する期間をどこまで取るか</td>
        <td>需要の山と谷が1回ずつ入る長さを取り、推奨値のずれを見る</td></tr>
      <tr><td class="ax">ユーザーの範囲</td>
        <td>レベニュー担当に絞るか、支配人まで、あるいは現場のフロント担当まで広げるか</td>
        <td>閲覧とイベント登録だけのオペレーターロールがあるため、フロント担当まで広げても設定は守られる</td></tr>
    </table>
""" + src("レベスト機能仕様（2026年9月時点）。当社の考えは提案であり、実測値にもとづくものではない") + """
  </div>
"""))

# ── 裏表紙 ────────────────────────────────────────────
S.append(dict(kind="back", head=bar("　"), body="""
  <div class="big" style="margin-top:60mm;font-size:22pt">レベスト</div>
  <div class="sub">ホテル収益管理システム</div>
  <div class="src" style="position:absolute;left:16mm;bottom:14mm">本資料は consulting-pptx-skill（github.com/carnot-tech/consulting-pptx-skill）で作成</div>
"""))

html, pages = render(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'revest_keieiso.html'),
                     "レベスト 営業資料｜経営層向け", S)
print("pages:", pages, "slides:", len(S))
