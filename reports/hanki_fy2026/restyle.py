import os, sys, json, pathlib, urllib.request, urllib.parse
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv(r"C:\Users\nikon\projects\uribo\scripts\.env")
S = pathlib.Path(__file__).parent
API = os.getenv("NICOLIO_API_URL", "https://twinklemark.xsrv.jp/nicolio-api/api.php")
TOK = os.getenv("NICOLIO_API_TOKEN", "nicolio_secret_2525xsrv")


def get(p):
    p = urllib.parse.quote(p, safe="=&?,.*")
    r = urllib.request.Request(f"{API}/{p}", headers={"Authorization": f"Bearer {TOK}"})
    return json.loads(urllib.request.urlopen(r).read().decode())


im = {i["id"]: i["item_code"] for i in get("beauty_item_master?select=id,item_code")}
agg = defaultdict(float)
for m in range(4, 10):
    for r in get(f"beauty_monthly_data?fiscal_year=eq.2026&month=eq.{m}&data_type=eq.実績&select=store_id,month,item_id,amount"):
        agg[(r["store_id"], m, im[r["item_id"]])] += float(r["amount"]) / 10000


def hv(st, codes):
    return sum(agg.get((st, m, c), 0) for m in range(4, 10) for c in codes)


PEOPLE = ["salary_total", "transport_total", "commute_allowance", "welfare", "bonus", "legal_welfare", "workers_comp"]
FIXED = ["rent", "shopping_street", "franchise_fee", "insurance", "hpb", "twinkle_fee"]
OTHER = ["cogs", "supplies", "fees", "water_supply", "water_utility", "electricity", "gas", "communication", "garbage",
         "microsoft", "spotify", "amazon_prime", "advertising", "recruitment", "training", "travel_expense",
         "outsourcing", "repair", "entertainment", "meeting"]
SEG = [("割引", "#c3c2b7", "discount"),
       ("人件費（給与・賞与・社保）", "#86b6ef", PEOPLE),
       ("店の固定費（家賃・加盟金・HPB・Twinkle・減価償却）", "#2a78d6", FIXED),
       ("仕入・光熱・その他", "#d9d6c9", OTHER),
       ("残った利益", "#2e8b57", None)]
PROF = {}


def flow(st, name):
    sales = hv(st, ["sales"])
    vals = []
    for lbl, col, codes in SEG:
        if codes is None:
            v = sales - sum(x for _, _, x in vals)
        elif codes == "discount":
            v = hv(st, ["discount"])
        else:
            v = hv(st, codes) + (6.4 * 6 if codes is FIXED else 0)
        vals.append((lbl, col, v))
    PROF[st] = vals[-1][2]
    bar = "".join(f'<span class="seg" style="flex:{v / sales * 100:.2f};background:{col}" title="{lbl} {v:,.1f}万円"></span>' for lbl, col, v in vals)
    lab = "".join(f'<span class="lg"><i style="background:{col}"></i>{lbl} <b>{v:,.0f}万</b>（{v / sales * 100:.0f}%）</span>' for lbl, col, v in vals)
    return f'<div class="flow"><div class="flow-h"><b>{name}</b> 売上 {sales:,.0f}万円 の行き先</div><div class="bar">{bar}</div><div class="lgs">{lab}</div></div>'


F = flow(1, "寝屋川店") + flow(2, "守口店")
print("profit check", PROF)
assert round(PROF[1], 1) == 138.5 and round(PROF[2], 1) == 27.1

t = (S / "exec.php").read_text(encoding="utf-8")


def rep(a, b):
    global t
    assert t.count(a) == 1, (a[:60], t.count(a))
    t = t.replace(a, b)


CSS = """  .flow { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; margin-top:12px; }
  .flow-h { font-size:.95rem; margin-bottom:8px; }
  .bar { display:flex; height:34px; border-radius:8px; overflow:hidden; }
  .bar .seg { display:block; min-width:2px; }
  .lgs { display:flex; flex-wrap:wrap; gap:4px 16px; margin-top:8px; font-size:.82rem; color:var(--ink-2); }
  .lgs i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
  .lgs b { color:var(--ink); }
  details.more { margin-top:12px; }
  details.more summary { cursor:pointer; color:var(--new); font-size:.9rem; padding:6px 0; }
  .tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:12px; }
  @media (max-width:640px){ .tiles{grid-template-columns:1fr;} }
  .tile { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 14px; text-align:center; }
  .tile .n { font-size:1.9rem; font-weight:750; letter-spacing:-.5px; }
  .tile .n small { font-size:.9rem; font-weight:600; color:var(--ink-2); }
  .tile .l { font-size:.82rem; color:var(--ink-2); }
  .tile.good .n { color:var(--good); }
  footer { margin-top: 36px;"""
rep("  footer { margin-top: 36px;", CSS)

# 1. 売上の結果: 月次売上表を折りたたみ
rep('  <h3 style="margin-top:18px;">月次実績（万円・前年同月比つき）</h3>\n  <div class="tablebox">',
    '  <details class="more"><summary>月ごとの売上の数字を見る（前年同月比つき）</summary>\n  <div class="tablebox">')
rep("守口の4月80%は前年4月が突出していた反動。5月以降は毎月前年超えで、比率は月を追うごとに上がっています（107→140%）。</p>",
    "守口の4月80%は前年4月が突出していた反動。5月以降は毎月前年超えで、比率は月を追うごとに上がっています（107→140%）。</p>\n  </details>")

# 2. 損益の結果: タイル＋行き先バー＋月別利益チャート、明細表は折りたたみ
a = t.index('<p class="note">売上は割引前の総売上から割引を引いて')
b = t.index('<h3 style="margin-top:14px;">寝屋川店（万円）')
BLOCK = f"""<div class="tiles">
    <div class="tile good"><div class="l">寝屋川店 上半期の純利益</div><div class="n">138.5<small>万円</small></div><div class="l">売上の約10%・毎月黒字</div></div>
    <div class="tile good"><div class="l">守口店 上半期の純利益</div><div class="n">27.1<small>万円</small></div><div class="l">売上の約3%・4〜5月の赤字を取り返し黒字着地</div></div>
    <div class="tile good"><div class="l">部門計 上半期の純利益</div><div class="n">165.6<small>万円</small></div><div class="l">消費税の預かり（計147万円）は別枠</div></div>
  </div>
  <h3 style="margin-top:22px;">売上はどこへ行ったか（上半期の合計）</h3>
  {F}
  <h3 style="margin-top:22px;">月ごとに残った利益（万円）</h3>
  <div class="chartbox"><h3>寝屋川店<span class="legend"><span><i style="background:var(--good)"></i>黒字</span><span><i style="background:var(--down)"></i>赤字</span></span></h3><div id="chart-neya-profit"></div></div>
  <div class="chartbox"><h3>守口店<span class="legend"><span><i style="background:var(--good)"></i>黒字</span><span><i style="background:var(--down)"></i>赤字</span></span></h3><div id="chart-mori-profit"></div></div>
  <p class="note" style="margin-top:6px;">守口の5月は広告16.5万円の先行投資で赤字幅が大きく、6月以降は毎月黒字。両店とも9月は10/9支給の上半期賞与（寝屋川13.5万・守口8.5万）を計上したぶん利益が小さく見えています。</p>
  <details class="more"><summary>科目別・月別の損益表を見る（うりぼーの実績・3表）</summary>
  <p class="note">売上は割引前の総売上から割引を引いて「割引後」を出し、そこから経費を引いたものが純利益です。減価償却（6.4万円/月・店）を含み、消費税の預かり・納付は別枠です。</p>
"""
t = t[:a] + BLOCK + t[b:]
rep('\n  <p class="note" style="margin-top:6px;"><b>読み方:</b>', '\n  </details>\n  <p class="note" style="margin-top:6px;"><b>読み方:</b>')

JS = """  function profitChart(mount, store, months, vals) {
    var H2 = 220, YM = 60, top = 14, bot = 26, ph = H2 - top - bot;
    function py(v) { return top + ph * (1 - (v + 30) / (YM + 30)); }
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H2, role: 'img' });
    document.getElementById(mount).appendChild(svg);
    [-20, 0, 20, 40, 60].forEach(function (g) {
      el('line', { x1: ML, x2: W - MR, y1: py(g), y2: py(g), stroke: g === 0 ? C.baseline : C.grid, 'stroke-width': 1 }, svg);
      var tx = el('text', { x: ML - 6, y: py(g) + 4, 'text-anchor': 'end', 'font-size': 10, fill: C.muted }, svg); tx.textContent = g;
    });
    var slot = plotW / months.length, bw = 46;
    months.forEach(function (m, i) {
      var cx = ML + slot * i + slot / 2, v = vals[i], col = v >= 0 ? '#006300' : '#d03b3b';
      var y0 = py(Math.max(v, 0)), h = Math.abs(py(0) - py(v));
      var p = el('path', { d: barPath(cx - bw / 2, y0, bw, Math.max(h, 1)), fill: col }, svg);
      p.addEventListener('mousemove', function (evt) { showTip(evt, '<b>' + store + ' ' + m + '</b><br>残った利益: ' + v.toFixed(1) + '万円'); });
      p.addEventListener('mouseleave', hideTip);
      var lb = el('text', { x: cx, y: v >= 0 ? y0 - 5 : y0 + h + 12, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: col }, svg);
      lb.textContent = (v > 0 ? '+' : '') + v.toFixed(1);
      var mt = el('text', { x: cx, y: H2 - 8, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted }, svg); mt.textContent = m;
    });
  }
  var M1 = ['4月', '5月', '6月', '7月', '8月', '9月'];
  profitChart('chart-neya-profit', '寝屋川店', M1, [-0.7, 13.8, 23.0, 53.4, 40.0, 8.8]);
  profitChart('chart-mori-profit', '守口店', M1, [-13.1, -25.8, 4.5, 24.2, 27.8, 9.5]);"""
rep("  var M1 = ['4月', '5月', '6月', '7月', '8月', '9月'];", JS)

(S / "exec.php").write_text(t, encoding="utf-8", newline="\n")
print("ok")
