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
    """セルテキストから「内消費税 N」の N を抽出。見つからなければ 0"""
    if not raw:
        return 0
    m = re.search(r"内消費税[\s　]*([-]?[\d,]+)", raw)
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


def fetch_one_store(month: str, store: str, interactive: bool = True) -> dict:
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
            try:
                login(page, store, interactive=interactive)
                goto_aggregate(page, year, mon)
                data = scrape_sales(page)
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
    print(
        f"    総売上={data['sales']:,} 客数={data['customers']:,} "
        f"割引={data['discount']:,} 内消費税={data['withholding_tax']:,}"
    )
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


def main():
    parser = argparse.ArgumentParser(description="サロンボード→Uribo同期")
    parser.add_argument("--store", choices=["neyagawa", "moriguchi", "both"], default="both")
    parser.add_argument("--month", help="対象月 YYYY-MM（省略時は前月）")
    parser.add_argument("--dry-run", action="store_true", help="取得結果だけ表示してAPIには送らない")
    parser.add_argument(
        "--non-interactive", action="store_true",
        help="CAPTCHA 等で自動ログイン失敗しても手動介入を待たず即エラー終了 (cron 運用用)",
    )
    args = parser.parse_args()

    month = args.month or prev_month_str()
    stores = ["neyagawa", "moriguchi"] if args.store == "both" else [args.store]
    interactive = not args.non_interactive

    print(f"\n=== サロンボード同期 {month} ===")
    for i, store in enumerate(stores):
        if i > 0:
            # bot対策レート制限回避のため店舗間に間隔を空ける
            print("\n  (10秒待機)")
            time.sleep(10)
        data = fetch_one_store(month, store, interactive=interactive)
        if args.dry_run:
            print(f"    [dry-run] APIには送信しません")
        else:
            push_to_uribo(store, month, data)

    print("\n完了")


if __name__ == "__main__":
    main()
