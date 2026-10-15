"""下期修正（目標修正）と見通しの経費を全科目そろえて登録する。

背景（2026-10-15）:
  10/1 に下半期の目標を見直したとき、うりぼーに入れたのは 売上・人件費・仕入 の3科目だけで、
  報告した純利益（寝屋川 213.2万・守口 95.5万・部門計 308.7万＝約310万・賞与前）は
  報告書を作るスクリプトの中の前提（変動費率・固定費/月）から出していた。
  うりぼーの画面や報告セットから「期初／見通し／下期修正」を同じ形で並べられるよう、
  その前提を月別・科目別に展開して DB に入れる。

組み立て方（＝10/1確定の損益モデル。スタッフ版レポート hanki_fy2026.php の「損益構造と経費の前提」）:
  - 変動費（割引・仕入・決済手数料）= 売上 × 変動費率。割引と決済手数料は上半期4〜8月実績の対売上比、
    仕入は「変動費率 − 割引率 − 手数料率」（10/1 に登録済みの仕入の値と一致する）
  - 固定費の各科目 = 上半期4〜8月実績の月平均。求人費・外注費・広告は計画に入れない（発生時に実績計上）。賞与も入れない
  - 人件費（salary_total）= 10/1確定の固定費/月 − 減価償却6.4万 − ほかの固定費の合計（逆算）
      ＝ 賃金改定 +1.0万・寺西さん産休（寝屋川）を織り込んだ値になる
  - 見通し も同じ経費の前提で組む（売上だけが違う＝「何も変えなければ」との比較を売上の差だけにする）
  これで 純利益 = 売上 − 割引 − 経費 − 減価償却6.4万 が報告どおりになる（最後に検算する）。

使い方:
  python scripts/fill_revised_targets.py            # 試し実行（書き込まない・内訳と検算だけ表示）
  python scripts/fill_revised_targets.py --apply    # 書き込む（先に既存行を backup/ に保存）
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")
API_URL = os.environ["NICOLIO_API_URL"]
API_TOKEN = os.environ["NICOLIO_API_TOKEN"]

FY = 2026
H1_BASE = [4, 5, 6, 7, 8]          # 損益構造の算出に使った月（9月は賞与月のため外していた）
H2 = [10, 11, 12, 1, 2, 3]
DEPRECIATION = 6.4e4               # 減価償却/月・店（DBには持たず、利益計算で引く）
# 10/1 確定の損益モデル
MODEL = {
    1: dict(var=0.144, fixed={m: 165.4e4 for m in H2} | {10: 168.7e4, 3: 172.0e4}),   # 寝屋川
    2: dict(var=0.132, fixed={m: 142.5e4 for m in H2}),                                # 守口
}
EXPECT_PROFIT = {1: 213.2, 2: 95.5}  # 報告済みの下半期 純利益（万円）
VARIABLE = ["discount", "fees", "cogs"]
NOT_PLANNED = {"recruitment", "outsourcing", "advertising", "bonus"}
EXCL = {"sales", "customers", "unit_price", "withholding_tax", "vat_purchase", "net_payable_tax", "other_expense",
        "total_expense", "net_profit", "profit_rate", "health_ins_total", "depreciation"}
PAY = ("cash_", "card_", "ic_", "gift_", "point_", "other_payment")


def api(method, path, body=None):
    req = urllib.request.Request(f"{API_URL}/{urllib.parse.quote(path, safe='=&?,.*')}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        t = r.read().decode()
    return json.loads(t) if t else None


ITEMS = {i["id"]: i["item_code"] for i in api("GET", "beauty_item_master?select=*")}
ID_OF = {v: k for k, v in ITEMS.items()}


def rows(st, dt, m):
    return api("GET", f"beauty_monthly_data?fiscal_year=eq.{FY}&month=eq.{m}&data_type=eq.{dt}&store_id=eq.{st}&select=*")


def plan_store(st):
    act = defaultdict(float)
    for m in H1_BASE:
        for r in rows(st, "実績", m):
            act[ITEMS[r["item_id"]]] += float(r["amount"])
    sales_base = act["sales"]
    rate = {k: act[k] / sales_base for k in ("discount", "fees")}
    fixed_avg = {k: round(v / len(H1_BASE)) for k, v in act.items()
                 if k not in EXCL and not k.startswith(PAY) and k not in VARIABLE and k not in NOT_PLANNED
                 and k != "salary_total" and round(v / len(H1_BASE)) != 0}
    md = MODEL[st]
    plans = {}
    for dt in ("目標修正", "見通し"):
        for m in H2:
            cur = {ITEMS[r["item_id"]]: float(r["amount"]) for r in rows(st, dt, m)}
            sales = cur["sales"]
            disc, fees = round(sales * rate["discount"]), round(sales * rate["fees"])
            cogs = round(sales * md["var"]) - disc - fees
            salary = round(md["fixed"][m] - DEPRECIATION - sum(fixed_avg.values()))
            p = {"discount": disc, "fees": fees, "cogs": cogs, "salary_total": salary, **fixed_avg}
            plans[(dt, m)] = (sales, p, cur)
    return plans, rate, fixed_avg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    all_plans = {}
    for st, name in ((1, "寝屋川"), (2, "守口")):
        plans, rate, fixed_avg = plan_store(st)
        all_plans[st] = plans
        print(f"=== {name}  割引率 {rate['discount']*100:.2f}%  手数料率 {rate['fees']*100:.2f}%  "
              f"固定費（人件費以外・平均）{sum(fixed_avg.values())/1e4:.1f}万 / {len(fixed_avg)}科目")
        for dt in ("目標修正", "見通し"):
            tot = 0.0
            for m in H2:
                sales, p, cur = plans[(dt, m)]
                profit = sales - sum(p.values()) - DEPRECIATION
                tot += profit
                chg = [f"{k} {cur[k]/1e4:.1f}→{p[k]/1e4:.1f}" for k in ("salary_total", "cogs") if k in cur and abs(cur[k] - p[k]) >= 500]
                print(f"  {dt} {m:2d}月 売上 {sales/1e4:6.1f} 人件費 {p['salary_total']/1e4:6.1f} 純利益 {profit/1e4:6.1f}"
                      + (f"  変更: {', '.join(chg)}" if chg else ""))
            print(f"  {dt} 下半期の純利益 {tot/1e4:.1f}万" + (f"（報告値 {EXPECT_PROFIT[st]}）" if dt == "目標修正" else ""))
            if dt == "目標修正":
                assert abs(round(tot / 1e4, 1) - EXPECT_PROFIT[st]) <= 0.1, "報告値と合わない"
    if not a.apply:
        print("\n試し実行です。書き込むには --apply")
        return
    backup = {f"{st}-{dt}-{m}": cur for st, plans in all_plans.items() for (dt, m), (_, _, cur) in plans.items()}
    bdir = Path(__file__).parent / "backup"
    bdir.mkdir(exist_ok=True)
    bf = bdir / f"revised_targets_before_{datetime.now():%Y%m%d_%H%M%S}.json"
    bf.write_text(json.dumps(backup, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"既存行を保存: {bf}")
    n_ins = n_upd = 0
    for st, plans in all_plans.items():
        for (dt, m), (_, p, cur) in plans.items():
            for code, amt in p.items():
                q = (f"beauty_monthly_data?store_id=eq.{st}&fiscal_year=eq.{FY}&month=eq.{m}"
                     f"&data_type=eq.{dt}&item_id=eq.{ID_OF[code]}")
                if code in cur:
                    if abs(cur[code] - amt) >= 1:
                        api("PATCH", q, {"amount": str(amt)})
                        n_upd += 1
                else:
                    api("POST", "beauty_monthly_data", {"store_id": st, "fiscal_year": FY, "month": m, "data_type": dt,
                                                        "item_id": ID_OF[code], "amount": str(amt)})
                    n_ins += 1
    print(f"書き込み完了: 追加 {n_ins} 行 / 更新 {n_upd} 行")


if __name__ == "__main__":
    sys.exit(main())
