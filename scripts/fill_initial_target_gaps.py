"""期初目標の「登録漏れの科目」を補う（2026-10-15）。

背景:
  FY2026 の期初目標（data_type「目標」）は、決済手数料・備品・交通費・電気代・通信費・保険料などが
  1年を通して 0円（未登録）だった。このため期初目標の純利益が実際より大きく出て、
  報告書の「期初計画の利益」「期初目標の達成時の利益」と達成率がずれていた（杉原氏「正確なほうに修正しといて」）。

やること:
  - 店ごとに、期初目標で「12か月すべて 0円／未登録」かつ 上半期4〜8月の実績に金額がある科目だけを補う
  - 決済手数料（fees）は 売上 × 4〜8月実績の対売上比、それ以外は 4〜8月実績の月平均
  - 求人費・外注費・広告・賞与は補わない（計画に入れない科目）
  - 登録済みの値は一切変えない。補った行の notes に由来を書く

使い方:
  python scripts/fill_initial_target_gaps.py           # 試し実行
  python scripts/fill_initial_target_gaps.py --apply   # 書き込む
"""
import argparse
import json
import os
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
API_URL = os.environ["NICOLIO_API_URL"]
API_TOKEN = os.environ["NICOLIO_API_TOKEN"]
FY = 2026
BASE = [4, 5, 6, 7, 8]
YEAR = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]
RATE_ITEMS = {"fees"}
NOT_PLANNED = {"recruitment", "outsourcing", "advertising", "bonus", "discount", "cogs"}
EXCL = {"sales", "customers", "unit_price", "withholding_tax", "vat_purchase", "net_payable_tax", "other_expense",
        "total_expense", "net_profit", "profit_rate", "health_ins_total", "depreciation"}
PAY = ("cash_", "card_", "ic_", "gift_", "point_", "other_payment")
NOTE = "2026-10-15 補完: 期初目標で未登録だったため上半期4〜8月の実績から（fill_initial_target_gaps.py）"


def api(method, path, body=None):
    req = urllib.request.Request(f"{API_URL}/{urllib.parse.quote(path, safe='=&?,.*')}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        t = r.read().decode()
    return json.loads(t) if t else None


ITEMS = {i["id"]: i["item_code"] for i in api("GET", "beauty_item_master?select=id,item_code")}
ID_OF = {v: k for k, v in ITEMS.items()}


def month_vals(st, dt, m):
    d = defaultdict(float)
    for r in api("GET", f"beauty_monthly_data?fiscal_year=eq.{FY}&month=eq.{m}&data_type=eq.{dt}&store_id=eq.{st}&select=item_id,amount"):
        d[ITEMS[r["item_id"]]] += float(r["amount"])
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    plan = []
    for st, name in ((1, "寝屋川"), (2, "守口")):
        act = defaultdict(float)
        for m in BASE:
            for k, v in month_vals(st, "実績", m).items():
                act[k] += v
        init = {m: month_vals(st, "目標", m) for m in YEAR}
        gaps = [k for k, v in act.items()
                if k not in EXCL and not k.startswith(PAY) and k not in NOT_PLANNED and round(v / len(BASE)) != 0
                and all(init[m].get(k, 0) == 0 for m in YEAR)]
        print(f"=== {name}: 補う科目 {gaps}")
        add_h = {"上": 0.0, "下": 0.0}
        for m in YEAR:
            for k in gaps:
                amt = round(init[m]["sales"] * act[k] / act["sales"]) if k in RATE_ITEMS else round(act[k] / len(BASE))
                plan.append((st, m, k, amt, k in init[m]))
                add_h["上" if m in (4, 5, 6, 7, 8, 9) else "下"] += amt
        for h, v in add_h.items():
            print(f"  {h}半期に足す経費 {v / 1e4:.1f}万")
    if not a.apply:
        print("\n試し実行です。書き込むには --apply")
        return
    n = 0
    for st, m, k, amt, exists in plan:
        q = f"beauty_monthly_data?store_id=eq.{st}&fiscal_year=eq.{FY}&month=eq.{m}&data_type=eq.目標&item_id=eq.{ID_OF[k]}"
        if exists:  # 0円の行がある → 金額と備考を入れる
            api("PATCH", q, {"amount": str(amt), "notes": NOTE})
        else:
            api("POST", "beauty_monthly_data", {"store_id": st, "fiscal_year": FY, "month": m, "data_type": "目標",
                                                "item_id": ID_OF[k], "amount": str(amt), "notes": NOTE})
        n += 1
    print(f"書き込み完了: {n} 行")


if __name__ == "__main__":
    main()
