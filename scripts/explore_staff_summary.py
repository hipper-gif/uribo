"""サロンボード スタッフ別集計画面の構造調査スクリプト

動線:
  ログイン → 集計・分析 → スタッフ別集計 → 先月 → 集計
  到達したページの HTML / スクリーンショット / 抽出可能なテーブルデータを debug/ に保存。

使い方:
    python explore_staff_summary.py                    # 両店・前月分
    python explore_staff_summary.py --store neyagawa   # 寝屋川のみ
    python explore_staff_summary.py --month 2026-04    # 月指定

出力先:
    scripts/debug/explore_<store>_<month>/
        page.html          画面そのままのHTML
        screenshot.png     全画面スクリーンショット
        tables.json        テーブル構造（th/tdの行列を抽出）
        url.txt            到達URL
        nav_log.txt        画面遷移ログ
"""
import argparse
import calendar
import json
import os
import re
import sys
import time
from datetime import date
from pathlib import Path

from dateutil.relativedelta import relativedelta
from dotenv import load_dotenv
from playwright.sync_api import Page, sync_playwright

load_dotenv(Path(__file__).parent / ".env")

LOGIN_URL = "https://salonboard.com/login/"
STORE_LABEL = {"neyagawa": "寝屋川店", "moriguchi": "守口店"}


def prev_month_str() -> str:
    d = date.today() - relativedelta(months=1)
    return d.strftime("%Y-%m")


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


def login(page: Page, store: str, log) -> None:
    uid, pwd = creds_for(store)
    page.goto(LOGIN_URL, wait_until="domcontentloaded")
    log(f"[login] navigate {LOGIN_URL}")
    page.wait_for_selector('input[name="userId"]', timeout=10000)
    page.fill('input[name="userId"]', uid)
    page.fill('input[name="password"]', pwd)
    page.click("a.common-CNCcommon__primaryBtn.loginBtnSize")
    log("[login] submit credentials")

    try:
        page.wait_for_url("**/KLP/top/**", timeout=20000)
        log(f"[login] reached top: {page.url}")
        return
    except Exception:
        pass

    print()
    print(f"  [!] {STORE_LABEL[store]} のログインが自動完了しませんでした。")
    print(f"      開いているブラウザで CAPTCHA を解いてください。")
    print(f"      KLP/top に到達したら Enter を押下。")
    try:
        input("    > Enter で続行: ")
    except (KeyboardInterrupt, EOFError):
        raise SystemExit("\n  中止")

    if "/KLP/top/" not in page.url:
        try:
            page.wait_for_url("**/KLP/top/**", timeout=120000)
        except Exception:
            raise SystemExit(f"  まだトップに到達していません (URL: {page.url})")
    log(f"[login] reached top after manual: {page.url}")


def goto_staff_summary(page: Page, year: int, month: int, log) -> None:
    """集計・分析 → スタッフ別集計 → 先月（指定月）→ 集計"""
    # 集計・分析メニュー
    log("[nav] click '集計・分析'")
    aggregate_menu = page.get_by_role("link", name=re.compile("集計.*分析"))
    aggregate_menu.first.click()
    page.wait_for_load_state("domcontentloaded")
    time.sleep(1.0)
    log(f"[nav] now at: {page.url}")

    # スタッフ別集計
    log("[nav] click 'スタッフ別集計'")
    # リンク名はサロンボードの実装に依存するので、緩めに探す
    candidates = [
        page.get_by_role("link", name=re.compile("スタッフ別集計")),
        page.get_by_role("link", name=re.compile("スタッフ別")),
        page.locator("a:has-text('スタッフ別集計')"),
    ]
    clicked = False
    for cand in candidates:
        try:
            if cand.count() > 0:
                cand.first.click()
                clicked = True
                break
        except Exception:
            continue
    if not clicked:
        log("[nav][warn] 'スタッフ別集計' リンクが見つからない、現状URLを保存")
    else:
        page.wait_for_load_state("domcontentloaded")
        time.sleep(1.0)
        log(f"[nav] now at: {page.url}")

    # 期間: 先月（指定月）の1日〜末日
    last_day = calendar.monthrange(year, month)[1]
    year_s = f"{year}"
    month_s = f"{month:02d}"
    start_compact = f"{year_s}{month_s}01"
    end_compact = f"{year_s}{month_s}{last_day:02d}"
    start_disp = f"{year}年{month}月1日"
    end_disp = f"{year}年{month}月{last_day}日"

    # サロンボードの集計画面は #scopeDateFrom / #dispDateFrom が使われている（既存スクリプトと同じ可能性）
    has_scope = page.locator("#scopeDateFrom").count() > 0
    if has_scope:
        log("[nav] set period via #scopeDateFrom/#dispDateFrom")
        page.evaluate(
            """([sc1, di1, sc2, di2]) => {
                document.querySelector('#scopeDateFrom').value = sc1;
                if (document.querySelector('#dispDateFrom'))
                    document.querySelector('#dispDateFrom').value = di1;
                if (document.querySelector('#scopeDateTo'))
                    document.querySelector('#scopeDateTo').value = sc2;
                if (document.querySelector('#dispDateTo'))
                    document.querySelector('#dispDateTo').value = di2;
            }""",
            [start_compact, start_disp, end_compact, end_disp],
        )
    else:
        log("[nav][warn] #scopeDateFrom が見つからない。期間UIは要調査")

    # 集計ボタン
    log("[nav] click '集計' button")
    btn_candidates = [
        page.locator("#aggregate"),
        page.get_by_role("button", name=re.compile("^集計$")),
        page.locator("button:has-text('集計')"),
        page.locator("a:has-text('集計'):not(:has-text('集計・分析'))"),
    ]
    for cand in btn_candidates:
        try:
            if cand.count() > 0:
                cand.first.click()
                break
        except Exception:
            continue
    page.wait_for_load_state("domcontentloaded")
    time.sleep(2.0)  # 結果描画を待つ
    log(f"[nav] final URL: {page.url}")


def extract_tables(page: Page) -> list[dict]:
    """ページ上の全 table を { headers, rows } 形式で抽出"""
    return page.evaluate("""() => {
        const tables = Array.from(document.querySelectorAll('table'));
        return tables.map((tbl, i) => {
            const cls = tbl.className || '';
            const id = tbl.id || '';
            const caption = tbl.querySelector('caption')?.innerText?.trim() || '';
            const headers = Array.from(tbl.querySelectorAll('thead tr')).map(tr =>
                Array.from(tr.children).map(c => (c.innerText || '').trim())
            );
            const rows = Array.from(tbl.querySelectorAll('tbody tr')).map(tr =>
                Array.from(tr.children).map(c => (c.innerText || '').trim())
            );
            return { index: i, id, class: cls, caption, headers, rows };
        });
    }""")


def explore_one_store(month: str, store: str) -> Path:
    year_s, month_s = month.split("-")
    year, mon = int(year_s), int(month_s)

    out_dir = Path(__file__).parent / "debug" / f"explore_{store}_{month}"
    out_dir.mkdir(parents=True, exist_ok=True)
    nav_log_path = out_dir / "nav_log.txt"
    log_lines: list[str] = []

    def log(msg: str) -> None:
        log_lines.append(msg)
        print(f"  {msg}")

    print(f"\n=== [{STORE_LABEL[store]}] スタッフ別集計画面 調査 ({month}) ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                       "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        )
        page = context.new_page()
        page.add_init_script("delete Object.getPrototypeOf(navigator).webdriver")
        try:
            login(page, store, log)
            goto_staff_summary(page, year, mon, log)

            # HTML保存
            html_path = out_dir / "page.html"
            html_path.write_text(page.content(), encoding="utf-8")
            log(f"[save] {html_path}")

            # スクリーンショット
            shot_path = out_dir / "screenshot.png"
            page.screenshot(path=str(shot_path), full_page=True)
            log(f"[save] {shot_path}")

            # URL
            url_path = out_dir / "url.txt"
            url_path.write_text(page.url, encoding="utf-8")
            log(f"[save] {url_path}")

            # テーブル抽出
            try:
                tables = extract_tables(page)
                tables_path = out_dir / "tables.json"
                tables_path.write_text(
                    json.dumps(tables, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                log(f"[save] {tables_path} ({len(tables)} tables)")
            except Exception as e:
                log(f"[err] tables extraction failed: {e}")

        except Exception as e:
            log(f"[FATAL] {e}")
            try:
                fail_shot = out_dir / "fail_screenshot.png"
                page.screenshot(path=str(fail_shot), full_page=True)
                fail_html = out_dir / "fail_page.html"
                fail_html.write_text(page.content(), encoding="utf-8")
                log(f"[save] failure artifacts to {out_dir}")
            except Exception:
                pass
            raise
        finally:
            nav_log_path.write_text("\n".join(log_lines), encoding="utf-8")
            browser.close()

    return out_dir


def main():
    parser = argparse.ArgumentParser(description="サロンボード スタッフ別集計画面の構造調査")
    parser.add_argument("--store", choices=["neyagawa", "moriguchi", "both"], default="both")
    parser.add_argument("--month", help="対象月 YYYY-MM（省略時は前月）")
    args = parser.parse_args()

    month = args.month or prev_month_str()
    stores = ["neyagawa", "moriguchi"] if args.store == "both" else [args.store]

    print(f"\n=== 調査対象月: {month} ===")
    for i, store in enumerate(stores):
        if i > 0:
            print("\n  (10秒待機)")
            time.sleep(10)
        out_dir = explore_one_store(month, store)
        print(f"\n  → 出力: {out_dir}")

    print("\n調査完了。debug/ ディレクトリ内のファイルを確認してください。")


if __name__ == "__main__":
    main()
