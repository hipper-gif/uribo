<?php
// 美容部 上半期実績と下半期目標（社長提出用・FY2026）
// Nicolioセッションゲート（うりぼー index.php と同方式・ADR-0003）
require __DIR__ . '/../nicolio-api/session_gate.php';
nicolio_session_gate();
header('Cache-Control: no-cache, no-store, must-revalidate');
?><!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>美容部 上半期実績と下半期目標 FY2026</title>
<style>
  :root {
    color-scheme: light;
    --page:        #f9f9f7;
    --surface:     #fcfcfb;
    --ink:         #0b0b0b;
    --ink-2:       #52514e;
    --muted:       #898781;
    --grid:        #e1e0d9;
    --baseline:    #c3c2b7;
    --border:      rgba(11,11,11,0.10);
    --new:         #2a78d6;  /* 今年実績・下期修正 */
    --old:         #86b6ef;  /* 前年実績・期初目標 */
    --good:        #006300;
    --down:        #d03b3b;
    --warn-bg:     #fdf6e8;
    --ok-bg:       #eef7ee;
    --hl-bg:       #e8f0fb;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: var(--page); color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
    line-height: 1.7; padding: 20px 14px 60px;
    font-size: 16px;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  header.page h1 { font-size: 1.5rem; line-height:1.35; }
  header.page .sub { color: var(--ink-2); font-size: .85rem; margin-top: 4px; }
  .lead {
    background: var(--surface); border:1px solid var(--border); border-radius: 12px;
    padding: 16px 20px; margin-top: 16px; font-size: .95rem;
  }
  .lead li { margin-left: 1.2em; margin-top: 4px; }

  section { margin-top: 34px; }
  h2 { font-size: 1.1rem; border-left: 4px solid var(--new); padding-left: 10px; margin-bottom: 14px; }
  h3 { font-size: .95rem; margin-bottom: 8px; }
  p.note { color: var(--ink-2); font-size: .85rem; }

  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
  .card .store { font-weight: 700; display:flex; align-items:center; gap:8px; }
  .pill { font-size:.72rem; font-weight:600; border-radius:99px; padding:1px 9px; }
  .pill.ok   { background: var(--ok-bg); color: var(--good); }
  .pill.warn { background: var(--warn-bg); color: #8a5a00; }
  .hero { font-size: 2.3rem; font-weight: 750; letter-spacing: -0.5px; }
  .hero small { font-size: 1rem; font-weight: 600; color: var(--ink-2); }
  .kv { display:flex; flex-wrap:wrap; gap: 4px 18px; margin-top: 6px; font-size:.88rem; color: var(--ink-2); }
  .kv b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .verdict { margin-top: 10px; font-size: .9rem; border-top: 1px dashed var(--grid); padding-top: 8px; }

  .chartbox { background: var(--surface); border:1px solid var(--border); border-radius:12px; padding: 14px 14px 8px; margin-top: 12px; }
  .chartbox h3 { display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:4px; }
  .legend { display:flex; gap:14px; font-size:.75rem; color:var(--ink-2); font-weight:400; }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
  svg { width: 100%; height: auto; display: block; }
  .tip { position: fixed; pointer-events: none; z-index: 10; display: none;
    background: var(--ink); color: #fff; font-size: .78rem; line-height: 1.5;
    padding: 6px 10px; border-radius: 8px; max-width: 240px; }

  .tablebox { overflow-x: auto; margin-top: 12px; }
  table { border-collapse: collapse; width:100%; background:var(--surface); font-size:.9rem; }
  th, td { border:1px solid var(--grid); padding: 7px 12px; text-align:right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  th:first-child, td:first-child { text-align:left; }
  thead th { background:#f3f2ee; font-weight:600; }
  tr.total td { font-weight: 700; background: #f7f6f2; }
  .plus { color: var(--good); } .minus { color: var(--down); }
  .yoy { color: var(--ink-2); font-size: .8rem; }

  .reasons { display:grid; gap:10px; margin-top: 12px; }
  .reasons .r { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 16px 12px 48px; position:relative; font-size:.92rem; }
  .reasons .r::before { content: attr(data-n); position:absolute; left:14px; top:13px;
    width:24px; height:24px; border-radius:99px; background:var(--new); color:#fff;
    font-weight:700; font-size:.85rem; display:flex; align-items:center; justify-content:center; }
  .reasons b.t { display:block; margin-bottom:2px; }

  ul.decide { margin:10px 0 0 0; list-style:none; display:grid; gap:8px; }
  ul.decide li { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px 16px; font-size:.92rem; }
  table.pl { font-size:.82rem; }
  table.pl th, table.pl td { padding: 4px 8px; }
  table.pl td:first-child { white-space:nowrap; }
  table.pl tr.total td { font-weight:600; background:#f7f6f2; }
  table.pl tr.profit td { font-weight:700; background: var(--hl-bg); }
  table.pl td.z { color: var(--muted); }
  .part { margin-top: 44px; padding-top: 10px; border-top: 3px solid var(--new); }
  .part h2 { border-left: 0; padding-left: 0; font-size: 1.3rem; }
  .part .lbl { display:inline-block; font-size:.72rem; font-weight:700; color:#fff; background:var(--new); border-radius:99px; padding:2px 10px; margin-bottom:6px; letter-spacing:.05em; }
  ul.events { margin:10px 0 0 0; list-style:none; display:grid; gap:6px; }
  ul.events li { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:8px 14px; font-size:.9rem; }
  ul.events li b { color: var(--new); margin-right:6px; }
  .flow { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; margin-top:12px; }
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
  footer { margin-top: 36px; color: var(--muted); font-size: .78rem; line-height:1.8; }
  @media print {
    @page { size: A4; margin: 13mm 12mm; }
    body { background:#fff; padding:0; font-size:11.5px; line-height:1.5; }
    .wrap { max-width:none; }
    header.page h1 { font-size:1.35rem; }
    .lead { padding:10px 14px; margin-top:10px; }
    section { margin-top:18px; }
    section.part { margin-top:0; padding-top:0; border-top:0; }
    section.pb { break-before:page; page-break-before:always; }
    .cards, .card, .chartbox, .tablebox, .tiles, .flow, .reasons .r, ul.decide li, ul.events li, .lead { break-inside:avoid; page-break-inside:avoid; }
    h2, h3 { break-after:avoid; page-break-after:avoid; }
    .chartbox { padding:8px 10px 2px; margin-top:8px; }
    .chartbox svg { max-height:40mm; }
    .flow { padding:8px 12px; }
    .tiles { gap:6px; } .tile { padding:6px 8px; }
    .hero { font-size:1.7rem; }
    .tile .n { font-size:1.4rem; }
    table { font-size:.8rem; } th, td { padding:3px 7px; }
    table.pl { font-size:.72rem; } table.pl th, table.pl td { padding:2px 5px; }
    details.more summary { display:none; }
    .tip { display:none !important; }
    .card, .chartbox, .flow, .tile, .reasons .r, ul.decide li, ul.events li, .lead { border-color:#bbb; }
    footer { margin-top:14px; font-size:.68rem; }
  }
</style>
</head>
<body>
<div class="wrap">

<header class="page">
  <h1>美容部 上半期実績と下半期目標</h1>
  <div class="sub">FY2026（2026年4月〜2027年3月）／2026-10-13 杉原（美容部ミーティング）</div>
</header>

<div class="lead">
  <b>まとめ</b>
  <ul>
    <li>上半期は部門計 <b>2,401万円・前年同期比138%</b>。寝屋川は目標ほぼ達成（98.8%）、守口も新規集客が過去最高ペースで方向は良い状態です</li>
    <li>上半期に残った純利益は部門計 <b>約166万円</b>（寝屋川 約139万円・守口 約27万円）。10/9に支給した上半期の賞与（6名・22万円）を9月に計上した後の数字です。守口は4〜5月の赤字を6月以降の黒字で取り返し、半期で黒字着地です</li>
    <li>下半期は「売上がいくらになりそうか」ではなく<b>「純利益をいくら残すか」</b>（部門計 約310万円・賞与前）から逆算して目標を組み直しました</li>
    <li>部門計の売上目標は <b>2,515万円＝期初（2,533万円）とほぼ同水準</b>。店ごとの配分と月割りを実力と季節に合わせ直しています</li>
  </ul>
</div>

<!-- ============ 第1部 上半期 ============ -->
<section class="part">
  <span class="lbl">第1部</span>
  <h2>上半期はこうでした（4〜9月・確定）</h2>
  <h3 style="margin-top:10px;">1. 売上の結果</h3>
  <div class="cards">
    <div class="card">
      <div class="store">寝屋川店 <span class="pill ok">目標ほぼ達成</span></div>
      <div class="hero">98.8<small>%</small></div>
      <div class="kv">
        <span>売上 <b>1,363.0万円</b>（目標1,380万）</span>
        <span>前年同期比 <b>162%</b></span>
        <span>客数 <b>2,447人</b>（142%）</span>
        <span>客単価 <b>5,570円</b>（114%）</span>
        <span>純利益 <b>約139万円</b></span>
      </div>
      <div class="verdict">予約枠はほぼ満杯（8月の稼働率 約9割）。下半期は客数より<b>単価</b>で伸ばす段階です。</div>
    </div>
    <div class="card">
      <div class="store">守口店 <span class="pill warn">85%・回復が続く</span></div>
      <div class="hero">85.1<small>%</small></div>
      <div class="kv">
        <span>売上 <b>1,038.1万円</b>（目標1,220万）</span>
        <span>前年同期比 <b>116%</b></span>
        <span>客数 <b>1,905人</b>（108%）</span>
        <span>客単価 <b>5,449円</b>（107%）</span>
        <span>純利益 <b>約27万円</b></span>
      </div>
      <div class="verdict">4月132万→9月185万と回復が継続。新規は月70〜98人と過去最高で、<b>「新規を2回目につなげる」が残る課題</b>です。</div>
    </div>
  </div>

  <details class="more"><summary>月ごとの売上の数字を見る（前年同月比つき）</summary>
  <div class="tablebox">
    <table>
      <thead><tr><th>月</th><th>寝屋川</th><th class="yoy">前年比</th><th>守口</th><th class="yoy">前年比</th><th>部門計</th></tr></thead>
      <tbody>
        <tr><td>4月</td><td>197.2</td><td class="yoy">123%</td><td>132.0</td><td class="yoy minus">80%</td><td>329.2</td></tr>
        <tr><td>5月</td><td>203.9</td><td class="yoy">159%</td><td>148.4</td><td class="yoy">107%</td><td>352.3</td></tr>
        <tr><td>6月</td><td>221.3</td><td class="yoy">165%</td><td>170.9</td><td class="yoy">113%</td><td>392.2</td></tr>
        <tr><td>7月</td><td>257.7</td><td class="yoy">180%</td><td>199.6</td><td class="yoy">126%</td><td>457.3</td></tr>
        <tr><td>8月</td><td>252.8</td><td class="yoy">177%</td><td>202.1</td><td class="yoy">133%</td><td>454.9</td></tr>
        <tr><td>9月</td><td>230.1</td><td class="yoy">174%</td><td>185.1</td><td class="yoy">140%</td><td>415.2</td></tr>
        <tr class="total"><td>上半期計</td><td>1,363.0</td><td class="yoy">162%</td><td>1,038.1</td><td class="yoy">116%</td><td>2,401.1</td></tr>
      </tbody>
    </table>
  </div>
  <p class="note" style="margin-top:6px;">守口の4月80%は前年4月が突出していた反動。5月以降は毎月前年超えで、比率は月を追うごとに上がっています（107→140%）。</p>
  </details>

  <h3 style="margin-top:26px;">2. 損益の結果 — 科目別・月別（うりぼーの実績）</h3>
<div class="tiles">
    <div class="tile good"><div class="l">寝屋川店 上半期の純利益</div><div class="n">138.5<small>万円</small></div><div class="l">売上の約10%・毎月黒字</div></div>
    <div class="tile good"><div class="l">守口店 上半期の純利益</div><div class="n">27.1<small>万円</small></div><div class="l">売上の約3%・4〜5月の赤字を取り返し黒字着地</div></div>
    <div class="tile good"><div class="l">部門計 上半期の純利益</div><div class="n">165.6<small>万円</small></div><div class="l">消費税の預かり（計147万円）は別枠</div></div>
  </div>
  <h3 style="margin-top:22px;">売上はどこへ行ったか（上半期の合計）</h3>
  <div class="flow"><div class="flow-h"><b>寝屋川店</b> 売上 1,363万円 の行き先</div><div class="bar"><span class="seg" style="flex:9.21;background:#c3c2b7" title="割引 125.6万円"></span><span class="seg" style="flex:53.85;background:#86b6ef" title="人件費（給与・賞与・社保） 734.0万円"></span><span class="seg" style="flex:18.86;background:#2a78d6" title="店の固定費（家賃・加盟金・HPB・Twinkle・減価償却） 257.1万円"></span><span class="seg" style="flex:7.92;background:#d9d6c9" title="仕入・光熱・その他 107.9万円"></span><span class="seg" style="flex:10.16;background:#2e8b57" title="残った利益 138.5万円"></span></div><div class="lgs"><span class="lg"><i style="background:#c3c2b7"></i>割引 <b>126万</b>（9%）</span><span class="lg"><i style="background:#86b6ef"></i>人件費（給与・賞与・社保） <b>734万</b>（54%）</span><span class="lg"><i style="background:#2a78d6"></i>店の固定費（家賃・加盟金・HPB・Twinkle・減価償却） <b>257万</b>（19%）</span><span class="lg"><i style="background:#d9d6c9"></i>仕入・光熱・その他 <b>108万</b>（8%）</span><span class="lg"><i style="background:#2e8b57"></i>残った利益 <b>138万</b>（10%）</span></div></div><div class="flow"><div class="flow-h"><b>守口店</b> 売上 1,038万円 の行き先</div><div class="bar"><span class="seg" style="flex:7.96;background:#c3c2b7" title="割引 82.6万円"></span><span class="seg" style="flex:60.38;background:#86b6ef" title="人件費（給与・賞与・社保） 626.8万円"></span><span class="seg" style="flex:18.15;background:#2a78d6" title="店の固定費（家賃・加盟金・HPB・Twinkle・減価償却） 188.4万円"></span><span class="seg" style="flex:10.90;background:#d9d6c9" title="仕入・光熱・その他 113.2万円"></span><span class="seg" style="flex:2.61;background:#2e8b57" title="残った利益 27.1万円"></span></div><div class="lgs"><span class="lg"><i style="background:#c3c2b7"></i>割引 <b>83万</b>（8%）</span><span class="lg"><i style="background:#86b6ef"></i>人件費（給与・賞与・社保） <b>627万</b>（60%）</span><span class="lg"><i style="background:#2a78d6"></i>店の固定費（家賃・加盟金・HPB・Twinkle・減価償却） <b>188万</b>（18%）</span><span class="lg"><i style="background:#d9d6c9"></i>仕入・光熱・その他 <b>113万</b>（11%）</span><span class="lg"><i style="background:#2e8b57"></i>残った利益 <b>27万</b>（3%）</span></div></div>
  <h3 style="margin-top:22px;">月ごとに残った利益（万円）</h3>
  <div class="chartbox"><h3>寝屋川店<span class="legend"><span><i style="background:var(--good)"></i>黒字</span><span><i style="background:var(--down)"></i>赤字</span></span></h3><div id="chart-neya-profit"></div></div>
  <div class="chartbox"><h3>守口店<span class="legend"><span><i style="background:var(--good)"></i>黒字</span><span><i style="background:var(--down)"></i>赤字</span></span></h3><div id="chart-mori-profit"></div></div>
  <p class="note" style="margin-top:6px;">守口の5月は広告16.5万円の先行投資で赤字幅が大きく、6月以降は毎月黒字。両店とも9月は10/9支給の上半期賞与（寝屋川13.5万・守口8.5万）を計上したぶん利益が小さく見えています。</p>
  <p class="note" style="margin-top:10px;"><b>別紙:</b> ①一年通しの「目標・実績・純利益」表（<a href="hanki_fy2026_year.php" style="color:var(--new)">hanki_fy2026_year.php</a>・A4縦3枚）／②上半期の科目別損益表（<a href="hanki_fy2026_pl.php" style="color:var(--new)">hanki_fy2026_pl.php</a>・A4横3枚）</p>
  <p class="note" style="margin-top:6px;"><b>読み方:</b> 寝屋川は毎月黒字で半期138.5万円。守口は4〜5月の赤字（5月は広告16.5万円の先行投資を含む）を6月以降の黒字で取り返し、半期27.1万円の黒字着地。<b>9月の賞与22.0万円（寝屋川13.5・守口8.5）は10/9支給の上半期賞与</b>で、6名に皆勤の積立分と上乗せ分を支給したものです。賞与分の会社負担の社会保険料（約3万円）は保険料の通知が届いてから計上します。消費税の預かりは上半期 寝屋川84万円・守口63万円。</p>
  <h3 style="margin-top:22px;">売上の推移（前年比）</h3>
  <div class="chartbox">
    <h3>寝屋川店 月次売上（万円）
      <span class="legend"><span><i style="background:var(--new)"></i>今年 FY2026</span><span><i style="background:var(--old)"></i>前年 FY2025</span></span>
    </h3>
    <div id="chart-neya"></div>
  </div>
  <div class="chartbox">
    <h3>守口店 月次売上（万円）
      <span class="legend"><span><i style="background:var(--new)"></i>今年 FY2026</span><span><i style="background:var(--old)"></i>前年 FY2025</span></span>
    </h3>
    <div id="chart-mori"></div>
  </div>
</section>

  <h3 style="margin-top:26px;">3. 上半期にあったこと</h3>
  <ul class="events">
    <li><b>寝屋川</b>予約枠がほぼ満杯に（8月の稼働率 約9割）。客数142%・客単価114%で前年比162%。これ以上は「客数」でなく「単価」で伸ばす段階に入った</li>
    <li><b>守口</b>4月132万円から8月202万円まで5ヶ月連続で伸長。新規客は月70〜98人と過去最高（口コミ施策・HPB転換率85%）。一方、新規の1ヶ月後再来率は21%（寝屋川は40%台）で「新規が定着する前に切れる」が課題として特定できた</li>
    <li><b>人</b>8/1 守口で1名を正社員化。10/9に上半期の賞与を6名へ支給（皆勤の積立分＋上乗せ・計22万円）。10/1 賃金テーブル改定・雇用契約書の巻き直し（配布・署名回収中）</li>
    <li><b>決定</b>9/23 ポイントカードの廃止を決定（割引の適正化の一環）。寺西さん（寝屋川・パート）が10/17から産休＝3月復帰前提</li>
  </ul>
</section>

<!-- ============ 第2部 下半期 ============ -->
<section class="part pb">
  <span class="lbl">第2部</span>
  <h2>下半期はこうします（10〜3月）</h2>
  <h3 style="margin-top:10px;">1. 目標 — 期初からの見直し</h3>

  <div class="tablebox">
    <table>
      <thead><tr><th></th><th>期初目標</th><th><b>下期修正</b></th><th>差</th><th>（参考）見通し※</th></tr></thead>
      <tbody>
        <tr><td>寝屋川店</td><td>1,360万円</td><td><b>1,420万円</b></td><td class="plus">+60万円</td><td>約1,427万円</td></tr>
        <tr><td>守口店</td><td>1,173万円</td><td><b>1,095万円</b></td><td class="minus">−78万円</td><td>約1,025万円</td></tr>
        <tr class="total"><td>部門計</td><td>2,533万円</td><td><b>2,515万円</b></td><td class="minus">−18万円</td><td>約2,452万円</td></tr>
        <tr><td>達成したときの純利益<br><small>（賞与前・同じ経費の前提）</small></td><td>約325万円</td><td><b>約310万円</b></td><td class="minus">−16万円</td><td>—</td></tr>
        <tr><td>下半期も賞与を出した場合<br><small>（仮置き 約25万円を引く）</small></td><td>約300万円</td><td><b>約284万円</b></td><td class="minus">−16万円</td><td>—</td></tr>
      </tbody>
    </table>
  </div>
  <p class="note" style="margin-top:6px;">※期初の欄は、期初の売上目標に下期修正と同じ経費の前提（10/1確定）を当てた数字です（10/15訂正: 当初は9/16時点の経費の前提で「約307万円・+3万円」と記載していました）。<br>※目標の純利益 約310万円は<b>賞与前</b>の数字です。美容部の賞与は支給の有無も額も決まっていないため、目標には入れず、<b>目標を超えた分を賞与の原資</b>と考えます。下半期も上半期と同額の22万円を出す場合は、会社負担の社会保険料（約3万円）と合わせて約25万円を引いた<b>約284万円</b>が残ります。<br>※上半期と同じ物差しで比べると、上半期の純利益は賞与前 187.6万円（賞与後 165.6万円）→ 下半期の目標は賞与前 約310万円です。通期では、上半期の賞与を計上済みで下半期は賞与前の 約474万円、下半期も賞与を出す場合は 約449万円の見込みです。<br>※見通し＝何も変えなければこうなる、という実勢×季節性の予測（寺西さん産休の影響を調整済み）。寝屋川は<b>見通しの範囲内（−7万円）＝確実に取りに行く目標</b>に置き、守口は<b>見通し+70万円を新規定着の改善で埋める</b>設計です。</p>

  <h3 style="margin-top:18px;">月割りの比較 — 期初 vs 下期修正</h3>
  <div class="chartbox">
    <h3>寝屋川店（万円）
      <span class="legend"><span><i style="background:var(--old)"></i>期初目標</span><span><i style="background:var(--new)"></i>下期修正</span></span>
    </h3>
    <div id="chart-neya-cmp"></div>
  </div>
  <div class="chartbox">
    <h3>守口店（万円）
      <span class="legend"><span><i style="background:var(--old)"></i>期初目標</span><span><i style="background:var(--new)"></i>下期修正</span></span>
    </h3>
    <div id="chart-mori-cmp"></div>
    <p class="note" style="margin:4px 2px 8px;">期初の月割りは季節と合っていない月がありました（例: 守口の1月200万円＝毎年いちばん弱い月に最大級の目標）。下期修正は「山の月（12月・3月）で稼ぎ、谷の月（11月・1月）は耐える」形に揃えています。</p>
  </div>

  <h3 style="margin-top:18px;">見直しの理由（3つ）</h3>
  <div class="reasons">
    <div class="r" data-n="1"><b class="t">実力に合わせた店間の再配分</b>寝屋川は実勢が期初目標を上回っており、そのままでは「何もしなくても超える目標」になるため引き上げます（確実に取りに行ける見通しの範囲内に設定）。守口は期初のままだと打ち手が全部効いても届かない水準だったため、打ち手とつながる位置へ下げます。<b>部門計はほぼ同水準を保ちます。</b></div>
    <div class="r" data-n="2"><b class="t">毎年の季節の山谷に月割りを合わせる</b>両店とも7〜8月・12月・3月が山、11月・1月は毎年9割程度に落ちます。月割りを季節に合わせ、閑散月は利益トントンでよく、繁忙月で半期の利益を取り切る設計にします。</div>
    <div class="r" data-n="3"><b class="t">10月からの2つの変化を織り込み済み</b>①寺西さん（寝屋川・パート）が10/17から産休に入ります（3月に復帰の前提）。売上への影響と人件費の減がほぼ同じ規模のため、利益への影響はほぼ中立です（売上キャパの分だけ途中月の目標を調整し、3月は復帰で戻しています）。②10月の賃金改定（月給者+5,000円ほか）の人件費増も織り込んでいます。<b>どちらも織り込んだうえで、残す純利益は賞与前で約310万円です。期初の売上目標を同じ経費の前提で達成した場合（約325万円）より約16万円少なく、これは守口の売上目標を78万円下げた分です（寝屋川の+60万円で約51万円増・守口の−78万円で約68万円減）。</b></div>
  </div>
</section>

<section>
  <h3>2. 取り組むこと（4つ）</h3>
  <ul class="decide">
    <li><b>1. 守口店 — 新規のお客様を2回目につなげる</b><br>集客は成功しているので、次は定着で回収するフェーズに入ります。お会計時の次回予約の取得と、新規のお客様への2回目クーポンを徹底します。目標の上積み分（+70万円）はここで埋めます。</li>
    <li><b>2. 寝屋川店 — 単価で伸ばす</b><br>予約枠がほぼ満杯のため、客数を増やす余地は多くありません。割引（売上の約9%）を少しずつ適正化し、店販とオプションで単価を上げます。</li>
    <li><b>3. 両店 — 次回予約の徹底で11月・1月の落ち込みに先回りする</b><br>毎年落ちると分かっている月なので、10月・12月のご来店時に次回予約を取り切ります。お会計時の次回予約は両店共通の決まりごとにします。販促で埋めるより低コストです。</li>
    <li><b>4. 両店 — ポイントカードの廃止（9/23に決定済み）</b><br>割引の適正化の一環として、ポイントカードはやめます。店舗での切り替えの段取りは店長と進めます。</li>
  </ul>
  <h3 style="margin-top:22px;">3. 見ていく数字</h3>
  <p class="note" style="margin-top:8px;">進捗は毎月の売上と、守口の「新規の1ヶ月後再来率」（現在21%→12月30%→3月40%）で見ていきます。</p>
</section>

<footer>
  数字の基準: 売上はサロンボードの総売上（<b>割引前・税込</b>）で統一しています。会計（TKC）の売上高は割引後のため約1割小さくなります（例: 9月の寝屋川はサロンボード230.1万円／会計上の売上208.3万円）。前年比較も同じ基準どうしの比較です。<br>
  出典: うりぼー（売上・経費）・サロンボード実査（2026-09-16）・PochiClock（出勤時間）。純利益は減価償却込み・消費税の預かりと納付は別枠。詳細版（損益分岐点・月別利益・打ち手の中身）は スタッフ版レポート（hanki_fy2026.php）へ。
</footer>

</div>
<div class="tip" id="tip"></div>

<script>
(function () {
  var opened = [];
  window.addEventListener('beforeprint', function () {
    opened = [];
    document.querySelectorAll('details.more').forEach(function (d) { if (!d.open) { d.open = true; opened.push(d); } });
  });
  window.addEventListener('afterprint', function () { opened.forEach(function (d) { d.open = false; }); opened = []; });
})();
(function () {
  var css = getComputedStyle(document.documentElement);
  var C = {
    neu: css.getPropertyValue('--new').trim(),
    old: css.getPropertyValue('--old').trim(),
    ink2: css.getPropertyValue('--ink-2').trim(),
    muted: css.getPropertyValue('--muted').trim(),
    grid: css.getPropertyValue('--grid').trim(),
    baseline: css.getPropertyValue('--baseline').trim()
  };
  var tip = document.getElementById('tip');
  function showTip(evt, html) {
    tip.innerHTML = html; tip.style.display = 'block';
    var x = evt.clientX + 12, y = evt.clientY + 12;
    if (x + 250 > window.innerWidth) x = evt.clientX - 250;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  }
  function hideTip() { tip.style.display = 'none'; }

  function barPath(x, y, w, h) {
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ' ' + (y + h) + ' L' + x + ' ' + (y + r) +
           ' Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y +
           ' L' + (x + w - r) + ' ' + y +
           ' Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) +
           ' L' + (x + w) + ' ' + (y + h) + ' Z';
  }
  var NS = 'http://www.w3.org/2000/svg';
  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  var W = 760, H = 250, ML = 38, MR = 10, MT = 24, MB = 26;
  var plotW = W - ML - MR, plotH = H - MT - MB;
  var YMAX = 300;
  function sy(v) { return MT + plotH * (1 - v / YMAX); }

  function baseSvg(mount) {
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img' });
    document.getElementById(mount).appendChild(svg);
    [100, 200, 300].forEach(function (g) {
      el('line', { x1: ML, x2: W - MR, y1: sy(g), y2: sy(g), stroke: C.grid, 'stroke-width': 1 }, svg);
      var t = el('text', { x: ML - 6, y: sy(g) + 4, 'text-anchor': 'end', 'font-size': 10, fill: C.muted }, svg);
      t.textContent = g;
    });
    el('line', { x1: ML, x2: W - MR, y1: sy(0), y2: sy(0), stroke: C.baseline, 'stroke-width': 1 }, svg);
    return svg;
  }

  // 2系列グループバー（薄青=比較元、青=主役）。主役側だけ直接ラベル
  function groupedChart(mount, store, months, serA, serB, nameA, nameB) {
    var svg = baseSvg(mount);
    var n = months.length;
    var slot = plotW / n, bw = 24, gap = 2;
    months.forEach(function (m, i) {
      var cx = ML + slot * i + slot / 2;
      var xA = cx - bw - gap / 2, xB = cx + gap / 2;
      [[xA, serA[i], C.old, nameA], [xB, serB[i], C.neu, nameB]].forEach(function (d) {
        var p = el('path', { d: barPath(d[0], sy(d[1]), bw, sy(0) - sy(d[1])), fill: d[2] }, svg);
        p.addEventListener('mousemove', function (evt) {
          showTip(evt, '<b>' + store + ' ' + m + '</b><br>' + nameA + ': ' + serA[i].toFixed(1) + '万円<br>' + nameB + ': ' + serB[i].toFixed(1) + '万円');
        });
        p.addEventListener('mouseleave', hideTip);
      });
      var lbl = el('text', { x: xB + bw / 2, y: sy(serB[i]) - 5, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: C.ink2 }, svg);
      lbl.textContent = Math.round(serB[i]);
      var mt = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted }, svg);
      mt.textContent = m;
    });
  }

  function profitChart(mount, store, months, vals) {
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
  profitChart('chart-mori-profit', '守口店', M1, [-13.1, -25.8, 4.5, 24.2, 27.8, 9.5]);
  var M2 = ['10月', '11月', '12月', '1月', '2月', '3月'];
  // 実績: 前年 vs 今年
  groupedChart('chart-neya', '寝屋川店', M1, [160.3, 127.9, 133.8, 143.2, 142.6, 132.3], [197.2, 203.9, 221.3, 257.7, 252.8, 230.1], '前年', '今年');
  groupedChart('chart-mori', '守口店',   M1, [165.3, 139.2, 151.8, 158.7, 151.5, 132.0], [132.0, 148.4, 170.9, 199.6, 202.1, 185.1], '前年', '今年');
  // 目標: 期初 vs 下期修正
  groupedChart('chart-neya-cmp', '寝屋川店', M2, [230, 220, 240, 210, 220, 240], [240, 220, 250, 220, 230, 260], '期初目標', '下期修正');
  groupedChart('chart-mori-cmp', '守口店',   M2, [220, 150, 153, 200, 210, 240], [190, 170, 190, 170, 175, 200], '期初目標', '下期修正');
})();
</script>
</body>
</html>
