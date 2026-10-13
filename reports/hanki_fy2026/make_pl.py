import os, json, pathlib, re, urllib.request, urllib.parse
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

MONTHS = list(range(4, 10))
# (グループ見出し, [(行名, codes)])
GROUPS = [
    ("売上", [("売上（割引前）", ["sales"]), ("割引", ["discount"]), ("売上（割引後）", "NET")]),
    ("人件費", [("給与・交通費・福利厚生", ["salary_total", "transport_total", "commute_allowance", "welfare"]),
              ("賞与", ["bonus"]),
              ("法定福利費（社会保険の会社負担）", ["legal_welfare", "workers_comp"])]),
    ("店の固定費", [("家賃・商店街・加盟金・保険", ["rent", "shopping_street", "franchise_fee", "insurance"]),
                ("HPB掲載料", ["hpb"]),
                ("Twinkle管理料", ["twinkle_fee"]),
                ("減価償却", None)]),
    ("変動費・その他", [("仕入・備品・決済手数料", ["cogs", "supplies", "fees"]),
                  ("水道光熱・通信・サブスク", ["water_supply", "water_utility", "electricity", "gas", "communication", "garbage", "microsoft", "spotify", "amazon_prime"]),
                  ("広告・求人・外注・出張ほか", ["advertising", "recruitment", "training", "travel_expense", "outsourcing", "repair", "entertainment", "meeting"])]),
]
R = lambda x: round(x + 1e-9, 1)


def val(st, m, codes):
    return 6.4 if codes is None else sum(agg.get((st, m, c), 0) for c in codes)


def store_rows(st):
    rows = {}
    for _, items in GROUPS:
        for name, codes in items:
            if codes == "NET":
                rows[name] = [a - b for a, b in zip(rows["売上（割引前）"], rows["割引"])]
            else:
                rows[name] = [val(st, m, codes) for m in MONTHS]
    exp = [0] * 6
    for g, items in GROUPS[1:]:
        for name, _ in items:
            exp = [a + b for a, b in zip(exp, rows[name])]
    rows["経費合計"] = exp
    rows["純利益"] = [a - b for a, b in zip(rows["売上（割引後）"], exp)]
    return {k: [R(x) for x in v] + [R(sum(v))] for k, v in rows.items()}


r1, r2 = store_rows(1), store_rows(2)
r3 = {k: [R(a + b) for a, b in zip(r1[k], r2[k])] for k in r1}
assert r1["純利益"][-1] == 138.5 and r2["純利益"][-1] == 27.1 and r3["純利益"][-1] == 165.6


def cell(v, neg=False, cls=""):
    if abs(v) < 0.05:
        return f'<td class="z {cls}">—</td>'
    if neg:
        return f'<td class="minus {cls}">−{v:,.1f}</td>'
    return f'<td class="minus {cls}">−{-v:,.1f}</td>' if v < 0 else f'<td class="{cls}">{v:,.1f}</td>'


def table(title, sub, rows):
    sales_total = rows["売上（割引前）"][-1]
    h = [f'<section class="sheet"><div class="sheet-h"><h2>{title}</h2><div class="sub">{sub}</div></div>',
         '<table><thead><tr><th class="name" colspan="2">科目</th>' + "".join(f"<th>{m}月</th>" for m in MONTHS) +
         '<th class="tot">上半期計</th><th class="pct">構成比</th></tr></thead><tbody>']

    def line(name, cls="", neg=False, group=None):
        v = rows[name]
        pct = f"{v[-1] / sales_total * 100:.0f}%" if sales_total else ""
        gcell = f'<td class="grp" rowspan="{group[1]}">{group[0]}</td>' if group else ""
        namecell = f'<td class="name">{name}</td>' if (group or cls not in ("total", "profit")) else f'<td class="name" colspan="2">{name}</td>'
        h.append(f'<tr class="{cls}">{gcell}{namecell}' + "".join(cell(x, neg) for x in v[:-1]) + cell(v[-1], neg, "tot") + f'<td class="pct">{pct}</td></tr>')

    for g, items in GROUPS:
        first = True
        for name, _ in items:
            cls = "net" if name == "売上（割引後）" else ("neg" if name == "割引" else "")
            line(name, cls, name == "割引", (g, len(items)) if first else None)
            first = False
    line("経費合計", "total")
    line("純利益", "profit")
    h.append("</tbody></table>")
    rate = rows["純利益"][-1] / rows["売上（割引後）"][-1] * 100
    h.append(f'<p class="foot">上半期の純利益 <b>{rows["純利益"][-1]:,.1f}万円</b>（割引後売上の {rate:.1f}%）。構成比は売上（割引前）に対する割合。減価償却 6.4万円/月・店を含む。消費税の預かり・納付は別枠。9月の賞与は10/9支給の上半期賞与。</p></section>')
    return "".join(h)


HTML = f'''<?php
// 美容部 上半期 損益表（科目別・月別）FY2026 — 社長提出用レポートの別紙（印刷=A4横）
require __DIR__ . '/../nicolio-api/session_gate.php';
nicolio_session_gate();
header('Cache-Control: no-cache, no-store, must-revalidate');
?><!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>美容部 上半期 損益表 FY2026（別紙）</title>
<style>
  :root {{ --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781; --grid:#d9d8d0; --new:#2a78d6; --good:#006300; --down:#d03b3b; --hl:#e8f0fb; --band:#f5f4ef; }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ background:#f9f9f7; color:var(--ink); font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif; padding:20px 14px 40px; font-size:15px; line-height:1.5; }}
  .wrap {{ max-width:1100px; margin:0 auto; }}
  header.page h1 {{ font-size:1.35rem; }}
  header.page .sub {{ color:var(--ink-2); font-size:.85rem; margin-top:4px; }}
  .toolbar {{ margin:10px 0 0; font-size:.85rem; color:var(--ink-2); }}
  .toolbar a {{ color:var(--new); }}
  .sheet {{ background:#fff; border:1px solid rgba(0,0,0,.1); border-radius:12px; padding:18px 20px 14px; margin-top:18px; }}
  .sheet-h {{ display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:4px 12px; margin-bottom:10px; }}
  .sheet-h h2 {{ font-size:1.15rem; border-left:5px solid var(--new); padding-left:10px; }}
  .sheet-h .sub {{ color:var(--ink-2); font-size:.82rem; }}
  table {{ border-collapse:collapse; width:100%; font-size:.95rem; font-variant-numeric: tabular-nums; }}
  th, td {{ border:1px solid var(--grid); padding:6px 10px; text-align:right; white-space:nowrap; }}
  thead th {{ background:#eceae3; font-weight:600; }}
  th.name, td.name {{ text-align:left; }}
  td.grp {{ text-align:center; vertical-align:middle; background:var(--band); color:var(--ink-2); font-size:.8rem; font-weight:600; width:5.5em; writing-mode:horizontal-tb; }}
  td.tot, th.tot {{ background:#f7f6f2; font-weight:600; }}
  td.pct, th.pct {{ color:var(--ink-2); font-size:.85rem; width:5em; }}
  tr.net td {{ font-weight:600; }}
  tr.neg td.name {{ color:var(--ink-2); }}
  tr.total td {{ font-weight:700; background:#f7f6f2; border-top:2px solid #b9b8ae; }}
  tr.profit td {{ font-weight:700; background:var(--hl); border-top:2px solid var(--new); border-bottom:2px solid var(--new); font-size:1.02rem; }}
  tr.profit td.name {{ color:var(--new); }}
  td.minus {{ color:var(--down); }}
  td.z {{ color:var(--muted); }}
  p.foot {{ margin-top:8px; font-size:.82rem; color:var(--ink-2); }}
  footer {{ margin-top:20px; color:var(--muted); font-size:.78rem; }}
  @media print {{
    @page {{ size: A4 landscape; margin: 11mm 12mm; }}
    body {{ background:#fff; padding:0; font-size:12.5px; }}
    .wrap {{ max-width:none; }}
    .toolbar {{ display:none; }}
    .sheet {{ border:0; border-radius:0; padding:0; margin:0; break-after:page; page-break-after:always; }}
    .sheet:last-of-type {{ break-after:auto; page-break-after:auto; }}
    header.page {{ margin-bottom:6px; }}
    header.page h1 {{ font-size:1.15rem; }}
    .sheet-h {{ margin-top:4px; }}
    table {{ font-size:12px; }}
    th, td {{ padding:4px 8px; }}
    tr.profit td {{ font-size:12.5px; }}
    footer {{ display:none; }}
  }}
</style>
</head>
<body>
<div class="wrap">
<header class="page">
  <h1>美容部 上半期 損益表（科目別・月別）— 別紙</h1>
  <div class="sub">FY2026 上半期（2026年4月〜9月・確定）／単位: 万円／2026-10-13 杉原（美容部ミーティング）／出典: うりぼー実績</div>
  <div class="toolbar">印刷はA4横・店ごとに1枚（3枚）。本文レポートは <a href="hanki_fy2026_exec.php">こちら</a>。</div>
</header>
{table("寝屋川店", "FY2026 上半期（4〜9月）・万円", r1)}
{table("守口店", "FY2026 上半期（4〜9月）・万円", r2)}
{table("部門計（寝屋川＋守口）", "FY2026 上半期（4〜9月）・万円", r3)}
<footer>数字の基準: 売上はサロンボードの総売上（割引前・税込）。会計（TKC）の売上高は割引後のため約1割小さくなります。うりぼーの実績（4〜9月確定）から集計。</footer>
</div>
</body>
</html>
'''
(S / "pl.php").write_text(HTML, encoding="utf-8", newline="\n")
(S / "pl_preview.html").write_text(re.sub(r"^<\?php.*?\?>", "", HTML, flags=re.S), encoding="utf-8")

# 本文レポート側: 明細表を別紙リンクに置き換え（印刷に含めない）
t = (S / "exec.php").read_text(encoding="utf-8")
if '<details class="more"><summary>科目別・月別の損益表を見る' in t:
    a = t.index('<details class="more"><summary>科目別・月別の損益表を見る')
    b = t.index("</details>", a) + len("</details>")
    t = t[:a] + '<p class="note" style="margin-top:10px;"><b>科目別・月別の損益表（うりぼーの実績）は別紙</b>（<a href="hanki_fy2026_pl.php" style="color:var(--new)">hanki_fy2026_pl.php</a>・A4横3枚）。</p>' + t[b:]
assert t.count('class="pl"') == 0
(S / "exec.php").write_text(t, encoding="utf-8", newline="\n")
(S / "preview.html").write_text(re.sub(r"^<\?php.*?\?>", "", t, flags=re.S), encoding="utf-8")
print("ok")
