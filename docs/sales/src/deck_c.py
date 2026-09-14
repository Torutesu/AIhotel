# -*- coding: utf-8 -*-
"""レベスト 営業資料 C：販売代理店・パートナー向け"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import bar, src, render

SPEC = "レベスト機能仕様（2026年9月時点）"
S = []

S.append(dict(kind="cover", head=bar("販売代理店・パートナー向け　2026年9月"), body="""
  <div class="big">勘に頼っていた客室料金の判断を、<br>数字で決める仕組みとして売る</div>
  <div class="rule"></div>
  <div class="sub">レベスト｜ホテル収益管理システム</div>
"""))

# ── P1 提供範囲 ──
S.append(dict(kind="body", head=bar("何を売るか"), body="""
  <h1>レベストが扱うのは、実績の可視化・価格の決定・需要の把握・月次の報告</h1>
  <div class="c" style="justify-content:center">
    <div class="pil grid g4 fix">
      <div class="p"><span class="pt">実績の可視化</span><span class="px">室料売上・販売室数・ADR（平均客室単価）・稼働率・REV-Per（販売可能客室1室あたりの収益。RevPARと同じ指標）などを月別に並べ、予算比と前年比を同じ画面で確認できる</span></div>
      <div class="p"><span class="pt">価格の決定</span><span class="px">稼働率・ADR・競合追従度の重みを画面で調整でき、日別の推奨単価と料金ランクをカレンダーに出す</span></div>
      <div class="p"><span class="pt">需要の把握</span><span class="px">宿泊日までの予約の積み上がりを見て、競合の価格を利用人数別に比べる</span></div>
      <div class="p"><span class="pt">月次の報告</span><span class="px">対象月を選んで月次レポートを生成し、PDFとExcelで出力する</span></div>
    </div>
    <div class="base"><b>データの分離</b><span>契約企業ごとにデータを分け、他社のデータは参照できない</span></div>
    <div class="base" style="margin-top:2.5mm"><b>変更の記録</b><span>価格戦略・料金ランク・予算の変更を、誰がいつ変えたかの記録として残す</span></div>
""" + src(SPEC) + """
  </div>
"""))

# ── P2 画面と担当者 ──
S.append(dict(kind="body", head=bar("何を売るか"), body="""
  <h1>画面は、設定から日々の確認・価格決定・報告までの順に並ぶ</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:40mm">使う順</th><th style="width:44mm">画面</th><th>主な機能</th></tr>
      <tr><td class="ax">導入時に整える</td><td class="b">設定</td><td>料金ランク・競合・月次予算・週末の扱いを登録し、ユーザーを追加する</td></tr>
      <tr><td class="ax">毎朝見る</td><td class="b">ダッシュボード</td><td>月別のKPI進捗と、重要度の高いアラートを見る</td></tr>
      <tr><td class="ax">価格を決める</td><td class="b">プライシング</td><td>日別の推奨単価・料金ランク・イベントを確かめ、重み付けを調整する</td></tr>
      <tr><td class="ax">需要を読む</td><td class="b">日別分析</td><td>宿泊日までの予約の積み上がりを見て、競合の価格を利用人数別に比べる</td></tr>
      <tr><td class="ax">傾向を振り返る</td><td class="b">期間分析</td><td>年間の月次推移と、競合との価格差を見る</td></tr>
      <tr><td class="ax">月末に締める</td><td class="b">レポート</td><td>対象月の月次レポートをPDFとExcelで出力する</td></tr>
    </table>
""" + src(SPEC) + """
  </div>
"""))

# ── P3 権限 ──
S.append(dict(kind="body", head=bar("顧客のなかでの使われ方"), body="""
  <h1>権限は運営・管理者・マネージャー・オペレーターに分かれ、<br>契約企業を越えられるのは運営だけ</h1>
  <div class="c">
    <div class="legend"><span><span class="hb q4"><i></i></span>できる</span><span><span class="hb q2"><i></i></span>一部できる（対象が限られる）</span><span><span class="hb q0"><i></i></span>できない</span></div>
    <table>
      <tr><th class="ax" style="width:42mm">ロール</th><th class="hbc" style="width:26mm">実績の閲覧</th><th class="hbc" style="width:26mm">設定の変更</th><th class="hbc" style="width:30mm">ユーザー管理</th><th class="hbc" style="width:32mm">他社のデータ</th><th>誰が持つか</th></tr>
      <tr><td class="ax">運営</td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td>レベストを提供する当社が持つ。顧客にもパートナーにも渡さない</td></tr>
      <tr><td class="ax">管理者</td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q0"><i></i></span></td><td>契約企業の情報システム担当や経営企画が持つ</td></tr>
      <tr><td class="ax">マネージャー</td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q2"><i></i></span></td><td class="hbc"><span class="hb q0"><i></i></span></td><td>支配人やレベニュー担当が持つ。管理者の権限は付与できない</td></tr>
      <tr><td class="ax">オペレーター</td><td class="hbc"><span class="hb q4"><i></i></span></td><td class="hbc"><span class="hb q2"><i></i></span></td><td class="hbc"><span class="hb q0"><i></i></span></td><td class="hbc"><span class="hb q0"><i></i></span></td><td>フロント担当が持つ。設定のうち変えられるのはイベントだけで、価格の設定には触れない</td></tr>
    </table>
""" + src(SPEC) + """
  </div>
"""))

# ── P4 マルチテナント ──
S.append(dict(kind="body", head=bar("顧客のなかでの使われ方"), body="""
  <h1>契約企業が増えても、基盤は1つのまま受け入れられる</h1>
  <div class="c">
    <div class="two">
      <div>
        <div class="colh">基盤の仕組み</div>
        <table>
          <tr><td class="ax" style="width:38mm">データの分離</td><td>すべてのデータに契約企業の識別子を持たせ、データを取り出すたびに絞り込む</td></tr>
          <tr><td class="ax">認証の照合</td><td>ログインで発行するトークンに所属を埋め込み、要求のたびに照合する</td></tr>
          <tr><td class="ax">権限の制限</td><td>契約企業を越えられる権限は、当社の運営ロールだけが持つ</td></tr>
          <tr><td class="ax">変更の記録</td><td>設定を誰がいつ変えたかを、契約企業ごとの記録として残す</td></tr>
        </table>
      </div>
      <div class="tri"></div>
      <div>
        <div class="colh">契約企業が増えたときに起きること</div>
        <ul>
          <li>当社は、契約企業ごとに別のシステムを用意せず、同じ基盤に追加する</li>
          <li>契約企業の管理者は、施設とユーザーを自分で追加する</li>
          <li>当社は、機能の追加を全契約企業に同じ時期に届ける</li>
          <li>契約企業は、設定を誰がいつ変えたかを自社の記録として確かめられる</li>
        </ul>
      </div>
    </div>
""" + src(SPEC) + """
  </div>
"""))

# ── P5 技術構成 ──
S.append(dict(kind="body", head=bar("構築と運用"), body="""
  <h1>技術構成はクラウド事業者に依存せず、AWSとGCPのどちらにも置ける</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:44mm">層</th><th>採用している技術</th><th>そう決めた理由</th></tr>
      <tr><td class="ax">画面</td><td>Next.js（App Router）</td><td>配信先を選ばず、社内サーバーでもクラウドでも同じものを出せる</td></tr>
      <tr><td class="ax">サーバー</td><td>Express と TypeScript、Prisma</td><td>Dockerコンテナで動くため、設置先を選ばない</td></tr>
      <tr><td class="ax">データベース</td><td>PostgreSQL 16</td><td>マネージドサービスでも自前構築でも、接続先を差し替えるだけで動く</td></tr>
      <tr><td class="ax">設定の管理</td><td>環境変数を1か所に集約</td><td>クラウド固有の部品を製品に持ち込まないため、移設の影響がここだけに収まる</td></tr>
    </table>
""" + src(SPEC) + """
  </div>
"""))

# ── P6 品質 ──
S.append(dict(kind="body", head=bar("構築と運用"), body="""
  <h1>製品に取り込むのは、型チェックからDockerビルドまでを通過した変更だけ</h1>
  <div class="c" style="justify-content:center">
    <div class="chev">
      <div class="cv"><span class="n">1</span><span class="t">型とコード規約</span><span class="x">画面側とサーバー側の両方で、型チェックとコード規約の検査を通す</span></div>
      <div class="cv"><span class="n">2</span><span class="t">テスト</span><span class="x">単体テストに加え、実際のデータベースをつないだ統合テストを走らせる</span></div>
      <div class="cv"><span class="n">3</span><span class="t">データベースの整合</span><span class="x">データベースの定義と更新手順がずれていないかを検査し、初期データを何度投入しても同じ状態になることを確かめる</span></div>
      <div class="cv"><span class="n">4</span><span class="t">ビルドと監査</span><span class="x">両方のビルドと依存関係の脆弱性監査、本番用Dockerイメージの構築まで通す</span></div>
    </div>
""" + src("4段はすべて必須で、1つでも失敗した変更は製品に反映しない　／　レベストの継続的インテグレーション設定（2026年9月時点）") + """
  </div>
"""))

# ── P7 商談での想定問答 ──
S.append(dict(kind="body", head=bar("商談での進め方"), body="""
  <h1>商談で答えてよい内容と、当社に回す論点をあらかじめ分けておく</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:44mm">よく聞かれる論点</th><th>その場で答えてよい内容</th><th>当社に回すべき場面</th></tr>
      <tr><td class="ax">始めるのに要るデータ</td>
        <td>日別の販売室数と室料売上、月次の予算がそろえば取り込みを始められる</td>
        <td>提供形式が特殊で、取り込みに変換が要りそうなとき</td></tr>
      <tr><td class="ax">データの置き場所</td>
        <td>AWSとGCPのどちらでも構築でき、接続先は設定で差し替える</td>
        <td>顧客が置き場所や国内保管を指定するとき</td></tr>
      <tr><td class="ax">他社データの分離</td>
        <td>契約企業を越えられるのは当社の運営ロールだけで、顧客の管理者も越えられない</td>
        <td>顧客の情報システム部門が監査資料を求めるとき</td></tr>
      <tr><td class="ax">費用と契約の形</td>
        <td>見積もりは個別に当社が出す旨のみ伝える</td>
        <td>金額・契約条件に触れるときは必ず当社に回す</td></tr>
    </table>
""" + src(SPEC) + """
  </div>
"""))

# ── P8 役割分担 ──
S.append(dict(kind="body", head=bar("商談での進め方"), body="""
  <h1>パートナーが担うのは顧客の開拓から一次窓口までで、<br>構築と保守は当社が担う</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:44mm">局面</th><th>パートナーが担うこと</th><th>当社が担うこと</th></tr>
      <tr><td class="ax">顧客の開拓</td>
        <td>顧客を開拓し、業務課題を聞き取る</td>
        <td>想定問答と資料を提供し、初回は商談に同席する</td></tr>
      <tr><td class="ax">提案</td>
        <td>本資料をもとに機能と提供範囲を説明する</td>
        <td>デモ環境を用意し、個別の確認事項に回答する</td></tr>
      <tr><td class="ax">見積もりと契約</td>
        <td>対象施設と試験運用の期間を顧客と詰める</td>
        <td>見積もりを作り、契約条件を提示する</td></tr>
      <tr><td class="ax">導入作業</td>
        <td>顧客との日程を調整する</td>
        <td>環境を用意し、受け取った実績データを取り込む</td></tr>
      <tr><td class="ax">運用開始後</td>
        <td>問い合わせを一次で受ける</td>
        <td>障害と機能追加に対応し、変更内容を共有する</td></tr>
    </table>
""" + src(SPEC) + """
  </div>
"""))

# ── P9 次に決めること ──
S.append(dict(kind="body", head=bar("次に決めること"), body="""
  <h1>対象とする顧客層と初回の共同提案先を、はじめに決める</h1>
  <div class="c">
    <table class="eq">
      <tr><th class="ax" style="width:46mm">決めること</th><th>論点</th><th>当社の考え</th></tr>
      <tr><td class="ax">対象とする顧客層</td>
        <td>単独の施設を狙うか、複数施設を持つ運営会社を狙うか</td>
        <td>施設ごとの設定を持ったまま横断で集計できるため、複数施設のほうが向く</td></tr>
      <tr><td class="ax">初回の共同提案先</td>
        <td>どの顧客に、いつ、どちらが主体で提案するか</td>
        <td>初回は当社が同席し、想定問答を実際の商談で補う</td></tr>
      <tr><td class="ax">提案時の資料</td>
        <td>経営層向けと実務者向けのどちらを先に出すか</td>
        <td>初回は経営層向けを使い、二回目以降に実務者向けを使う</td></tr>
      <tr><td class="ax">検証環境</td>
        <td>デモに使う環境を、パートナー側に常設するかどうか</td>
        <td>サンプルデータを入れた環境を用意し、画面を触りながら説明できる形にする</td></tr>
    </table>
""" + src("レベスト機能仕様（2026年9月時点）。当社の考えは提案であり、実測値にもとづくものではない") + """
  </div>
"""))

S.append(dict(kind="back", head=bar("　"), body="""
  <div class="big" style="margin-top:60mm;font-size:22pt">レベスト</div>
  <div class="sub">ホテル収益管理システム</div>
  <div class="src" style="position:absolute;left:16mm;bottom:14mm">本資料は consulting-pptx-skill（github.com/carnot-tech/consulting-pptx-skill）で作成</div>
"""))

html, pages = render(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'revest_partner.html'),
                     "レベスト 営業資料｜販売代理店・パートナー向け", S)
print("pages:", pages, "slides:", len(S))
