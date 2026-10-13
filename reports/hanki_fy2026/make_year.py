"""美容部 FY2026 一年通し「目標・実績・純利益」表（店ごと1枚＋部門計）
上半期(4〜9月)=期初目標 vs 実績・計画利益 vs 実績利益／下半期(10〜3月)=下期修正目標と計画利益／前年実績を参考列に。"""
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
EXCL = {"customers", "unit_price", "withholding_tax", "vat_purchase", "net_payable_tax", "other_expense", "total_expense",
        "net_profit", "profit_rate", "health_ins_total", "depreciation", "sales", "discount"}
H1, H2 = [4, 5, 6, 7, 8, 9], [10, 11, 12, 1, 2, 3]
YEAR = H1 + H2
LABEL = {m: f"{m}月" for m in YEAR}


def pl(rows):
    d = defaultdict(float)
    for r in rows:
        d[im[r["item_id"]]] += float(r["amount"]) / 1e4
    exp = sum(v for k, v in d.items() if k not in EXCL and not k.startswith(("cash_", "card_", "ic_", "gift_", "point_", "other_payment")))
    return d.get("sales", 0), d.get("sales", 0) - d.get("discount", 0) - exp - 6.4, d


def fetch(st, fy, dt, m):
    return get(f"beauty_monthly_data?fiscal_year=eq.{fy}&month=eq.{m}&data_type=eq.{dt}&store_id=eq.{st}&select=item_id,amount")


# 10/1確定の損益モデル（スタッフ版レポート）: 変動費率・固定費/月（寝屋川は10月168.7・3月172.0）
MODEL = {1: dict(var=0.144, fixed={m: 165.4 for m in H2} | {10: 168.7, 3: 172.0}),
         2: dict(var=0.132, fixed={m: 142.5 for m in H2})}


def store_data(st):
    D = {m: {} for m in YEAR}
    for m in YEAR:
        ys, yp, _ = pl(fetch(st, 2025, "実績", m))
        D[m]["ly_sales"], D[m]["ly_profit"] = ys, yp
    for m in H1:
        gs, gp, _ = pl(fetch(st, 2026, "目標", m))
        s, p, _ = pl(fetch(st, 2026, "実績", m))
        D[m].update(tgt_sales=gs, init_sales=gs, plan_profit=gp, sales=s, profit=p)
    md = MODEL[st]
    for m in H2:
        rows = fetch(st, 2026, "目標修正", m)
        s = sum(float(r["amount"]) for r in rows if im[r["item_id"]] == "sales") / 1e4
        assert s > 0, (st, m)
        i0 = sum(float(r["amount"]) for r in fetch(st, 2026, "目標", m) if im[r["item_id"]] == "sales") / 1e4
        D[m].update(tgt_sales=s, init_sales=i0, plan_profit=s * (1 - md["var"]) - md["fixed"][m], sales=None, profit=None)
    return D


def merge(a, b):
    D = {}
    for m in YEAR:
        D[m] = {}
        for k in a[m]:
            D[m][k] = None if a[m][k] is None else round(a[m][k] + 1e-9, 1) + round(b[m][k] + 1e-9, 1)
    return D


d1, d2 = store_data(1), store_data(2)
d3 = merge(d1, d2)


def sums(D, months):
    out = {}
    for k in ("ly_sales", "ly_profit", "tgt_sales", "init_sales", "plan_profit", "sales", "profit"):
        vals = [D[m][k] for m in months]
        out[k] = None if any(v is None for v in vals) else sum(vals)
    return out


for name, D in (("寝屋川", d1), ("守口", d2), ("部門計", d3)):
    a, b = sums(D, H1), sums(D, H2)
    print(name, "上半期 目標", round(a["tgt_sales"], 1), "実績", round(a["sales"], 1), "計画利益", round(a["plan_profit"], 1), "実績利益", round(a["profit"], 1),
          "| 下半期 目標", round(b["tgt_sales"], 1), "計画利益", round(b["plan_profit"], 1))
assert round(sums(d1, H1)["profit"], 1) == 138.5 and round(sums(d2, H1)["profit"], 1) == 27.1
assert round(sums(d1, H1)["tgt_sales"]) == 1380 and round(sums(d2, H1)["tgt_sales"]) == 1220


def f1(v, dash="—"):
    if v is None:
        return dash
    return f"{v:,.1f}" if v >= 0 else f"−{-v:,.1f}"


def td(v, cls="", neg_red=True):
    if v is None:
        return f'<td class="z {cls}">—</td>'
    c = cls + (" minus" if (v < 0 and neg_red) else "")
    return f'<td class="{c}">{f1(v)}</td>'


def pct(num, den, cls=""):
    if num is None or not den:
        return f'<td class="z {cls}">—</td>'
    r = num / den * 100
    c = cls + (" ok" if r >= 100 else " under")
    return f'<td class="{c}">{r:.0f}%</td>'


def exp(s, p):
    return None if s is None or p is None else s - p


def rev(d):
    """下期修正の列: 期初と同じ(上半期)なら — 、違えば修正値＋差"""
    if d.get("init_sales") is None or abs(d["tgt_sales"] - d["init_sales"]) < 0.05:
        return '<td class="z">—</td>'
    diff = d["tgt_sales"] - d["init_sales"]
    return f'<td class="revc">{d["tgt_sales"]:,.1f}<small class="{"up" if diff>0 else "dn"}">{"+" if diff>0 else "−"}{abs(diff):,.0f}</small></td>'


def row(label, d, cls=""):
    return (f'<tr class="{cls}"><td class="name">{label}</td>'
            f'{td(d["ly_sales"], "ref")}{td(d["init_sales"])}{rev(d)}{td(d["sales"], "act")}{pct(d["sales"], d["tgt_sales"])}'
            f'{td(exp(d["ly_sales"], d["ly_profit"]), "ref")}{td(exp(d["tgt_sales"], d["plan_profit"]))}{td(exp(d["sales"], d["profit"]), "act")}'
            f'{td(d["ly_profit"], "ref")}{td(d["plan_profit"])}{td(d["profit"], "prof")}</tr>')


def chart(D, title):
    W, H, ML, MT, MB = 1000, 200, 36, 20, 24
    allv = [D[m]["tgt_sales"] for m in YEAR] + [D[m]["sales"] or 0 for m in YEAR]
    ymax = 300 if max(allv) <= 300 else (500 if max(allv) <= 500 else 600)
    ph = H - MT - MB
    sy = lambda v: MT + ph * (1 - v / ymax)
    slot = (W - ML - 8) / 12
    o = [f'<svg viewBox="0 0 {W} {H}" class="chart">']
    for g in range(100, ymax + 1, 100):
        o.append(f'<line x1="{ML}" x2="{W-8}" y1="{sy(g):.1f}" y2="{sy(g):.1f}" stroke="#e1e0d9"/><text x="{ML-5}" y="{sy(g)+4:.1f}" text-anchor="end" font-size="10" fill="#898781">{g}</text>')
    o.append(f'<line x1="{ML}" x2="{W-8}" y1="{sy(0):.1f}" y2="{sy(0):.1f}" stroke="#c3c2b7"/>')
    for i, m in enumerate(YEAR):
        cx = ML + slot * i + slot / 2
        t, s = D[m]["tgt_sales"], D[m]["sales"]
        p = D[m]["profit"] if s is not None else D[m]["plan_profit"]
        bw = 22
        if s is not None:
            o.append(f'<rect x="{cx-bw-1:.1f}" y="{sy(t):.1f}" width="{bw}" height="{sy(0)-sy(t):.1f}" rx="3" fill="#b9d3f3"/>')
            o.append(f'<rect x="{cx+1:.1f}" y="{sy(s):.1f}" width="{bw}" height="{sy(0)-sy(s):.1f}" rx="3" fill="#2a78d6"/>')
            o.append(f'<text x="{cx+1+bw/2:.1f}" y="{sy(s)-4:.1f}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#2a78d6">{s:.0f}</text>')
            o.append(f'<text x="{cx-1-bw/2:.1f}" y="{sy(t)-4:.1f}" text-anchor="middle" font-size="9.5" fill="#6f8db3">{t:.0f}</text>')
        else:
            o.append(f'<rect x="{cx-bw/2:.1f}" y="{sy(t):.1f}" width="{bw}" height="{sy(0)-sy(t):.1f}" rx="3" fill="#b9d3f3" stroke="#6f8db3" stroke-dasharray="3 2"/>')
            o.append(f'<text x="{cx:.1f}" y="{sy(t)-4:.1f}" text-anchor="middle" font-size="10.5" font-weight="600" fill="#6f8db3">{t:.0f}</text>')
        pc = "#006300" if p >= 0 else "#d03b3b"
        o.append(f'<text x="{cx:.1f}" y="{H-11}" text-anchor="middle" font-size="10" fill="#898781">{LABEL[m]}</text>')
        o.append(f'<text x="{cx:.1f}" y="{H-1}" text-anchor="middle" font-size="9.5" font-weight="700" fill="{pc}">{"+" if p>0 else ""}{p:.0f}</text>')
    xm = ML + slot * 6
    o.append(f'<line x1="{xm:.1f}" x2="{xm:.1f}" y1="{MT-6}" y2="{H-MB+2}" stroke="#898781" stroke-dasharray="4 3"/>')
    o.append(f'<text x="{ML + slot*3:.1f}" y="11" text-anchor="middle" font-size="11" fill="#52514e">上半期（目標 vs 実績）</text><text x="{ML + slot*9:.1f}" y="11" text-anchor="middle" font-size="11" fill="#52514e">下半期（目標）</text>')
    o.append("</svg>")
    return (f'<div class="chartbox"><div class="ch">{title} 月別売上（万円）<span class="legend"><i style="background:#b9d3f3"></i>目標 <i style="background:#2a78d6;margin-left:8px"></i>実績 '
            f'<span style="margin-left:10px">月の下の数字＝残った利益（下半期は計画）</span></span></div>{"".join(o)}</div>')


def sheet(title, D):
    a, b = sums(D, H1), sums(D, H2)
    tot = {k: (a[k] + b[k] if a[k] is not None and b[k] is not None else None) for k in a}
    fc = {"ly_sales": tot["ly_sales"], "tgt_sales": tot["tgt_sales"], "sales": a["sales"] + b["tgt_sales"], "ly_profit": tot["ly_profit"],
          "plan_profit": tot["plan_profit"], "profit": a["profit"] + b["plan_profit"]}
    ach = a["sales"] / a["tgt_sales"] * 100
    tiles = f'''<div class="tiles">
      <div class="tile"><div class="l">上半期 売上</div><div class="n">{a["sales"]:,.0f}<small>万</small></div><div class="l">目標 {a["tgt_sales"]:,.0f}万 → <b class="{"ok" if ach>=100 else "under"}">{ach:.1f}%</b>・前年比 {a["sales"]/a["ly_sales"]*100:.0f}%</div></div>
      <div class="tile"><div class="l">上半期 純利益 ＝ 売上 {a["sales"]:,.0f} − 経費 {a["sales"]-a["profit"]:,.0f}</div><div class="n {"good" if a["profit"]>=0 else "bad"}">{f1(a["profit"])}<small>万</small></div><div class="l">期初の計画 {a["plan_profit"]:,.0f}万（経費 {a["tgt_sales"]-a["plan_profit"]:,.0f}） → <b class="{"ok" if a["profit"]>=a["plan_profit"] else "under"}">{a["profit"]/a["plan_profit"]*100:.0f}%</b></div></div>
      <div class="tile t"><div class="l">下半期 売上目標（10/1 下期修正）</div><div class="n">{b["tgt_sales"]:,.0f}<small>万</small></div><div class="l">期初 {b["init_sales"]:,.0f}万 → 修正 <b class="{"ok" if b["tgt_sales"]>=b["init_sales"] else "under"}">{"+" if b["tgt_sales"]>=b["init_sales"] else "−"}{abs(b["tgt_sales"]-b["init_sales"]):,.0f}万</b></div><div class="l">経費 {b["tgt_sales"]-b["plan_profit"]:,.0f}万 → 純利益 <b>{b["plan_profit"]:,.0f}万</b></div></div>
      <div class="tile y"><div class="l">通期の見込み（実績＋下半期目標）／期初目標 {tot["init_sales"]:,.0f}万</div><div class="n">{fc["sales"]:,.0f}<small>万</small></div><div class="l">経費 {fc["sales"]-fc["profit"]:,.0f}万 → 純利益 <b class="good">{fc["profit"]:,.0f}万</b>（前年 売上{tot["ly_sales"]:,.0f}／利益{f1(tot["ly_profit"])}）</div></div>
    </div>'''
    h = [f'<section class="sheet"><div class="sheet-h"><h2>{title}</h2><div class="sub">FY2026（2026年4月〜2027年3月）・万円</div></div>', tiles, chart(D, title),
         '<table><thead><tr><th rowspan="2" class="name">月</th><th colspan="5" class="g1">売上</th><th colspan="3" class="g2">経費（割引込み）</th><th colspan="3" class="g3">純利益 ＝ 売上 − 経費</th></tr>'
         '<tr><th class="ref">前年</th><th>期初目標</th><th>下期修正<br><small>（10/1）</small></th><th class="act">実績</th><th>達成率</th><th class="ref">前年</th><th>計画</th><th class="act">実績</th><th class="ref">前年</th><th>計画</th><th class="act">実績</th></tr></thead><tbody>']
    for m in H1:
        h.append(row(LABEL[m], D[m]))
    h.append(row("上半期計", a, "total"))
    for m in H2:
        h.append(row(LABEL[m], D[m], "t"))
    h.append(row("下半期計", b, "total t"))
    h.append(f'<tr class="year"><td class="name">通期（見込み）</td>{td(tot["ly_sales"], "ref")}{td(tot["init_sales"])}{rev(tot)}{td(fc["sales"], "act")}{pct(fc["sales"], tot["tgt_sales"])}'
             f'{td(exp(tot["ly_sales"], tot["ly_profit"]), "ref")}{td(exp(tot["tgt_sales"], tot["plan_profit"]))}{td(exp(fc["sales"], fc["profit"]), "act")}'
             f'{td(tot["ly_profit"], "ref")}{td(tot["plan_profit"])}{td(fc["profit"], "prof")}</tr>')
    h.append("</tbody></table>")
    h.append('<p class="foot">経費＝割引・人件費・家賃・HPB・仕入・水道光熱・減価償却など全部（割引を含むので 売上 − 経費 ＝ 純利益）。売上目標: 上半期＝期初目標。下半期は10/1に見直し（「下期修正」列＝修正後の目標と期初からの差。達成率・経費・純利益の計画は修正後の目標に対するもの）。純利益の計画: 上半期＝期初にうりぼーへ登録した計画、下半期＝10/1確定の損益モデル（変動費率と固定費/月）を月に展開したもの（下半期分の賞与・求人費・外注費は含まない）。'
             '純利益は減価償却6.4万円/月・店を含み、消費税の預かり・納付は別枠。9月の実績利益は10/9支給の上半期賞与を計上後。通期（見込み）の売上・純利益＝上半期実績＋下半期目標。</p></section>')
    return "".join(h)


HTML = f'''<?php
// 美容部 FY2026 一年通し「目標・実績・純利益」表 — 社長提出用レポートの別紙（印刷=A4縦・店ごと1枚）
require __DIR__ . '/../nicolio-api/session_gate.php';
nicolio_session_gate();
header('Cache-Control: no-cache, no-store, must-revalidate');
?><!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>美容部 FY2026 目標・実績・純利益（一年通し）</title>
<style>
  :root {{ --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781; --grid:#d9d8d0; --new:#2a78d6; --good:#006300; --down:#d03b3b; --hl:#e8f0fb; --tg:#eef4fc; --ref:#f6f5f0; }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{ background:#f9f9f7; color:var(--ink); font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif; padding:20px 14px 40px; font-size:15px; line-height:1.5; }}
  .wrap {{ max-width:960px; margin:0 auto; }}
  header.page h1 {{ font-size:1.35rem; }}
  header.page .sub {{ color:var(--ink-2); font-size:.85rem; margin-top:4px; }}
  .toolbar {{ margin:10px 0 0; font-size:.85rem; color:var(--ink-2); }} .toolbar a {{ color:var(--new); }}
  .sheet {{ background:#fff; border:1px solid rgba(0,0,0,.1); border-radius:12px; padding:16px 18px 12px; margin-top:18px; }}
  .sheet-h {{ display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:4px 12px; margin-bottom:8px; }}
  .sheet-h h2 {{ font-size:1.2rem; border-left:5px solid var(--new); padding-left:10px; }}
  .sheet-h .sub {{ color:var(--ink-2); font-size:.8rem; }}
  .tiles {{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:10px; }}
  @media (max-width:700px) {{ .tiles {{ grid-template-columns:1fr 1fr; }} }}
  .tile {{ border:1px solid var(--grid); border-radius:10px; padding:8px 10px; }}
  .tile.t {{ background:var(--tg); }} .tile.y {{ background:#f3f1ea; }}
  .tile .l {{ font-size:.74rem; color:var(--ink-2); line-height:1.4; }}
  .tile .n {{ font-size:1.6rem; font-weight:750; letter-spacing:-.5px; line-height:1.2; margin:2px 0; }}
  .tile .n small {{ font-size:.8rem; font-weight:600; color:var(--ink-2); }}
  .n.good, b.ok {{ color:var(--good); }} .n.bad, b.under {{ color:var(--down); }}
  .chartbox {{ border:1px solid var(--grid); border-radius:10px; padding:8px 10px 2px; margin-bottom:10px; }}
  .chartbox .ch {{ font-size:.85rem; font-weight:600; display:flex; justify-content:space-between; flex-wrap:wrap; gap:4px; }}
  .chartbox .legend {{ font-weight:400; font-size:.74rem; color:var(--ink-2); }}
  .chartbox .legend i {{ display:inline-block; width:10px; height:10px; border-radius:3px; vertical-align:-1px; margin-right:4px; }}
  svg.chart {{ width:100%; height:auto; display:block; }}
  table {{ border-collapse:collapse; width:100%; font-size:.92rem; font-variant-numeric: tabular-nums; }}
  th, td {{ border:1px solid var(--grid); padding:5px 10px; text-align:right; white-space:nowrap; }}
  thead th {{ background:#eceae3; font-weight:600; }}
  th.name, td.name {{ text-align:left; }}
  thead th.g1 {{ background:#dfe9f7; }} thead th.g2 {{ background:#f3e9dc; }} thead th.g3 {{ background:#e3f1e3; }}
  thead th.act {{ background:#e4e2da; }} td.act {{ font-weight:600; }}
  th.ref, td.ref {{ background:var(--ref); color:var(--ink-2); font-size:.85rem; }}
  td.prof {{ font-weight:700; background:var(--hl); }}
  tr.t td {{ background:var(--tg); color:var(--ink-2); }} tr.t td.ref {{ background:#eceee9; }} tr.t td.prof {{ background:#dfe9f7; color:var(--ink-2); font-weight:600; }}
  tr.total td {{ font-weight:700; background:#f7f6f2; border-top:2px solid #b9b8ae; }}
  tr.total.t td {{ background:#e3eaf3; color:var(--ink); }}
  tr.year td {{ font-weight:700; background:#efede6; border-top:2px solid var(--new); border-bottom:2px solid var(--new); }}
  td.ok {{ color:var(--good); font-weight:600; }} td.under {{ color:var(--down); }}
  td.minus {{ color:var(--down); }} td.z {{ color:var(--muted); }}
  td.revc {{ background:#fff7e6; font-weight:600; }} td.revc small {{ font-size:.72rem; margin-left:3px; font-weight:600; }} td.revc small.up {{ color:var(--good); }} td.revc small.dn {{ color:var(--down); }}
  p.foot {{ margin-top:8px; font-size:.78rem; color:var(--ink-2); }}
  footer {{ margin-top:20px; color:var(--muted); font-size:.78rem; }}
  @media print {{
    @page {{ size: A4 portrait; margin: 10mm 11mm; }}
    body {{ background:#fff; padding:0; font-size:11.5px; }}
    .wrap {{ max-width:none; }} .toolbar, footer {{ display:none; }}
    .sheet {{ border:0; border-radius:0; padding:0; margin:0; break-after:page; page-break-after:always; }}
    .sheet:last-of-type {{ break-after:auto; page-break-after:auto; }}
    header.page {{ margin-bottom:4px; }} header.page h1 {{ font-size:1.1rem; }}
    .tiles {{ gap:6px; }} .tile .n {{ font-size:1.3rem; }}
    .chartbox {{ padding:4px 8px 0; }} svg.chart {{ max-height:48mm; }}
    table {{ font-size:9.8px; }} th, td {{ padding:3px 4px; }}
    p.foot {{ font-size:.7rem; margin-top:5px; }}
  }}
</style>
</head>
<body>
<div class="wrap">
<header class="page">
  <h1>美容部 FY2026 目標・実績・純利益（一年通し）— 別紙</h1>
  <div class="sub">上半期＝実績が確定（4〜9月）／下半期＝10/1確定の目標（10〜3月）／単位: 万円／2026-10-13 杉原（美容部ミーティング）／出典: うりぼー</div>
  <div class="toolbar">印刷はA4縦・店ごとに1枚（3枚）。本文レポートは <a href="hanki_fy2026_exec.php">こちら</a>／上半期の科目別損益表は <a href="hanki_fy2026_pl.php">こちら</a>。</div>
</header>
{sheet("寝屋川店", d1)}
{sheet("守口店", d2)}
{sheet("部門計（寝屋川＋守口）", d3)}
<footer>数字の基準: 売上はサロンボードの総売上（割引前・税込）。会計（TKC）の売上高は割引後のため約1割小さくなります。</footer>
</div>
</body>
</html>
'''
(S / "year.php").write_text(HTML, encoding="utf-8", newline="\n")
(S / "year_preview.html").write_text(re.sub(r"^<\?php.*?\?>", "", HTML, flags=re.S), encoding="utf-8")
print("ok")
