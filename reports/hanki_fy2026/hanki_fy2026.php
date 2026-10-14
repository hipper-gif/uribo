<?php
// 美容部 上半期確定＆下半期計画レポート（FY2026）
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
<title>美容部 上半期確定と下半期計画 FY2026</title>
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
    --this-year:   #2a78d6;  /* FY2026 */
    --last-year:   #86b6ef;  /* FY2025（同一指標の年次比較＝青の濃淡） */
    --bep:         #d03b3b;  /* 損益分岐点ライン */
    --good:        #006300;  /* 利益・プラス */
    --warn-bg:     #fdf6e8;
    --ok-bg:       #eef7ee;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    background: var(--page);
    color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", sans-serif;
    line-height: 1.65;
    padding: 20px 14px 60px;
  }
  .wrap { max-width: 860px; margin: 0 auto; }
  header.page { margin-bottom: 20px; }
  header.page h1 { font-size: 1.45rem; line-height:1.35; }
  header.page .sub { color: var(--ink-2); font-size: .85rem; margin-top: 4px; }
  .badge { display:inline-block; background:#e8f0fb; color:#1c5cab; border-radius: 99px; padding: 1px 10px; font-size:.75rem; font-weight:600; vertical-align: 2px; }

  section { margin-top: 30px; }
  h2 { font-size: 1.05rem; border-left: 4px solid var(--this-year); padding-left: 10px; margin-bottom: 12px; }
  h3 { font-size: .95rem; margin-bottom: 8px; }
  p.note { color: var(--ink-2); font-size: .85rem; }

  .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  @media (max-width: 640px) { .cards { grid-template-columns: 1fr; } }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 12px; padding: 16px 18px;
  }
  .card .store { font-weight: 700; font-size: 1rem; display:flex; align-items:center; gap:8px; }
  .pill { font-size:.72rem; font-weight:600; border-radius:99px; padding:1px 9px; }
  .pill.ok   { background: var(--ok-bg); color: var(--good); }
  .pill.warn { background: var(--warn-bg); color: #8a5a00; }
  .hero { font-size: 2.3rem; font-weight: 750; letter-spacing: -0.5px; margin: 2px 0 0; }
  .hero small { font-size: 1rem; font-weight: 600; color: var(--ink-2); }
  .kv { display:flex; flex-wrap:wrap; gap: 4px 18px; margin-top: 8px; font-size:.85rem; color: var(--ink-2); }
  .kv b { color: var(--ink); font-variant-numeric: tabular-nums; }
  .verdict { margin-top: 10px; font-size: .88rem; border-top: 1px dashed var(--grid); padding-top: 8px; }

  .chartbox { background: var(--surface); border:1px solid var(--border); border-radius:12px; padding: 14px 14px 8px; margin-top: 12px; position: relative; }
  .chartbox h3 { display:flex; justify-content:space-between; align-items:baseline; flex-wrap:wrap; gap:4px; }
  .legend { display:flex; gap:14px; font-size:.75rem; color:var(--ink-2); font-weight:400; }
  .legend i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
  svg { width: 100%; height: auto; display: block; }
  .tip {
    position: fixed; pointer-events: none; z-index: 10; display: none;
    background: var(--ink); color: #fff; font-size: .78rem; line-height: 1.5;
    padding: 6px 10px; border-radius: 8px; max-width: 240px;
  }

  .flow { display:flex; gap:8px; align-items:stretch; flex-wrap:wrap; margin-top: 10px; }
  .flow .step { flex:1 1 150px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 14px; text-align:center; }
  .flow .arrow { align-self:center; color:var(--muted); font-size:1.2rem; }
  .step .big { font-size:1.5rem; font-weight:750; font-variant-numeric: tabular-nums; }
  .step .lbl { font-size:.78rem; color:var(--ink-2); }
  .step.bad .big { color: var(--bep); }
  .step.goal .big { color: var(--good); }

  table { border-collapse: collapse; width:100%; background:var(--surface); font-size:.85rem; }
  th, td { border:1px solid var(--grid); padding: 6px 10px; text-align:right; font-variant-numeric: tabular-nums; }
  th:first-child, td:first-child { text-align:left; }
  thead th { background:#f3f2ee; font-weight:600; }
  .plus { color: var(--good); } .minus { color: var(--bep); }

  details { margin-top: 10px; background:var(--surface); border:1px solid var(--border); border-radius: 10px; padding: 10px 14px; }
  summary { cursor: pointer; font-size: .88rem; font-weight: 600; color: var(--ink-2); }
  details[open] summary { margin-bottom: 8px; }

  ol.actions { margin: 10px 0 0 0; list-style:none; counter-reset: n; display:grid; gap:10px; }
  ol.actions li { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 14px 12px 48px; position:relative; counter-increment: n; font-size:.9rem; }
  ol.actions li::before {
    content: counter(n); position:absolute; left:14px; top:12px;
    width:24px; height:24px; border-radius:99px; background:var(--this-year); color:#fff;
    font-weight:700; font-size:.85rem; display:flex; align-items:center; justify-content:center;
  }
  ol.actions b.t { display:block; margin-bottom:2px; }
  ul.decide { margin:10px 0 0 0; list-style:none; display:grid; gap:8px; }
  ul.decide li { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:10px 14px; font-size:.88rem; }
  footer { margin-top: 36px; color: var(--muted); font-size: .75rem; line-height:1.7; }
</style>
</head>
<body>
<div class="wrap">

<header class="page">
  <h1>美容部 上半期確定と下半期計画 <span class="badge">FY2026</span></h1>
  <div class="sub">2026-10-01 更新（9月実績反映・上半期4〜9月で確定／下半期目標を改訂＝寺西さん産休・10月賃金改定を織り込み）／作成 杉原　出典: うりぼー・サロンボード実査・PochiClock・Mneme</div>
</header>

<!-- ============ 1. 上半期の着地 ============ -->
<section>
  <h2>上半期の着地（確定）</h2>
  <div class="cards">
    <div class="card">
      <div class="store">寝屋川店 <span class="pill ok">目標ほぼ達成</span></div>
      <div class="hero">98.8<small>%</small></div>
      <div class="kv">
        <span>売上 <b>1,363.0万円</b> / 目標1,380万</span>
        <span>前年比 <b>162%</b></span>
        <span>客数 <b>2,447人</b>（142%）</span>
        <span>客単価 <b>5,570円</b>（114%）</span>
      </div>
      <div class="verdict">8月の稼働率は約9割＝<b>ほぼ満枠</b>。下半期は「量」より<b>「単価」</b>で伸ばす局面。</div>
    </div>
    <div class="card">
      <div class="store">守口店 <span class="pill warn">86%・ただし方向は良い</span></div>
      <div class="hero">85.1<small>%</small></div>
      <div class="kv">
        <span>売上 <b>1,038.1万円</b> / 目標1,220万</span>
        <span>前年比 <b>116%</b></span>
        <span>客数 <b>1,905人</b>（108%）</span>
        <span>客単価 <b>5,449円</b>（107%）</span>
      </div>
      <div class="verdict">新規集客は<b>過去最高ペースで成功</b>。残る課題は「新規の8割が1回で失客」の<b>定着一点</b>。</div>
    </div>
  </div>

  <div class="chartbox">
    <h3>寝屋川店 月次売上（万円）
      <span class="legend"><span><i style="background:var(--this-year)"></i>今年 FY2026</span><span><i style="background:var(--last-year)"></i>前年 FY2025</span></span>
    </h3>
    <div id="chart-neya"></div>
  </div>
  <div class="chartbox">
    <h3>守口店 月次売上（万円）
      <span class="legend"><span><i style="background:var(--this-year)"></i>今年 FY2026</span><span><i style="background:var(--last-year)"></i>前年 FY2025</span></span>
    </h3>
    <div id="chart-mori"></div>
    <p class="note" style="margin:4px 2px 8px;">4月132万 → 8月202万と5ヶ月連続増。9月185.1万は季節どおりの微減で、<b>素の月商は約183万円</b>と夏場の170万前後から一段上がった。</p>
  </div>

  <details>
    <summary>数値表（月次売上・万円）</summary>
    <table>
      <thead><tr><th></th><th>4月</th><th>5月</th><th>6月</th><th>7月</th><th>8月</th><th>9月</th><th>計</th></tr></thead>
      <tbody>
        <tr><td>寝屋川 FY2026</td><td>197.2</td><td>203.9</td><td>221.3</td><td>257.7</td><td>252.8</td><td>230.1</td><td><b>1,363.0</b></td></tr>
        <tr><td>寝屋川 FY2025</td><td>160.3</td><td>127.9</td><td>133.8</td><td>143.2</td><td>142.6</td><td>132.3</td><td>840.0</td></tr>
        <tr><td>守口 FY2026</td><td>132.0</td><td>148.4</td><td>170.9</td><td>199.6</td><td>202.1</td><td>185.1</td><td><b>1,038.1</b></td></tr>
        <tr><td>守口 FY2025</td><td>165.3</td><td>139.2</td><td>151.8</td><td>158.7</td><td>151.5</td><td>132.0</td><td>898.5</td></tr>
      </tbody>
    </table>
  </details>
</section>

<!-- ============ 2. 守口の構造 ============ -->
<section>
  <h2>守口の構造 — 「集客は成功。定着で切れている」</h2>
  <div class="flow">
    <div class="step"><div class="big">70〜98<span style="font-size:.9rem">人/月</span></div><div class="lbl">新規客（過去最高ペース・1〜3月の3倍超）<br>口コミ施策が的中・HPB転換率85%</div></div>
    <div class="arrow">→</div>
    <div class="step bad"><div class="big">21%</div><div class="lbl">1ヶ月後の再来率<br>（寝屋川は40%台）</div></div>
    <div class="arrow">→</div>
    <div class="step bad"><div class="big">83%</div><div class="lbl">4月新規89人のうち75人が<br>二度と来ていない</div></div>
    <div class="arrow">→</div>
    <div class="step goal"><div class="big">30→40%</div><div class="lbl">定着KPI: 再来率を12月に30%、<br>3月に40%（寝屋川並み）へ</div></div>
  </div>
  <p class="note" style="margin-top:8px;">固定客の維持率は両店とも健全（78〜89%）。守口は「客が離れる店」ではなく<b>「新規が定着する前に切れる」</b>に絞り込める。月イチ固定客を1人作ると年約6.5万円の恒常売上。</p>
</section>

<!-- ============ 3. 下半期目標 ============ -->
<section>
  <h2>下半期目標 — 10/1 確定</h2>

  <div class="card" style="margin-bottom:12px; background:var(--warn-bg); border-color:#e8d9b0;">
    <b style="font-size:.92rem;">10/1確定で織り込んだこと</b>
    <div style="font-size:.86rem; margin-top:6px; line-height:1.7;">
      ① <b>寺西さんが10/17から産休・3月に復帰前提</b>（寝屋川・パート）— 売上貢献 約12万/月と人件費 6.6万/月が近く、<b>損益インパクトはほぼ中立</b>。売上キャパ減のぶん寝屋川の目標を調整し、3月は復帰で戻す<br>
      ② <b>10月賃金改定</b> — 月給6名+5,000（各店3名）＋時給改定で部門計 月+5万、達成金の40万円条件化で月▲3万 ＝ <b>正味+1万/店/月</b><br>
      ③ <b>寝屋川は「確実に取りに行く」水準へ</b> — 見通し（約1,427万）の範囲内の1,420万に設定（利益逆算のたたき台1,444万から圧縮）<br>
      → <b>部門計 売上2,515万・純利益約310万</b>（期初目標2,533万・達成時利益約307万と同水準）
    </div>
  </div>

  <div class="cards">
    <div class="card">
      <div class="store">寝屋川店</div>
      <div class="hero" style="font-size:1.8rem;">売上 1,420万 <small>→ 純利益 <span style="color:var(--good)">約213万</span></small></div>
      <div class="kv"><span>見通し 約1,427万の範囲内（−7万）＝<b>確実達成型</b>。3月の寺西さん復帰が上振れ余地</span></div>
      <div class="verdict">判定 <b>◎ 実勢圏内</b>（単価・割引適正化は上積みの打ち手に）</div>
    </div>
    <div class="card">
      <div class="store">守口店</div>
      <div class="hero" style="font-size:1.8rem;">売上 1,095万 <small>→ 純利益 <span style="color:var(--good)">約95万</span></small></div>
      <div class="kv"><span>見通し1,025万との差 <b>+70万</b>＝定着改善の効果試算（約+50万）＋9月の上振れ継続で埋める</span></div>
      <div class="verdict">判定 <b>△ 打ち手前提の背伸び1段</b>（KPIが半分でも赤字方向には落ちない）</div>
    </div>
  </div>

  <div class="chartbox">
    <h3>寝屋川店 月別売上目標と残る利益（万円）<span class="legend"><span><i style="background:var(--this-year)"></i>売上目標</span><span style="color:var(--bep)">- - 損益分岐点 193万（10月197・3月201万）</span></span></h3>
    <div id="chart-neya-target"></div>
  </div>
  <div class="chartbox">
    <h3>守口店 月別売上目標と残る利益（万円）<span class="legend"><span><i style="background:var(--this-year)"></i>売上目標</span><span style="color:var(--bep)">- - 損益分岐点 164万</span></span></h3>
    <div id="chart-mori-target"></div>
  </div>
  <p class="note">閑散月（11月・1月）は利益ほぼトントンでよく、<b>繁忙月（12月・3月）で半期の利益を取り切る</b>設計。月割りは季節性（山=7-8月・12月・3月／谷=11月・1月）に合わせて凸凹させている。</p>

  <h3 style="margin-top:18px;">期初目標からの見直し — 部門全体では下げていない</h3>
  <table>
    <thead><tr><th></th><th>期初目標</th><th>新目標（10/1確定）</th><th>差</th></tr></thead>
    <tbody>
      <tr><td>寝屋川店</td><td>1,360万円</td><td>1,420万円</td><td class="plus">+60万円</td></tr>
      <tr><td>守口店</td><td>1,173万円</td><td>1,095万円</td><td class="minus">−78万円</td></tr>
      <tr><td><b>部門計</b></td><td><b>2,533万円</b></td><td><b>2,515万円</b></td><td class="minus"><b>−18万円</b></td></tr>
      <tr><td>達成時の純利益</td><td>約307万円</td><td><b>約310万円</b></td><td class="plus">+3万円</td></tr>
    </tbody>
  </table>
  <p class="note" style="margin-top:6px;">経緯: 9/16利益逆算案（寝屋川1,479・守口1,082）→ 10/1たたき台（寺西さん産休・賃金改定織り込みで1,444・1,090）→ 10/1確定（杉原氏調整＝寝屋川を見通し圏内の1,420へ・守口の月割りを丸めて1,095・寝屋川3月は寺西さん復帰前提）。部門計の売上は期初比−18万円だが達成時の純利益は同水準を維持。</p>
  <p class="note" style="margin-top:6px;">寝屋川の期初目標は実勢より100万低い「何もしなくても超える目標」、守口は打ち手満額でも約100万届かない水準だった。<b>店間の配分と月割りを実力と季節の現実に合わせて組み替えた</b>もので、守口の−91万は「諦め」ではない。</p>

  <details>
    <summary>9月実績での答え合わせ（2026-10-01追記）</summary>
    <p style="font-size:.88rem;">寝屋川230.1万円＝実勢どおり。守口は素の月商約183万円と、下半期予測の前提（170万円前後）を1ヶ月分上回った。この水準が続けば守口の予測は1,025万円より上振れし、<b>目標1,082万円との差57万円は実質縮んでいる</b>。ただし1ヶ月の実績なので予測値の置き直しはせず、定着KPIの進捗と合わせて12月に再点検する。<br><b>10/13追記:</b> 10/9支給の上半期賞与（6名・22.0万円＝寝屋川13.5万円・守口8.5万円）を9月実績の賞与（うりぼー bonus）に計上。上半期の純利益は 寝屋川138.5万円・守口27.1万円・部門計165.6万円（減価償却込み・消費税別枠）。下半期目標の利益（約310万円）は賞与前。賞与は目標を超えた分を原資と考え、下半期も上半期と同額を出す場合は社保込み約25万円を引いて約284万円が残る見込み。</p>
  </details>

  <details>
    <summary>損益構造と経費の前提（上半期4〜8月実績ベース）</summary>
    <table>
      <thead><tr><th></th><th>変動費率</th><th>固定費/月</th><th>損益分岐点/月</th><th>実勢月商→残る利益</th></tr></thead>
      <tbody>
        <tr><td>寝屋川店</td><td>14.4%</td><td>171.0万円</td><td><b>200万円</b></td><td>240万円 → 34万円/月</td></tr>
        <tr><td>守口店</td><td>13.2%</td><td>141.5万円</td><td><b>163万円</b></td><td>170万円 → 6万円/月</td></tr>
      </tbody>
    </table>
    <p style="font-size:.82rem; margin-top:6px; color:var(--ink-2);"><b>10/1確定の固定費</b>: 寝屋川 165.4万/月（賃金改定+1.0・寺西さん産休▲6.6。10月のみ168.7万・3月は復帰で172.0万）→ 分岐点193万（10月197万・3月201万）／守口 142.5万/月（賃金改定+1.0）→ 分岐点164万。上表は9/16版（4〜8月実績ベース）。</p>
    <p style="font-size:.82rem; margin-top:6px; color:var(--ink-2);">固定費内訳: 人件費（寝屋川108万/守口92.5万）＋法定福利＋家賃＋HPB掲載料＋加盟金＋Twinkle代＋水道光熱・通信ほか＋減価償却6.4万。売上連動科目（割引・仕入・決済手数料）は上半期実績率を適用。求人費・守口の外注費は発生時に実績計上。閑散月に分岐点（寝屋川200万・守口163万）を割らないことが月次の死守ライン。気づき: 寝屋川の割引は売上の9.2%（上半期104万円）＝満枠の店で値引きする必要は薄い。</p>
  </details>
</section>

<!-- ============ 4. 打ち手 ============ -->
<section>
  <h2>下半期の打ち手（3つに絞る）</h2>
  <ol class="actions">
    <li><b class="t">守口: 新規定着プログラム</b>お会計時の次回予約取得（3〜5週後）＋新規への2回目クーポン（HPBの新規単価より安い）＋次回予約トークを上石田さん・和田さんの型で揃える。KPI＝新規の1ヶ月後再来率 <b>21% → 30%（12月）→ 40%（3月）</b>。目標の+57万はここで埋める。</li>
    <li><b class="t">寝屋川: 単価アップ</b>割引9.2%の適正化（満枠なので値引き集客は縮小）＋店販の定番を1つ決めて全員が勧める（2.4%→4%で月+4万）＋オプション・指名の継続強化。</li>
    <li><b class="t">谷月（11月・1月）の先回り</b>毎年落ちると分かっているので、10月・12月の来店時に谷月の次回予約を取り切る。「谷を販促で埋める」より<b>「山で谷の予約を確保する」</b>が低コスト。</li>
  </ol>
</section>

<!-- ============ 5. 一緒に決めたいこと ============ -->
<section>
  <h2>一緒に決めたいこと</h2>
  <ul class="decide">
    <li><b>1.</b> 下半期に残す純利益の水準（たたき台: 寝屋川240万・守口90万＝部門計330万。うりぼーに仮登録済み——変わればその場で差し替え）</li>
    <li><b>2.</b> 守口の位置づけの共有:「集客は成功→定着で回収するフェーズ」というストーリーをどう共有するか</li>
    <li><b>3.</b> 守口の定着プログラム（次回予約取得・2回目クーポン）の中身と、誰が現場に落とすか</li>
    <li><b>4.</b> 寝屋川の割引適正化（9.2%→どこまで）の進め方（客離れを起こさない範囲の見極め）</li>
    <li><b>5.</b> 稼働率・再来率を月次で見る運用にするか（サロンボード＋PochiClockから月1回、Clioが自動取得・報告できる）</li>
  </ul>
</section>

<footer>
  稼働率は「客数×平均施術90分 ÷ PochiClock打刻の出勤時間」の試算。損益構造は上半期4〜8月実績から算出（消費税の預かり・納付は別枠）。リピート分析・来店サイクル・HPBレポートは2026-09-16サロンボード実査。売上・客数は4〜9月確定（うりぼーDB）。9月の経費実績（賞与22万円を含む）は10/13に計上済み。損益構造・稼働率・リピート分析は9/16時点のまま。正本: clio business-docs/美容部/下半期報告_目標見直し草案_FY2026_202609.md
</footer>

</div>
<div class="tip" id="tip"></div>

<script>
(function () {
  var css = getComputedStyle(document.documentElement);
  var C = {
    thisYear: css.getPropertyValue('--this-year').trim(),
    lastYear: css.getPropertyValue('--last-year').trim(),
    bep:      css.getPropertyValue('--bep').trim(),
    good:     css.getPropertyValue('--good').trim(),
    muted:    css.getPropertyValue('--muted').trim(),
    ink2:     css.getPropertyValue('--ink-2').trim(),
    grid:     css.getPropertyValue('--grid').trim(),
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

  // 上向きに角丸(4px)のバー
  function barPath(x, y, w, h) {
    var r = Math.min(4, w / 2, h);
    return 'M' + x + ' ' + (y + h) +
           ' L' + x + ' ' + (y + r) +
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

  // ---- 実績比較（今年 vs 前年・グループバー） ----
  function groupedChart(mount, store, months, cur, prev) {
    var svg = baseSvg(mount);
    var n = months.length;
    var slot = plotW / n, bw = 24, gap = 2;
    months.forEach(function (m, i) {
      var cx = ML + slot * i + slot / 2;
      var xPrev = cx - bw - gap / 2, xCur = cx + gap / 2;
      var yoy = prev[i] ? Math.round(cur[i] / prev[i] * 100) : null;
      [[xPrev, prev[i], C.lastYear, '前年 FY2025'], [xCur, cur[i], C.thisYear, '今年 FY2026']].forEach(function (d) {
        var p = el('path', { d: barPath(d[0], sy(d[1]), bw, sy(0) - sy(d[1])), fill: d[2] }, svg);
        p.addEventListener('mousemove', function (evt) {
          showTip(evt, '<b>' + store + ' ' + m + '</b><br>' + d[3] + ': ' + d[1].toFixed(1) + '万円' +
            (yoy ? '<br>前年同月比 ' + yoy + '%' : ''));
        });
        p.addEventListener('mouseleave', hideTip);
      });
      var lbl = el('text', { x: xCur + bw / 2, y: sy(cur[i]) - 5, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: C.ink2 }, svg);
      lbl.textContent = Math.round(cur[i]);
      var mt = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted }, svg);
      mt.textContent = m;
    });
  }

  // ---- 下半期目標（バー＋分岐点ライン＋利益） ----
  function targetChart(mount, store, months, target, profit, bep) {
    var svg = baseSvg(mount);
    var n = months.length;
    var slot = plotW / n, bw = 34;
    months.forEach(function (m, i) {
      var x = ML + slot * i + (slot - bw) / 2;
      var p = el('path', { d: barPath(x, sy(target[i]), bw, sy(0) - sy(target[i])), fill: C.thisYear }, svg);
      p.addEventListener('mousemove', function (evt) {
        showTip(evt, '<b>' + store + ' ' + m + '</b><br>売上目標: ' + target[i] + '万円<br>残る利益: ' + profit[i] + '万円<br>分岐点: ' + bep + '万円');
      });
      p.addEventListener('mouseleave', hideTip);
      var lbl = el('text', { x: x + bw / 2, y: sy(target[i]) - 5, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: C.ink2 }, svg);
      lbl.textContent = target[i];
      var mt = el('text', { x: x + bw / 2, y: H - 14, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted }, svg);
      mt.textContent = m;
      var pf = el('text', { x: x + bw / 2, y: H - 2, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 600, fill: C.good }, svg);
      pf.textContent = '+' + profit[i];
    });
    el('line', { x1: ML, x2: W - MR, y1: sy(bep), y2: sy(bep), stroke: C.bep, 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }, svg);
  }

  var M1 = ['4月', '5月', '6月', '7月', '8月', '9月'];
  var M2 = ['10月', '11月', '12月', '1月', '2月', '3月'];
  groupedChart('chart-neya', '寝屋川店', M1, [197.2, 203.9, 221.3, 257.7, 252.8, 230.1], [160.3, 127.9, 133.8, 143.2, 142.6, 132.3]);
  groupedChart('chart-mori', '守口店',   M1, [132.0, 148.4, 170.9, 199.6, 202.1, 185.1], [165.3, 139.2, 151.8, 158.7, 151.5, 132.0]);
  targetChart('chart-neya-target', '寝屋川店', M2, [240, 220, 250, 220, 230, 260], [37, 23, 49, 23, 31, 51], 193);
  targetChart('chart-mori-target', '守口店',   M2, [190, 170, 190, 170, 175, 200], [22, 5, 22, 5, 9, 31], 164);
})();
</script>
</body>
</html>
