"""TKC FX 入力用 支払区分集計エクスポート

beauty_monthly_data に保存された支払区分を月別・店舗別で集計し、
TKC FX に転記しやすい形で表示・CSV出力する。

使い方:
    python export_tkc_fx.py --month 2026-04
        画面に表形式で表示 + payments_2026-04.csv 出力

    python export_tkc_fx.py --month 2026-04 --paste
        画面表示 + クリップボードにタブ区切りでコピー (TKC FXに直接貼付)

    python export_tkc_fx.py --month 2026-04 --no-csv
        画面表示のみ
"""
import argparse
import csv
import os
import sys
import urllib.parse
import urllib.request
import json
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

# Windows cp932 環境でも日本語/Unicode を出力できるように
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv(Path(__file__).parent / ".env")

API_URL = os.getenv("NICOLIO_API_URL", "https://twinklemark.xsrv.jp/nicolio-api/api.php")
API_TOKEN = os.getenv("NICOLIO_API_TOKEN", "nicolio_secret_2525xsrv")

# (item_code, 表示名, 行カテゴリ)
ROW_DEFS = [
    ("cash_sales_d01_10", "現金", "1〜10日"),
    ("cash_sales_d11_20", "現金", "11〜20日"),
    ("cash_sales_d21_end", "現金", "21〜末日"),
    ("card_sales", "クレジット", "月計"),
    ("ic_sales", "電子マネー", "月計"),
    ("gift_sales", "ギフト券", "月計"),
    ("point_sales", "ポイント", "月計"),
    ("other_payment_sales", "その他", "月計"),
]

STORES = [(1, "寝屋川店"), (2, "守口店")]


def _api_get(path: str) -> list:
    url = f"{API_URL}/{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {API_TOKEN}"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def fiscal_year_for(year: int, month: int) -> int:
    return year if month >= 4 else year - 1


def fetch_amounts(year: int, month: int) -> dict[tuple[int, str], int]:
    """{(store_id, item_code): amount} を返す"""
    fy = fiscal_year_for(year, month)
    qs = urllib.parse.urlencode({"item_code": "like.*sales*"})
    items = _api_get(f"beauty_item_master?{qs}")
    code_to_id = {r["item_code"]: int(r["id"]) for r in items if isinstance(r, dict)}
    target_ids = [code_to_id.get(d[0]) for d in ROW_DEFS]
    target_ids = [i for i in target_ids if i is not None]

    qs = urllib.parse.urlencode({
        "fiscal_year": f"eq.{fy}",
        "month": f"eq.{month}",
        "data_type": "eq.実績",
    })
    rows = _api_get(f"beauty_monthly_data?{qs}")
    id_to_code = {v: k for k, v in code_to_id.items()}
    out: dict[tuple[int, str], int] = {}
    for r in rows:
        item_id = int(r["item_id"])
        if item_id not in id_to_code:
            continue
        code = id_to_code[item_id]
        store_id = int(r["store_id"])
        amount = int(r.get("amount") or 0)
        out[(store_id, code)] = amount
    return out


def main():
    parser = argparse.ArgumentParser(description="TKC FX 用 支払区分集計エクスポート")
    parser.add_argument("--month", required=False, help="対象月 YYYY-MM (省略時は前月)")
    parser.add_argument("--paste", action="store_true", help="クリップボードにタブ区切りでコピー")
    parser.add_argument("--no-csv", action="store_true", help="CSV出力をスキップ")
    parser.add_argument("--output", help="CSV出力先 (省略時は payments_YYYY-MM.csv)")
    args = parser.parse_args()

    if args.month:
        y, m = args.month.split("-")
        year, month = int(y), int(m)
    else:
        from dateutil.relativedelta import relativedelta
        d = date.today() - relativedelta(months=1)
        year, month = d.year, d.month

    print(f"=== TKC FX 入力用 支払区分集計 {year}年{month}月 ===\n")

    amounts = fetch_amounts(year, month)
    if not amounts:
        print(f"⚠ {year}年{month}月のデータが beauty_monthly_data に見つかりません")
        print(f"  先に: python sync_salonboard.py --with-payments --month {year}-{month:02d}")
        return

    # 表形式で表示
    col1_w = 12
    col2_w = 10
    col_w = 15
    print(f"{'支払方法':<{col1_w}}{'期間':<{col2_w}}", end="")
    for _, label in STORES:
        print(f"{label:>{col_w}}", end="")
    print(f"{'合計':>{col_w}}")
    print("-" * (col1_w + col2_w + col_w * (len(STORES) + 1)))

    grand_totals = [0] * len(STORES)
    grand_grand = 0
    for code, label, period in ROW_DEFS:
        print(f"{label:<{col1_w}}{period:<{col2_w}}", end="")
        row_total = 0
        for i, (sid, _) in enumerate(STORES):
            amt = amounts.get((sid, code), 0)
            print(f"{amt:>{col_w},}", end="")
            grand_totals[i] += amt
            row_total += amt
        grand_grand += row_total
        print(f"{row_total:>{col_w},}")

    print("-" * (col1_w + col2_w + col_w * (len(STORES) + 1)))
    print(f"{'合計':<{col1_w + col2_w}}", end="")
    for t in grand_totals:
        print(f"{t:>{col_w},}", end="")
    print(f"{grand_grand:>{col_w},}")

    # CSV出力
    if not args.no_csv:
        out_path = Path(args.output) if args.output else Path(f"payments_{year}-{month:02d}.csv")
        with open(out_path, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            w.writerow(["支払方法", "期間"] + [s[1] for s in STORES] + ["合計"])
            for code, label, period in ROW_DEFS:
                vals = [amounts.get((sid, code), 0) for sid, _ in STORES]
                w.writerow([label, period] + vals + [sum(vals)])
            w.writerow(["合計", ""] + grand_totals + [grand_grand])
        print(f"\n✓ CSV出力: {out_path.absolute()}")

    # クリップボードコピー (TKC FX 貼り付け用タブ区切り)
    if args.paste:
        try:
            import subprocess
            tsv_lines = []
            for code, label, period in ROW_DEFS:
                vals = [str(amounts.get((sid, code), 0)) for sid, _ in STORES]
                tsv_lines.append("\t".join([label, period] + vals))
            tsv = "\n".join(tsv_lines)
            # Windows clip コマンド
            p = subprocess.run(["clip"], input=tsv, text=True, encoding="utf-8", shell=True)
            print(f"\n✓ クリップボードにタブ区切りで {len(tsv_lines)}行コピーしました")
        except Exception as e:
            print(f"\n[warn] クリップボードコピー失敗: {e}")


if __name__ == "__main__":
    main()
