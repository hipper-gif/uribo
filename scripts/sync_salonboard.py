"""サロンボードから月次売上を取得して Uribo (Nicolio API) に同期する

使い方:
    python sync_salonboard.py                    # 両店・前月分
    python sync_salonboard.py --store neyagawa   # 寝屋川のみ
    python sync_salonboard.py --month 2026-04    # 月指定
    python sync_salonboard.py --dry-run          # API更新せず取得結果だけ表示

前提:
    pip install -r requirements.txt
    playwright install chromium
    .env にサロンボードの認証情報をセット（.env.example 参照）

取得→マッピング:
    総売上 (金額)         → beauty_item_master.sales            (item_id=1)
    純売上 (客数)         → beauty_item_master.customers        (item_id=2)
    割引   (金額)         → beauty_item_master.discount         (item_id=4)
    純売上 内消費税(金額) → beauty_item_master.withholding_tax  (item_id=24)
    data_type は常に "実績"。同月の既存レコードは PATCH、無ければ POST。
    （Uribo の計算式は net_profit = sales - discount - 経費 なので
      sales には割引控除前の「総売上」を入れる必要がある。
      預かり税は純売上セルの "金額\n内消費税 N" の N を直接拾う。
      仕入の税額を引いた納付額は UI 側で計算する想定）

注意:
    サロンボードは Akamai bot 対策のため headless=False 必須。
    実行中にブラウザが開く（GUI 環境でのみ動作）。
"""
import argparse
import calendar
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from datetime import date
from pathlib import Path

from dateutil.relativedelta import relativedelta
from dotenv import load_dotenv
from playwright.sync_api import Page, sync_playwright

load_dotenv(Path(__file__).parent / ".env")

API_URL = os.getenv("NICOLIO_API_URL", "https://twinklemark.xsrv.jp/nicolio-api/api.php")
API_TOKEN = os.getenv("NICOLIO_API_TOKEN", "nicolio_secret_2525xsrv")
MNEME_API_URL = os.getenv("MNEME_API_URL", "https://twinklemark.xsrv.jp/mneme-api/index.php")
MNEME_API_TOKEN = os.getenv("MNEME_API_TOKEN", "mneme_secret_2525xsrv")

LOGIN_URL = "https://salonboard.com/login/"

STORE_TO_ID = {"neyagawa": 1, "moriguchi": 2}
STORE_LABEL = {"neyagawa": "寝屋川店", "moriguchi": "守口店"}

ITEM_SALES = 1
ITEM_CUSTOMERS = 2
ITEM_DISCOUNT = 4
ITEM_WITHHOLDING_TAX = 24

DATA_TYPE = "実績"


def prev_month_str() -> str:
    d = date.today() - relativedelta(months=1)
    return d.strftime("%Y-%m")


def fiscal_year_for(year: int, month: int) -> int:
    return year if month >= 4 else year - 1


def parse_amount(raw: str) -> int:
    """サロンボードのセルテキストから先頭行の整数を抽出

    例:
      "12,345"                       → 12345
      "12,345 / 内消費税 1,234"      → 12345  (スラッシュで区切り)
      "12,345\n内消費税 1,234"       → 12345  (改行で区切り、純売上のパターン)
      "-1,234"                       → -1234
      ""                             → 0
    """
    if not raw:
        return 0
    # 改行・スラッシュ・タブで分割した最初のトークンだけ採用
    head = re.split(r"[\n\r/\t]", raw)[0].strip()
    digits = re.sub(r"[^0-9-]", "", head)
    if not digits or digits == "-":
        return 0
    return int(digits)


def parse_inner_tax(raw: str) -> int:
    """セルテキストから「（内消費税：N 円）」等の N を抽出。見つからなければ 0

    実際の HTML 例:
      <div>1,798,870 円</div>
      <div>（内消費税：163,377 円）</div>
    text_content() で取得すると "1,798,870 円\n（内消費税：163,377 円）" となる。
    """
    if not raw:
        return 0
    # 「内消費税」の後ろに 全角/半角コロン・空白等を挟んで数値が来るパターン
    m = re.search(r"内消費税[：:\s　]*([-]?[\d,]+)", raw)
    if not m:
        return 0
    digits = re.sub(r"[^0-9-]", "", m.group(1))
    if not digits or digits == "-":
        return 0
    return int(digits)


def creds_for(store: str) -> tuple[str, str]:
    if store == "neyagawa":
        uid = os.getenv("SALONBOARD_NEYAGAWA_ID")
        pwd = os.getenv("SALONBOARD_NEYAGAWA_PASS")
    else:
        uid = os.getenv("SALONBOARD_MORIGUCHI_ID")
        pwd = os.getenv("SALONBOARD_MORIGUCHI_PASS")
    if not uid or not pwd:
        raise SystemExit(f".env に {store} の SALONBOARD 認証情報が設定されていません")
    return uid, pwd


def login(page: Page, store: str, interactive: bool = True):
    """通常ログイン。タイムアウトしたら CAPTCHA 等の可能性があり手動介入を待つ。

    interactive=False の場合（cron 実行など）はタイムアウト時に例外送出。
    """
    uid, pwd = creds_for(store)
    if not page.url.startswith("https://salonboard.com/login"):
        page.goto(LOGIN_URL, wait_until="domcontentloaded")
    page.wait_for_selector('input[name="userId"]', timeout=10000)
    page.fill('input[name="userId"]', uid)
    page.fill('input[name="password"]', pwd)
    page.click("a.common-CNCcommon__primaryBtn.loginBtnSize")

    try:
        page.wait_for_url("**/KLP/top/**", timeout=20000)
        return
    except Exception:
        pass

    if not interactive:
        raise SystemExit(
            f"  {STORE_LABEL[store]} のログインが完了しませんでした"
            " (CAPTCHA 等の可能性。--non-interactive を外して再実行してください)"
        )

    # 手動介入待ち: ブラウザは開いたまま
    print()
    print(f"  [!] {STORE_LABEL[store]} のログインが自動完了しませんでした。")
    print(f"      開いているブラウザで CAPTCHA / 追加認証を手動で解いてください。")
    print(f"      ログイン後トップ画面 (URL に /KLP/top/) に到達したら Enter を押下。")
    print(f"      中止する場合は Ctrl+C")
    try:
        input("    > Enter で続行: ")
    except (KeyboardInterrupt, EOFError):
        raise SystemExit("\n  中止されました")

    # ユーザーが Enter を押したあと、まだ遷移中かもしれないので最大2分待つ
    if "/KLP/top/" not in page.url:
        try:
            page.wait_for_url("**/KLP/top/**", timeout=120000)
        except Exception:
            raise SystemExit(
                f"  まだ {STORE_LABEL[store]} のトップに到達していません (現在 URL: {page.url})。中止します"
            )
    print(f"  ログイン継続: {page.url}")


def goto_aggregate(page: Page, year: int, month: int):
    last_day = calendar.monthrange(year, month)[1]
    year_s, month_s, start_s, end_s = f"{year}", f"{month:02d}", "01", f"{last_day:02d}"

    page.get_by_role("link", name="売上管理").first.click()
    report_link = page.get_by_role("link", name="売上報告").first
    report_link.wait_for(state="visible", timeout=15000)
    report_link.click()
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_selector("#scopeDateFrom", timeout=15000, state="attached")

    start_compact = f"{year_s}{month_s}{start_s}"
    end_compact = f"{year_s}{month_s}{end_s}"
    start_disp = f"{year}年{month}月{int(start_s)}日"
    end_disp = f"{year}年{month}月{int(end_s)}日"
    page.evaluate(
        """([sc1, di1, sc2, di2]) => {
            document.querySelector('#scopeDateFrom').value = sc1;
            document.querySelector('#dispDateFrom').value = di1;
            document.querySelector('#scopeDateTo').value = sc2;
            document.querySelector('#dispDateTo').value = di2;
        }""",
        [start_compact, start_disp, end_compact, end_disp],
    )
    page.locator("#aggregate").click()
    page.wait_for_url("**/salesReport/aggregate", timeout=20000)
    page.wait_for_selector("h2.ttl >> text=売上情報", timeout=15000)


def scrape_sales(page: Page) -> dict:
    """総売上 / 客数 / 割引 を抽出

    サロンボードの売上情報セクションは2テーブル構成:
      table1: 施術 / オプション / 商品 / 総売上    (金額のみ。客数列は空)
      table2: 割引 / 純売上                          (純売上行に客数あり)
    Uribo は sales=総売上 + discount で純利益を算出するため、
      sales = 総売上行の金額
      customers = 純売上行の客数 (= 会計件数)
      discount = 割引行の金額 (絶対値)
    """
    container = page.locator("div.fl:has(h3.mod_title03:text-is('売上情報'))").first
    tables = container.locator("table.mod_table03")

    result = {"sales": 0, "customers": 0, "discount": 0, "withholding_tax": 0}

    for ti in range(tables.count()):
        table = tables.nth(ti)
        for tr in table.locator("tbody > tr.mod_middle").all():
            cls = tr.get_attribute("class") or ""
            if " dn" in f" {cls} " or cls.endswith("dn"):
                continue  # 内訳隠し行
            label_loc = tr.locator("th p.fl").first
            if label_loc.count() == 0:
                continue
            label = (label_loc.text_content() or "").strip()
            tds = tr.locator("td")
            if tds.count() < 2:
                continue
            amount_raw = (tds.nth(0).text_content() or "").strip()
            count_raw = (tds.nth(1).text_content() or "").strip()

            if label == "総売上":
                result["sales"] = parse_amount(amount_raw)
            elif label == "純売上":
                # 客数（会計件数）と内消費税は純売上行にしかない
                result["customers"] = parse_amount(count_raw)
                result["withholding_tax"] = parse_inner_tax(amount_raw)
            elif label == "割引":
                # サロンボードは割引額をマイナス表示するが Uribo の discount は正の値
                result["discount"] = abs(parse_amount(amount_raw))

    return result


def goto_staff_summary(page: Page) -> None:
    """集計・分析 → スタッフ別集計 → 先月 → 集計"""
    page.get_by_role("link", name=re.compile("集計.*分析")).first.click()
    page.wait_for_load_state("domcontentloaded")
    time.sleep(0.5)
    # スタッフ別集計
    candidates = [
        page.get_by_role("link", name=re.compile("スタッフ別集計")),
        page.locator("a:has-text('スタッフ別集計')"),
    ]
    for c in candidates:
        if c.count() > 0:
            c.first.click()
            break
    page.wait_for_load_state("domcontentloaded")
    time.sleep(0.5)
    # 先月ボタン
    page.locator("#lastMonthSet").first.click()
    time.sleep(0.3)
    # 集計
    btns = [
        page.locator("#aggregate"),
        page.get_by_role("button", name=re.compile("^集計$")),
        page.locator("button:has-text('集計')"),
    ]
    for b in btns:
        if b.count() > 0:
            b.first.click()
            break
    page.wait_for_load_state("domcontentloaded")
    time.sleep(2.0)


def scrape_staff_summary(page: Page) -> list[dict]:
    """スタッフ別集計テーブルから行を抽出（「店舗全体」行は除外）

    列構成:
      0: スタッフ名 (改行込み)
      1: 総売上 / 2: 施術 / 3: 店販 / 4: オプション
      5: 客単価 / 6: 総客数 / 7: 新規 / 8: 再来
      9: 指名売上 / 10: 施術(指名) / 11: 店販(指名) / 12: オプション(指名)
      13: 指名数
    """
    rows = page.evaluate("""() => {
        const tbl = document.querySelector('table.staffSalesTable');
        if (!tbl) return [];
        return Array.from(tbl.querySelectorAll('tbody tr')).map(tr =>
            Array.from(tr.children).map(c => (c.innerText || '').trim())
        );
    }""")
    parsed = []
    for r in rows:
        if not r or len(r) < 14:
            continue
        # 「店舗全体」は除外
        name_field = r[0]
        if name_field.startswith("店舗全体"):
            continue
        # 名前は1行目を採用
        name = name_field.split("\n")[0].strip()
        parsed.append({
            "salonboard_name": name,
            "sales_total": parse_amount(r[1]),
            "sales_treatment": parse_amount(r[2]),
            "sales_product": parse_amount(r[3]),
            "sales_option": parse_amount(r[4]),
            "unit_price": parse_amount(r[5]),
            "customers_total": parse_amount(r[6]),
            "customers_new": parse_amount(r[7]),
            "customers_repeat": parse_amount(r[8]),
            "nomination_sales": parse_amount(r[9]),
            "nomination_count": parse_amount(r[13]),
        })
    return parsed


def fetch_one_store(month: str, store: str, interactive: bool = True, with_staff: bool = False) -> dict:
    year_s, month_s = month.split("-")
    year, mon = int(year_s), int(month_s)

    print(f"  [{STORE_LABEL[store]}] サロンボードから取得中...")
    result = {"sales": {}, "staff": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        page = context.new_page()
        page.add_init_script("delete Object.getPrototypeOf(navigator).webdriver")
        try:
            try:
                login(page, store, interactive=interactive)
                goto_aggregate(page, year, mon)
                result["sales"] = scrape_sales(page)
                if with_staff:
                    print(f"    スタッフ別集計取得中...")
                    goto_staff_summary(page)
                    result["staff"] = scrape_staff_summary(page)
            except Exception:
                shot_dir = Path(__file__).parent / "debug"
                shot_dir.mkdir(exist_ok=True)
                shot = shot_dir / f"fail_{store}_{month}.png"
                html = shot_dir / f"fail_{store}_{month}.html"
                try:
                    page.screenshot(path=str(shot), full_page=True)
                    html.write_text(page.content(), encoding="utf-8")
                    print(f"    デバッグ保存: {shot}")
                except Exception as ee:
                    print(f"    デバッグ保存失敗: {ee}")
                raise
        finally:
            browser.close()
    s = result["sales"]
    print(
        f"    総売上={s['sales']:,} 客数={s['customers']:,} "
        f"割引={s['discount']:,} 内消費税={s['withholding_tax']:,}"
    )
    if with_staff:
        print(f"    スタッフ {len(result['staff'])}名取得")
    return result


# ---- Nicolio API -----------------------------------------------------------


def _api_request(method: str, path: str, body: dict | None = None) -> list | dict:
    url = f"{API_URL}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {API_TOKEN}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as res:
            text = res.read().decode("utf-8")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"API {method} {path} failed: {e.code} {e.read().decode('utf-8', 'ignore')}")


def upsert_amount(store_id: int, fiscal_year: int, mon: int, item_id: int, amount: int):
    """beauty_monthly_data に (store_id, fiscal_year, month, data_type, item_id) でUPSERT"""
    qs = urllib.parse.urlencode({
        "store_id": f"eq.{store_id}",
        "fiscal_year": f"eq.{fiscal_year}",
        "month": f"eq.{mon}",
        "data_type": f"eq.{DATA_TYPE}",
        "item_id": f"eq.{item_id}",
    })
    filt = f"beauty_monthly_data?{qs}"
    existing = _api_request("GET", filt)
    body = {"amount": str(amount)}
    if isinstance(existing, list) and existing:
        _api_request("PATCH", filt, body)
        return "updated"
    body.update({
        "store_id": store_id,
        "fiscal_year": fiscal_year,
        "month": mon,
        "data_type": DATA_TYPE,
        "item_id": item_id,
    })
    _api_request("POST", "beauty_monthly_data", body)
    return "inserted"


def push_to_uribo(store: str, month: str, data: dict):
    year_s, month_s = month.split("-")
    year, mon = int(year_s), int(month_s)
    fy = fiscal_year_for(year, mon)
    sid = STORE_TO_ID[store]

    pairs = [
        (ITEM_SALES, data["sales"], "総売上"),
        (ITEM_CUSTOMERS, data["customers"], "客数"),
        (ITEM_DISCOUNT, data["discount"], "割引"),
        (ITEM_WITHHOLDING_TAX, data["withholding_tax"], "預かり税"),
    ]
    for item_id, value, label in pairs:
        action = upsert_amount(sid, fy, mon, item_id, value)
        print(f"    {label} ({action}): item_id={item_id} amount={value:,}")


# ---- Staff payroll sync ---------------------------------------------------


def _mneme_request(method: str, path: str, body: dict | None = None):
    url = f"{MNEME_API_URL}/{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Authorization": f"Bearer {MNEME_API_TOKEN}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req) as res:
        text = res.read().decode("utf-8")
        return json.loads(text) if text else {}


def get_alias_map(store_code: str) -> dict[str, int]:
    qs = urllib.parse.urlencode({
        "store_code": f"eq.{store_code}",
        "select": "salonboard_name,employee_id",
    })
    rows = _api_request("GET", f"salonboard_staff_alias?{qs}")
    return {r["salonboard_name"]: int(r["employee_id"]) for r in rows} if isinstance(rows, list) else {}


def get_active_grade(employee_id: int, year: int, mon: int) -> dict | None:
    """その月時点で active なランク履歴を取得"""
    last_day = calendar.monthrange(year, mon)[1]
    month_end = f"{year:04d}-{mon:02d}-{last_day:02d}"
    qs = urllib.parse.urlencode({
        "employee_id": f"eq.{employee_id}",
        "effective_from": f"lte.{month_end}",
        "order": "effective_from.desc",
        "limit": "10",
    })
    rows = _api_request("GET", f"beauty_employee_grade?{qs}")
    if not isinstance(rows, list):
        return None
    month_start = f"{year:04d}-{mon:02d}-01"
    for r in rows:
        eto = r.get("effective_to")
        if eto is None or eto >= month_start:
            return r
    return None


def get_grade_base_amount(employment_type: str, grade: str, year: int, mon: int) -> int:
    last_day = calendar.monthrange(year, mon)[1]
    month_end = f"{year:04d}-{mon:02d}-{last_day:02d}"
    qs = urllib.parse.urlencode({
        "employment_type": f"eq.{employment_type}",
        "grade": f"eq.{grade}",
        "effective_from": f"lte.{month_end}",
        "order": "effective_from.desc",
        "limit": "5",
    })
    rows = _api_request("GET", f"beauty_salary_grade?{qs}")
    if not isinstance(rows, list):
        return 0
    month_start = f"{year:04d}-{mon:02d}-01"
    for r in rows:
        eto = r.get("effective_to")
        if eto is None or eto >= month_start:
            return int(r["base_amount"])
    return 0


_commission_cache: list[dict] = []


def get_commission_amount(sales_total: int, year: int, mon: int) -> int:
    """売上→歩合テーブルの階段関数（sales_threshold <= 売上の中で最大の commission_amount）"""
    global _commission_cache
    if not _commission_cache:
        last_day = calendar.monthrange(year, mon)[1]
        month_end = f"{year:04d}-{mon:02d}-{last_day:02d}"
        month_start = f"{year:04d}-{mon:02d}-01"
        qs = urllib.parse.urlencode({
            "effective_from": f"lte.{month_end}",
            "order": "sales_threshold.desc",
        })
        rows = _api_request("GET", f"beauty_commission_table?{qs}")
        if isinstance(rows, list):
            _commission_cache = [
                r for r in rows
                if r.get("effective_to") is None or r["effective_to"] >= month_start
            ]
    for r in _commission_cache:
        if sales_total >= int(r["sales_threshold"]):
            return int(r["commission_amount"])
    return 0


def get_position_allowance(employee_id: int, year: int, mon: int) -> tuple[int, str]:
    """Mneme employees.job_title から店長判定し、beauty_position_allowance の額を返す"""
    qs = urllib.parse.urlencode({
        "id": f"eq.{employee_id}",
        "select": "job_title",
    })
    try:
        rows = _mneme_request("GET", f"employees?{qs}")
    except Exception:
        return 0, ""
    if not isinstance(rows, list) or not rows:
        return 0, ""
    job = rows[0].get("job_title") or ""
    if not job:
        return 0, ""
    last_day = calendar.monthrange(year, mon)[1]
    month_end = f"{year:04d}-{mon:02d}-{last_day:02d}"
    month_start = f"{year:04d}-{mon:02d}-01"
    qs = urllib.parse.urlencode({
        "position_name": f"eq.{job}",
        "effective_from": f"lte.{month_end}",
        "order": "effective_from.desc",
        "limit": "5",
    })
    rows = _api_request("GET", f"beauty_position_allowance?{qs}")
    if not isinstance(rows, list):
        return 0, job
    for r in rows:
        eto = r.get("effective_to")
        if eto is None or eto >= month_start:
            return int(r["amount"]), job
    return 0, job


def calc_payroll(employee_id: int, store_id: int, year: int, mon: int, scraped: dict) -> dict:
    """スクレイプ値+マスタから給与計算レコードを構築"""
    sales = int(scraped.get("sales_total", 0))
    nom_count = int(scraped.get("nomination_count", 0))

    base_salary = 0
    employment_type = ""
    grade_letter = ""
    override = 0
    grade = get_active_grade(employee_id, year, mon)
    if grade:
        employment_type = grade["employment_type"]
        grade_letter = grade["grade"]
        override = int(grade.get("base_salary_override") or 0)
        amount = get_grade_base_amount(employment_type, grade_letter, year, mon)
        # 月給制のみ自動セット。時給制(パート)は時給単価を base_salary には入れず0のままにする
        # （時給×勤務時間は別途、勤務時間が判明してから計算）
        if employment_type in ("有期雇用", "正社員"):
            base_salary = amount + override

    commission = get_commission_amount(sales, year, mon)
    nomination_allow = nom_count * 500
    pos_allow, pos_name = get_position_allowance(employee_id, year, mon)
    total = base_salary + commission + nomination_allow + pos_allow

    return {
        "employee_id": employee_id,
        "store_id": store_id,
        "year": year,
        "month": mon,
        "sales_total": sales,
        "sales_treatment": int(scraped.get("sales_treatment", 0)),
        "sales_product": int(scraped.get("sales_product", 0)),
        "sales_option": int(scraped.get("sales_option", 0)),
        "customers_total": int(scraped.get("customers_total", 0)),
        "customers_new": int(scraped.get("customers_new", 0)),
        "customers_repeat": int(scraped.get("customers_repeat", 0)),
        "nomination_count_scraped": nom_count,
        "nomination_count_actual": nom_count,
        "nomination_sales": int(scraped.get("nomination_sales", 0)),
        "base_salary": base_salary,
        "commission_amount": commission,
        "nomination_allowance": nomination_allow,
        "position_allowance": pos_allow,
        "total_amount": total,
        "status": "draft",
    }


def upsert_payroll(record: dict) -> str:
    qs = urllib.parse.urlencode({
        "employee_id": f"eq.{record['employee_id']}",
        "year": f"eq.{record['year']}",
        "month": f"eq.{record['month']}",
    })
    existing = _api_request("GET", f"beauty_payroll_monthly?{qs}")
    if isinstance(existing, list) and existing:
        # PATCH (status=confirmed/tkc_entered なら自動取得部分のみ更新するが、シンプルに全PATCH)
        # 既存レコードの手入力部分は壊さないため、自動部分のみPATCH
        body = {k: v for k, v in record.items() if k not in (
            "employee_id", "year", "month",
            "nomination_count_actual",  # 手動補正値は壊さない
        )}
        # nomination_count_actual は既存が0なら scraped で初期化
        if int(existing[0].get("nomination_count_actual") or 0) == 0:
            body["nomination_count_actual"] = record["nomination_count_actual"]
            body["nomination_allowance"] = record["nomination_allowance"]
        _api_request("PATCH", f"beauty_payroll_monthly?{qs}", body)
        return "updated"
    _api_request("POST", "beauty_payroll_monthly", record)
    return "inserted"


def push_staff_payroll(store: str, month: str, staff_list: list[dict], dry_run: bool = False) -> None:
    year_s, month_s = month.split("-")
    year, mon = int(year_s), int(month_s)
    sid = STORE_TO_ID[store]

    alias_map = get_alias_map(store)
    print(f"\n  [{STORE_LABEL[store]}] スタッフ別給与計算 ({len(staff_list)}名)")

    for staff in staff_list:
        sb_name = staff["salonboard_name"]
        emp_id = alias_map.get(sb_name)
        if emp_id is None:
            print(f"    [WARN] 未マッピング: '{sb_name}' (skip)")
            continue
        record = calc_payroll(emp_id, sid, year, mon, staff)
        line = (
            f"    {sb_name:18} (emp={emp_id:3}) "
            f"売上={record['sales_total']:>8,} 歩合={record['commission_amount']:>6,} "
            f"指名{record['nomination_count_actual']:>2}={record['nomination_allowance']:>5,} "
            f"基本={record['base_salary']:>7,} 役職={record['position_allowance']:>5,} "
            f"合計={record['total_amount']:>7,}"
        )
        if dry_run:
            print(line + "  [dry-run]")
        else:
            action = upsert_payroll(record)
            print(line + f"  ({action})")


def main():
    parser = argparse.ArgumentParser(description="サロンボード→Uribo同期")
    parser.add_argument("--store", choices=["neyagawa", "moriguchi", "both"], default="both")
    parser.add_argument("--month", help="対象月 YYYY-MM（省略時は前月）")
    parser.add_argument("--dry-run", action="store_true", help="取得結果だけ表示してAPIには送らない")
    parser.add_argument(
        "--with-staff", action="store_true",
        help="スタッフ別集計も取得して beauty_payroll_monthly に投入（給与計算用）",
    )
    parser.add_argument(
        "--only-staff", action="store_true",
        help="店舗合計をスキップしてスタッフ別のみ取得（マッピング修正後の再取得用）",
    )
    parser.add_argument(
        "--non-interactive", action="store_true",
        help="CAPTCHA 等で自動ログイン失敗しても手動介入を待たず即エラー終了 (cron 運用用)",
    )
    args = parser.parse_args()

    month = args.month or prev_month_str()
    stores = ["neyagawa", "moriguchi"] if args.store == "both" else [args.store]
    interactive = not args.non_interactive
    with_staff = args.with_staff or args.only_staff

    print(f"\n=== サロンボード同期 {month} ===")
    if with_staff:
        print(f"    モード: 店舗合計{'スキップ' if args.only_staff else '+'} スタッフ別給与計算")

    for i, store in enumerate(stores):
        if i > 0:
            print("\n  (10秒待機)")
            time.sleep(10)
        data = fetch_one_store(month, store, interactive=interactive, with_staff=with_staff)
        if args.dry_run:
            print(f"    [dry-run] APIには送信しません")
            if with_staff and data["staff"]:
                push_staff_payroll(store, month, data["staff"], dry_run=True)
        else:
            if not args.only_staff:
                push_to_uribo(store, month, data["sales"])
            if with_staff and data["staff"]:
                push_staff_payroll(store, month, data["staff"], dry_run=False)

    print("\n完了")


if __name__ == "__main__":
    main()
