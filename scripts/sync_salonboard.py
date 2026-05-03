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
    純売上 (金額) → beauty_item_master.sales       (item_id=1)
    純売上 (客数) → beauty_item_master.customers   (item_id=2)
    割引   (金額) → beauty_item_master.discount    (item_id=4)
    data_type は常に "実績"。同月の既存レコードは PATCH、無ければ POST。

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

LOGIN_URL = "https://salonboard.com/login/"

STORE_TO_ID = {"neyagawa": 1, "moriguchi": 2}
STORE_LABEL = {"neyagawa": "寝屋川店", "moriguchi": "守口店"}

ITEM_SALES = 1
ITEM_CUSTOMERS = 2
ITEM_DISCOUNT = 4

DATA_TYPE = "実績"


def prev_month_str() -> str:
    d = date.today() - relativedelta(months=1)
    return d.strftime("%Y-%m")


def fiscal_year_for(year: int, month: int) -> int:
    return year if month >= 4 else year - 1


def parse_amount(raw: str) -> int:
    """サロンボードのテキスト ("12,345" や "12,345 / 内消費税..." 等) から整数を抽出"""
    head = raw.split("/")[0].strip()
    digits = re.sub(r"[^0-9-]", "", head)
    return int(digits) if digits else 0


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


def login(page: Page, store: str):
    uid, pwd = creds_for(store)
    if not page.url.startswith("https://salonboard.com/login"):
        page.goto(LOGIN_URL, wait_until="domcontentloaded")
    page.wait_for_selector('input[name="userId"]', timeout=10000)
    page.fill('input[name="userId"]', uid)
    page.fill('input[name="password"]', pwd)
    page.click("a.common-CNCcommon__primaryBtn.loginBtnSize")
    page.wait_for_url("**/KLP/top/**", timeout=20000)


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
    """純売上 / 客数 / 割引 を抽出"""
    container = page.locator("div.fl:has(h3.mod_title03:text-is('売上情報'))").first
    tables = container.locator("table.mod_table03")

    result = {"sales": 0, "customers": 0, "discount": 0}

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

            if label == "純売上":
                result["sales"] = parse_amount(amount_raw)
                result["customers"] = parse_amount(count_raw)
            elif label == "割引":
                result["discount"] = parse_amount(amount_raw)

    return result


def fetch_one_store(month: str, store: str) -> dict:
    year_s, month_s = month.split("-")
    year, mon = int(year_s), int(month_s)

    print(f"  [{STORE_LABEL[store]}] サロンボードから取得中...")
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
            login(page, store)
            goto_aggregate(page, year, mon)
            data = scrape_sales(page)
        finally:
            browser.close()
    print(f"    純売上={data['sales']:,} 客数={data['customers']:,} 割引={data['discount']:,}")
    return data


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
    filt = (
        f"beauty_monthly_data?store_id=eq.{store_id}&fiscal_year=eq.{fiscal_year}"
        f"&month=eq.{mon}&data_type=eq.{DATA_TYPE}&item_id=eq.{item_id}"
    )
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
        (ITEM_SALES, data["sales"], "純売上"),
        (ITEM_CUSTOMERS, data["customers"], "客数"),
        (ITEM_DISCOUNT, data["discount"], "割引"),
    ]
    for item_id, value, label in pairs:
        action = upsert_amount(sid, fy, mon, item_id, value)
        print(f"    {label} ({action}): item_id={item_id} amount={value:,}")


def main():
    parser = argparse.ArgumentParser(description="サロンボード→Uribo同期")
    parser.add_argument("--store", choices=["neyagawa", "moriguchi", "both"], default="both")
    parser.add_argument("--month", help="対象月 YYYY-MM（省略時は前月）")
    parser.add_argument("--dry-run", action="store_true", help="取得結果だけ表示してAPIには送らない")
    args = parser.parse_args()

    month = args.month or prev_month_str()
    stores = ["neyagawa", "moriguchi"] if args.store == "both" else [args.store]

    print(f"\n=== サロンボード同期 {month} ===")
    for i, store in enumerate(stores):
        if i > 0:
            print()  # 店舗間の区切り
        data = fetch_one_store(month, store)
        if args.dry_run:
            print(f"    [dry-run] APIには送信しません")
        else:
            push_to_uribo(store, month, data)

    print("\n完了")


if __name__ == "__main__":
    main()
