# -*- coding: utf-8 -*-
"""レベスト営業資料の共通ビルダー。consulting-pptx-skill の基本パーツ集（.s 系）1家系のみで組む。"""
import io, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
CSS = open(os.path.join(BASE, 'base.css'), encoding='utf-8').read()

# 規約 §6（表・rows の本文 11.5pt／th は本文+2pt／行見出し軸は本文+4pt）に合わせた上書き。
# パーツ集の既定（td 10pt / th 11.5pt）は規約より小さいため、デッキ側で引き上げる。
OVERRIDE = """
/* ── 規約 §6 に合わせた文字サイズの引き上げ（パーツ集の既定を上書き） ── */
table{font-size:11.5pt}
th{font-size:13.5pt}
th.ax{font-size:13.5pt}
td.ax{font-size:15.5pt}
td{padding:3.4mm 2.5mm}
.rows .r{font-size:11.5pt}
.rows .l{font-size:15.5pt}
.two ul{font-size:11pt}
.card .bd{font-size:11pt}
.lev{font-size:11.5pt}
.lev th{font-size:13.5pt}
.hm{font-size:11.5pt}
.hm th{font-size:13.5pt}
.chev .x{font-size:9.5pt}

/* 凡例のハーベイボールが表中の玉と同じ形になるようにする（.legend i の 4mm 指定に潰されるのを防ぐ） */
.legend .hb{width:4.6mm;height:4.6mm}
.legend .hb i{position:absolute;inset:0;width:auto;height:auto}
.pil .p .px{font-size:9.5pt}

/* ── 出典行は左下の定位置に置く（規約 §4.47）。版面の中央寄せと取り合いにならないよう絶対配置にする ── */
.c > .src{position:absolute;left:16mm;right:16mm;bottom:15mm}

/* ── 並列カードは見出しの上端をそろえる（規約 §4.15） ── */
.pil .p{justify-content:flex-start}

/* ── 主張パネルは番号を置かないので、ラベルと主張を縦中央に寄せる ── */
.side .sp{justify-content:center}
.side .sp .cm{margin-top:4mm}

/* ── 章（論点）タグチップ。規約 §4.33：全区分を常設し、該当だけ濃色反転させる ── */
.kick{display:flex;gap:1.6mm;align-items:center}
.kick span{font-size:7.5pt;letter-spacing:.06em;color:var(--muted);padding:1.1mm 2.4mm;background:var(--soft);border-radius:0}
.kick span.on{background:var(--navy);color:#fff;font-weight:700}

/* ── 重み配分の100ドット盤。3系列を1枚の盤に塗り分け、合計100%であることを図で示す ── */
.dots100{display:grid;grid-template-columns:repeat(10,1fr);gap:1.6mm;width:72mm;align-self:center}
.dots100 i{width:100%;aspect-ratio:1;display:block}
.dots100 i.w1{background:var(--navy)}
.dots100 i.w2{background:var(--accent)}
.dots100 i.w3{background:var(--cyan)}
.legend.wt{justify-content:flex-start;gap:7mm;margin-bottom:5mm}
.legend.wt i.w1{background:var(--navy)}
.legend.wt i.w2{background:var(--accent)}
.legend.wt i.w3{background:var(--cyan)}

/* ── 折れ線チャート（パーツ集に無いので自作。規約 §5.11：推移はグラフで描く） ── */
.chart{flex:1;min-height:0;width:100%}
.chart text{font-family:var(--font-sans);fill:var(--muted)}
.chart .lbl{font-size:13px}
.chart .vl{font-size:13px;fill:var(--navy);font-weight:700}
"""

HEAD = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8">
<title>{title}</title>
<!-- consulting-pptx-skill（github.com/carnot-tech/consulting-pptx-skill）の基本パーツ集を土台に作成。
     規約: references/slide-rules.md ／ 検査: python3 scripts/check_deck.py <file> → FAIL 0 -->
<style>
{css}
{override}
</style></head><body>
<main class="deck">
"""
TAIL = "</main>\n</body></html>\n"

BRAND = "レベスト"


def bar(kicker=None, chips=None, active=None):
    """ヘッダー帯。chips を渡すと全区分のタグチップを常設し active だけ反転させる。"""
    if chips:
        inner = "".join(
            '<span class="%s">%s</span>' % ("on" if c == active else "", c) for c in chips
        )
        right = '<div class="kick">%s</div>' % inner
    else:
        right = '<div class="date">%s</div>' % (kicker or "")
    return '  <div class="bar"><div class="logo">%s</div>%s</div>' % (BRAND, right)


def foot(page):
    return '  <div class="foot"><b>%s</b><span>%s</span></div>' % (BRAND, page if page else "")


def src(text):
    return '    <div class="src">出典：%s</div>' % text


def weight_dots(parts):
    """合計100%を1枚の100ドット盤で示す（規約 §5.2：色を分けたら同一スライドに凡例）。
    parts: [(ラベル, 割合, クラス), ...] 割合の合計は 100 でなければならない。"""
    assert sum(p[1] for p in parts) == 100, parts
    cells = []
    for _label, pct, cls in parts:
        cells += ['<i class="%s"></i>' % cls] * pct
    legend = "".join(
        '<span><i class="%s"></i>%s　%d%%</span>' % (cls, label, pct)
        for label, pct, cls in parts
    )
    return ('<div class="legend left wt">%s</div><div class="dots100">%s</div>'
            % (legend, "".join(cells)))


def render(path, title, slides):
    """slides: [(kind, html_body_without_bar_and_foot)] kind='cover'|'back'|'body'"""
    out = io.StringIO()
    out.write(HEAD.format(title=title, css=CSS, override=OVERRIDE))
    page = 0
    for s in slides:
        if s["kind"] == "body":
            page += 1
            num = str(page)
        else:
            num = ""
        cls = "s cover" if s["kind"] in ("cover", "back") else "s"
        out.write('<section class="%s">\n' % cls)
        out.write(s["head"] + "\n")
        out.write(s["body"].rstrip("\n") + "\n")
        out.write(foot(num) + "\n")
        out.write("</section>\n")
    out.write(TAIL)
    html = out.getvalue()
    open(path, "w", encoding="utf-8").write(html)
    return html, page
