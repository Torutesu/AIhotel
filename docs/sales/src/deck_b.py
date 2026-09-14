# -*- coding: utf-8 -*-
"""レベスト 営業資料 B：レベニューマネージャー・支配人向け（実務者）"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import bar, src, weight_dots, render

SPEC = "レベスト機能仕様（2026年9月時点）"
CHIPS = ["朝の確認", "価格の決定", "需要の読み取り", "設定と報告"]

def B(active):
    return bar(chips=CHIPS, active=active)

# ── ブッキングカーブの折れ線（パーツ集に無いので自作。規約 §5.11） ──
def booking_curve():
    """宿泊日までの日数（実日数に比例）と予約積上室数の折れ線。値は説明用のサンプル。"""
    days  = [60, 50, 40, 30, 21, 14, 7, 3, 0]
    rooms = [8, 15, 26, 42, 61, 84, 108, 124, 132]
    cap = 150
    W, H = 620, 250
    x0, x1, y0, y1 = 44, 606, 16, 214
    def px(d):  # 左が60日前、右が当日。日数に比例させる
        return x1 - (x1 - x0) * d / days[0]
    def py(v):
        return y1 - (y1 - y0) * v / cap
    pts = " ".join("%.1f,%.1f" % (px(d), py(v)) for d, v in zip(days, rooms))
    marks = "".join('<circle cx="%.1f" cy="%.1f" r="3.5" fill="var(--accent)"/>' % (px(d), py(v))
                    for d, v in zip(days, rooms))
    grid, ylab = "", ""
    for v in (0, 50, 100, 150):
        grid += ('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="var(--hairline)" stroke-width="1"/>'
                 % (x0, py(v), x1, py(v)))
        ylab += '<text class="lbl" x="%d" y="%.1f" text-anchor="end">%d</text>' % (x0 - 8, py(v) + 4, v)
    xlab = "".join('<text class="lbl" x="%.1f" y="233" text-anchor="middle">%s</text>'
                   % (px(d), ("当日" if d == 0 else str(d))) for d in (60, 45, 30, 15, 0))
    return (
      '<svg class="chart" viewBox="0 0 %d %d">' % (W, H)
      + grid + ylab
      + '<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="var(--rule)" stroke-width="1.4" stroke-dasharray="5 4"/>' % (x0, py(cap), x1, py(cap))
      + '<text class="lbl" x="%d" y="%.1f" text-anchor="end">客室数 150室</text>' % (x1, py(cap) - 6)
      + '<polyline points="%s" fill="none" stroke="var(--accent)" stroke-width="2.5"/>' % pts
      + marks
      + '<text class="vl" x="%.1f" y="%.1f" text-anchor="end">132室</text>' % (px(0) - 8, py(132) - 8)
      + '<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="var(--navy)" stroke-width="2"/>' % (x0, y1, x1, y1)
      + xlab + '</svg>'
    )

S = []

# ── 表紙 ──
S.append(dict(kind="cover", head=bar("レベニューマネージャー・支配人向け　2026年9月"), body="""
  <div class="big">明日の客室料金を決めるまでを、<br>ひと続きの流れでたどる</div>
  <div class="rule"></div>
  <div class="sub">レベスト｜ホテル収益管理システム</div>
"""))

# ── P1 全体マップ ──
S.append(dict(kind="body", head=bar("本日の流れ"), body="""
  <h1>朝の確認に始まり、価格の決定・需要の読み取りを経て、設定と報告で締める</h1>
  <div class="c">
    <div class="rows">
      <div class="r"><div class="l">朝の確認</div><div>ダッシュボードで月別のKPI進捗と、拾うべきアラートを見る<span class="ref">→ P.2</span></div></div>
      <div class="r"><div class="l">価格の決定</div><div>日別カレンダーで推奨ADR（平均客室単価）と料金ランクを確かめ、重み付けを調整する<span class="ref">→ P.5</span></div></div>
      <div class="r"><div class="l">需要の読み取り</div><div>宿泊日までの予約の積み上がりと、競合の価格を利用人数別に比べる<span class="ref">→ P.8</span></div></div>
      <div class="r"><div class="l">設定と報告</div><div>料金ランク・競合・予算を整え、月次レポートを出力する<span class="ref">→ P.10</span></div></div>
    </div>
""" + src(SPEC) + """
  </div>
"""))

# ── P2 ダッシュボード指標 ──
S.append(dict(kind="body", head=B("朝の確認"), body="""
  <h1>ダッシュボードは、室料売上から客単価までを月別の進捗として並べる</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:40mm">指標</th><th>何を表すか</th><th class="ax" style="width:40mm">指標</th><th>何を表すか</th></tr>
      <tr><td class="ax">室料売上</td><td>その月に客室から上がった売上</td><td class="ax">REV-Per</td><td>販売可能客室1室あたりの収益。RevPARと同じ指標</td></tr>
      <tr><td class="ax">販売室数</td><td>その月に売れた延べ室数</td><td class="ax">宿泊人数</td><td>その月に泊まった延べ人数</td></tr>
      <tr><td class="ax">ADR</td><td>売れた1室あたりの平均単価</td><td class="ax">DOR</td><td>1室あたりの平均宿泊人数</td></tr>
      <tr><td class="ax">稼働率</td><td>客室がどれだけ埋まったか</td><td class="ax">客単価</td><td>宿泊者1人あたりの売上</td></tr>
    </table>
""" + src(SPEC + "。開始月と表示月数（1・3・6・12か月）を選び、施設ごとに表示する指標を絞れる") + """
  </div>
"""))

# ── P3 予算比・前年比 ──
S.append(dict(kind="body", head=B("朝の確認"), body="""
  <h1>本日まで・累計進捗・年度累計に分けて、予算比と前年比を読む</h1>
  <div class="c">
    <div class="two">
      <div>
        <div class="colh">3つの軸が指す期間</div>
        <table>
          <tr><td class="ax" style="width:40mm">本日まで</td><td>当月の1日から本日までの実績を、同じ期間の予算・前年と比べる</td></tr>
          <tr><td class="ax">累計進捗</td><td>当月の予算に対して、本日時点でどこまで積み上がったかを見る</td></tr>
          <tr><td class="ax">年度累計</td><td>4月から本日までを通算し、年度としての進み具合を見る</td></tr>
        </table>
      </div>
      <div class="tri"></div>
      <div>
        <div class="colh">軸を分けて見る理由</div>
        <ul>
          <li>残日数が長いほど、単月の予算比は日々の実績のぶれを大きく受ける</li>
          <li>年度累計は単月の good・bad を吸収するため、傾向の判断に向く</li>
          <li>本日までの比較は、同じ期間どうしを突き合わせるので前年と直接比べられる</li>
        </ul>
      </div>
    </div>
""" + src(SPEC + "。年度は4月始まり") + """
  </div>
"""))

# ── P4 アラート ──
S.append(dict(kind="body", head=B("朝の確認"), body="""
  <h1>アラートは重要度で分かれ、ダッシュボードにはレベル5と4だけが出る</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:42mm">重要度</th><th>ダッシュボードでの扱い</th><th>現場で行う操作</th></tr>
      <tr><td class="ax">レベル5</td>
        <td>最上位で表示し、該当する画面への遷移を用意する</td>
        <td>フロント担当が内容を確認し、確認済みにする</td></tr>
      <tr><td class="ax">レベル4</td>
        <td>レベル5に続けて表示し、同じく該当画面へ遷移できる</td>
        <td>フロント担当が確認済みにし、対応が終わったらマネージャー以上が解決済みにする</td></tr>
      <tr><td class="ax">レベル3以下</td>
        <td>ダッシュボードには表示しない</td>
        <td>対応不要。判定が更新されてレベル4以上になると、ダッシュボードに現れる</td></tr>
    </table>
""" + src(SPEC + "。確認済みへの変更はオペレーターも行える。解決済みへの変更はマネージャー以上") + """
  </div>
"""))

# ── P5 価格カレンダー ──
S.append(dict(kind="body", head=B("価格の決定"), body="""
  <h1>価格を決める材料が、翌月の全日にわたり1日1行で並ぶ</h1>
  <div class="c">
    <div class="side">
      <div class="sp">
        <div class="ct">日別の価格カレンダー</div>
        <div class="cm">価格を動かす日を、並びのまま探せる</div>
      </div>
      <div class="sb">
        <div class="axh"><span>1行に並ぶ項目</span><span class="u">月を選んで表示</span></div>
        <table>
          <tr><td class="ax" style="width:34mm">現在価格</td><td>いま売っている価格</td></tr>
          <tr><td class="ax">推奨ADR</td><td>重み付けの設定をもとに計算した、その日の推奨単価</td></tr>
          <tr><td class="ax">料金ランク</td><td>設定した段階のうち、その日に当たるランク</td></tr>
          <tr><td class="ax">需要レベル</td><td>需要の強さをAからEの5段階で示す</td></tr>
          <tr><td class="ax">イベント</td><td>オペレーター（フロント担当）が登録した催事や外部要因</td></tr>
        </table>
      </div>
    </div>
""" + src("料金ランクは最大40段階。マネージャー以上は推奨ADRへの一括リセットを行える　／　レベスト機能仕様（2026年9月時点）") + """
  </div>
"""))

# ── P6 重み付け ──
S.append(dict(kind="body", head=B("価格の決定"), body="""
  <h1>3つの重みは、合計が100%にならないかぎり保存できない</h1>
  <div class="c">
    <div class="two" style="grid-template-columns:1.45fr auto 1fr">
      <div>
        <div class="axh"><span>価格戦略の重み付け</span><span class="u">設定例、1目盛り＝1%</span></div>
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center">""" + weight_dots([
            ("稼働率", 45, "w1"), ("ADR", 35, "w2"), ("競合追従度", 20, "w3")]) + """</div>
      </div>
      <div class="tri"></div>
      <div>
        <div class="colh">保存後に再計算される範囲</div>
        <ul>
          <li>今日以降の日別の推奨ADRを計算し直す</li>
          <li>日ごとの需要レベルを判定し直す</li>
          <li>月間着地のADRとREV-Perを更新する</li>
          <li>あわせて、変更した担当者と日時を記録する</li>
        </ul>
      </div>
    </div>
""" + src("設定を変えられるのはマネージャー以上。過去の日付は計算し直さない　／　レベスト機能仕様（2026年9月時点）") + """
  </div>
"""))

# ── P7 着地シミュレーション ──
S.append(dict(kind="body", head=B("価格の決定"), body="""
  <h1>月末の着地は、実績のある日・予測を使う日・計算から外す日を分けて積み上げる</h1>
  <div class="c">
    <div class="two">
      <div>
        <div class="colh">着地を組み立てる材料</div>
        <table>
          <tr><td class="ax" style="width:40mm">実績のある日</td><td>その日の室料売上と販売室数を、そのまま積み上げる</td></tr>
          <tr><td class="ax">実績のない日</td><td>予測稼働率に客室数を掛けた室数と、予測ADRを積み上げる</td></tr>
          <tr><td class="ax">実績も予測も無い日</td><td>計算対象の日数から外す。0円として積むと、着地ADRが不当に下がるため</td></tr>
        </table>
      </div>
      <div class="tri"></div>
      <div>
        <div class="colh">着地の画面で確かめること</div>
        <ul>
          <li>月末の室料売上が予算に届くかを見る</li>
          <li>ADRとREV-Perを並べ、単価と収益のどちらで届かないかを分ける</li>
          <li>重み付けを変えて計算し直し、着地の動きを比べる</li>
        </ul>
      </div>
    </div>
""" + src("予測ADRが無い日は、その日の推奨ADRを代わりに使う　／　レベスト機能仕様（2026年9月時点）") + """
  </div>
"""))

# ── P8 ブッキングカーブ ──
S.append(dict(kind="body", head=B("需要の読み取り"), body="""
  <h1>ブッキングカーブは、宿泊日までの日数で予約の積み上がりを示す</h1>
  <div class="c">
    <div class="two" style="grid-template-columns:1.6fr auto 1fr;flex:1">
      <div>
        <div class="axh"><span>予約積上室数と宿泊日までの日数</span><span class="u">室、画面イメージ</span></div>
        """ + booking_curve() + """
      </div>
      <div class="tri"></div>
      <div>
        <div class="colh">曲線から読むこと</div>
        <ul>
          <li>宿泊日までの日数を横軸に取り、予約がいつ積み上がるかを見る</li>
          <li>同じ曜日・同じ時期の日と重ねて、積み上がりの早い日と遅い日を分ける</li>
          <li>遅い日は価格を下げ、早い日は上げる、という判断の材料にする</li>
        </ul>
      </div>
    </div>
""" + src("画面の見え方を示すための図。数値は実データではない") + """
  </div>
"""))

# ── P9 競合価格 ──
S.append(dict(kind="body", head=B("需要の読み取り"), body="""
  <h1>利用人数別・施設別・曜日別に、競合との価格差を確かめる</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:44mm">比べ方</th><th>画面での見え方</th><th>この比べ方で分かること</th></tr>
      <tr><td class="ax">利用人数別</td>
        <td>1名・2名・3名以上の価格を、同じ日付軸の上に並べる</td>
        <td>2名利用では負けていないが1名利用で開いている、といった差が見える</td></tr>
      <tr><td class="ax">施設別</td>
        <td>登録した競合を同時に表示し、日別の推移として重ねる</td>
        <td>どの施設が価格を動かしたかを、日付を特定して追える</td></tr>
      <tr><td class="ax">曜日別</td>
        <td>曜日ごとの価格を表にして横並びにする</td>
        <td>週末の価格差が、平日と同じ幅で付いているかを確かめる</td></tr>
    </table>
""" + src("登録した競合は、OTA（オンライン旅行会社）ごとのURLを持てる　／　レベスト機能仕様（2026年9月時点）") + """
  </div>
"""))

# ── P10 設定 ──
S.append(dict(kind="body", head=B("設定と報告"), body="""
  <h1>設定画面から、料金ランク・競合・予算・週末の定義・イベントを<br>ロールに応じて変えられる</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:42mm">設定する対象</th><th>できること</th><th>変えられるロール</th></tr>
      <tr><td class="ax">料金ランク</td><td>段階の追加・編集・削除を行う。上限は40段階</td><td>マネージャー以上</td></tr>
      <tr><td class="ax">競合ホテル</td><td>競合を5件まで登録し、OTAごとのURLを持たせる</td><td>マネージャー以上</td></tr>
      <tr><td class="ax">月次予算</td><td>年を選び、12か月分の予算と前年実績をまとめて入れる</td><td>マネージャー以上</td></tr>
      <tr><td class="ax">週末の定義</td><td>週末とする曜日を選ぶ。集計と強調表示に即反映される</td><td>マネージャー以上</td></tr>
      <tr><td class="ax">イベント</td><td>催事や外部要因を日付に紐づけて登録する</td><td>オペレーターから</td></tr>
    </table>
""" + src(SPEC + "。設定の変更は、誰がいつ変えたかの記録として残る") + """
  </div>
"""))

# ── P11 運用サイクル ──
S.append(dict(kind="body", head=bar(chips=CHIPS), body="""
  <h1>運用は、日次の確認・週次の価格見直し・月次の報告で回り、イベントは随時入れる</h1>
  <div class="c" style="justify-content:center">
    <div class="chev">
      <div class="cv"><span class="n">毎日</span><span class="t">朝に進捗とアラートを見る</span><span class="x">ダッシュボードで当月のKPI進捗を確かめ、レベル5と4のアラートから該当画面へ移る。気になった日はそのまま価格カレンダーで開く</span></div>
      <div class="cv"><span class="n">毎週</span><span class="t">翌月分の価格を見直す</span><span class="x">価格カレンダーで推奨ADRと現在価格の差を確かめ、ブッキングカーブと競合価格をもとに重み付けを調整する</span></div>
      <div class="cv"><span class="n">毎月</span><span class="t">着地を確かめて報告する</span><span class="x">月間着地で予算への届き方を確かめ、対象月を選んで月次レポートをPDFとExcelで出力する</span></div>
      <div class="cv"><span class="n">随時</span><span class="t">現場の情報を入れる</span><span class="x">フロント担当が催事や外部要因をイベントとして登録し、価格カレンダーの該当日に表示させる</span></div>
    </div>
""" + src("本ページは運用の進め方についての当社の提案であり、機能仕様ではない") + """
  </div>
"""))

# ── 裏表紙 ──
S.append(dict(kind="back", head=bar("　"), body="""
  <div class="big" style="margin-top:60mm;font-size:22pt">レベスト</div>
  <div class="sub">ホテル収益管理システム</div>
  <div class="src" style="position:absolute;left:16mm;bottom:14mm">本資料は consulting-pptx-skill（github.com/carnot-tech/consulting-pptx-skill）で作成</div>
"""))

html, pages = render(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'revest_jitsumusha.html'),
                     "レベスト 営業資料｜レベニューマネージャー・支配人向け", S)
print("pages:", pages, "slides:", len(S))
