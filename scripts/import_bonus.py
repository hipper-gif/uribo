"""Nicolio 保管の TKC 賞与CSV(切出レイアウト0003) → うりぼー bonus 実績(店舗合計) を反映

賞与は TKC 仕訳帳からは入らない(6213は引当のみ・実支給は2126取崩で損益に出ない=facts F17)。
給与明細PDF(verify_tkc_pdf.py)も給与レイアウト専用。
一方 Nicolio の明細機能が TKC 切出CSV「0003 賞与全項目(Clio明細用)」を
~/twinklemark.xsrv.jp/private/payslips/ に保管している(nicolio ADR-0017/0018・DB保存なし)ので、
そこを読み口にする(規約8: 機械口=SSH+サーバー側実行。payslips/statements API は Bearer 不可)。

処理:
  1. SSH でサーバー上の Nicolio パーサ(TkcPayslipCsv.php)を呼び、最新の 0003 CSV から
     美容事業部(部署コード 002)の賞与行を JSON で受け取る
  2. 社員番号(7桁ゼロ埋め) → salonboard_staff_alias.tkc_code(先頭0なし) で employee_id/店舗 に解決
  3. 店舗合計を beauty_monthly_data(bonus=item_id 8, data_type=実績) へ UPSERT

反映月: 既定は支給日の前月(給与と同じ「前月分を翌月10日支給」の慣行)。
        2026-10-09 支給 → 2026年度 9月実績(杉原氏決定 2026-10-13「9月に反映」)。
        支給日が月末(居宅の 3/30・9/30 のような当月支給)なら --month で明示する。

使い方:
    python import_bonus.py                        # dry-run: 最新CSVの美容賞与を一覧(書き込まない)
    python import_bonus.py --pay-date 2026-10-09  # 支給日を指定(既定=美容行がある最新の支給日)
    python import_bonus.py --month 2026-09        # 反映月を明示
    python import_bonus.py --apply                # beauty_monthly_data に書き込む
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv(Path(__file__).parent / ".env")

API_URL = os.getenv("NICOLIO_API_URL", "https://twinklemark.xsrv.jp/nicolio-api/api.php")
API_TOKEN = os.getenv("NICOLIO_API_TOKEN", "nicolio_secret_2525xsrv")

SSH_HOST = "twinklemark@sv16114.xserver.jp"
SSH_PORT = "10022"
SSH_KEY = Path(os.path.expanduser("~/.ssh/id_xserver_panel"))
REMOTE_API_DIR = "~/twinklemark.xsrv.jp/public_html/nicolio-api"
REMOTE_PAYSLIP_GLOB = "$HOME/twinklemark.xsrv.jp/private/payslips/*0003*.csv"

BEAUTY_DEPT_CODE = "002"
BONUS_ITEM_ID = 8  # beauty_item_master.item_code='bonus'
STORE_NAME = {1: "寝屋川", 2: "守口"}
STORE_ID_BY_CODE = {"neyagawa": 1, "moriguchi": 2}

# サーバー側で実行する PHP。Nicolio のパーサをそのまま使う(再実装しない=TKCと1円も違わない)。
# 最新(ファイル名=アップロード日時が先頭)の 0003 CSV から美容事業部の賞与行だけを返す。
REMOTE_PHP = r'''
define("INCLUDED_FROM_API", true);
require "lib/TkcPayslipCsv.php";
$files = glob($_SERVER["HOME"]."/twinklemark.xsrv.jp/private/payslips/*0003*.csv");
if (!$files) { echo json_encode(["error" => "0003 賞与CSVがありません"]); exit; }
sort($files);
$f = end($files);
$c = \Nicolio\Payslip\TkcPayslipCsv::fromFile($f);
$rows = [];
foreach ($c->slips() as $s) {
  if (!$s["has_pay"] || $s["department_code"] !== "%DEPT%") continue;
  $rows[] = [
    "employee_code" => $s["employee_code"], "name" => $s["name"],
    "pay_date" => $s["pay_date"], "pay_month" => $s["pay_month"],
    "gross" => (int)$s["gross"], "net" => (int)$s["net"],
    "deduction_total" => (int)$s["deduction_total"],
  ];
}
echo json_encode(["file" => basename($f), "kind" => $c->kind(), "rows" => $rows], JSON_UNESCAPED_UNICODE);
'''.replace("%DEPT%", BEAUTY_DEPT_CODE)


def fetch_bonus_rows() -> dict:
    if not SSH_KEY.exists():
        sys.exit(f"SSH鍵が見つかりません: {SSH_KEY}")
    # PHP を stdin から渡す(クォート地獄を避ける)
    cmd = ["ssh", "-p", SSH_PORT, "-i", str(SSH_KEY),
           "-o", "ConnectTimeout=30", "-o", "StrictHostKeyChecking=no",
           SSH_HOST, f"cd {REMOTE_API_DIR} && php"]
    r = subprocess.run(cmd, input="<?php\n" + REMOTE_PHP, capture_output=True, text=True,
                       encoding="utf-8", timeout=120)
    if r.returncode != 0:
        sys.exit(f"SSH/PHP 失敗 (rc={r.returncode}): {r.stderr.strip()[:500]}")
    try:
        data = json.loads(r.stdout)
    except json.JSONDecodeError:
        sys.exit(f"サーバー出力をJSONとして読めません: {r.stdout[:500]}")
    if "error" in data:
        sys.exit(data["error"])
    return data


def _api_get(path: str) -> list:
    req = urllib.request.Request(f"{API_URL}/{path}", headers={"Authorization": f"Bearer {API_TOKEN}"})
    with urllib.request.urlopen(req) as res:
        text = res.read().decode("utf-8")
    data = json.loads(text) if text else []
    return data if isinstance(data, list) else []


def _api_send(method: str, path: str, body: dict) -> None:
    req = urllib.request.Request(
        f"{API_URL}/{path}", data=json.dumps(body).encode(), method=method,
        headers={"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"})
    urllib.request.urlopen(req).read()


def get_alias_by_tkc() -> dict[str, dict]:
    rows = _api_get("salonboard_staff_alias?select=tkc_code,employee_id,salonboard_name,store_code")
    return {r["tkc_code"]: r for r in rows if r.get("tkc_code")}


def fiscal_year_for(year: int, month: int) -> int:
    return year if month >= 4 else year - 1


def default_target_month(pay_date: date) -> tuple[int, int]:
    """支給日の前月(給与と同じ慣行)。"""
    y, m = pay_date.year, pay_date.month - 1
    if m == 0:
        y, m = y - 1, 12
    return y, m


def upsert_bonus(store_id: int, fiscal_year: int, month: int, amount: int) -> str:
    qs = urllib.parse.urlencode({
        "store_id": f"eq.{store_id}", "fiscal_year": f"eq.{fiscal_year}", "month": f"eq.{month}",
        "data_type": "eq.実績", "item_id": f"eq.{BONUS_ITEM_ID}",
    })
    existing = _api_get(f"beauty_monthly_data?{qs}")
    if existing:
        _api_send("PATCH", f"beauty_monthly_data?{qs}", {"amount": str(amount)})
        return f"updated (旧値 {float(existing[0]['amount']):,.0f})"
    _api_send("POST", "beauty_monthly_data", {
        "store_id": store_id, "fiscal_year": fiscal_year, "month": month,
        "data_type": "実績", "item_id": BONUS_ITEM_ID, "amount": str(amount),
    })
    return "inserted"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pay-date", help="支給日 YYYY-MM-DD(既定=美容行がある最新の支給日)")
    ap.add_argument("--month", help="反映する給与月 YYYY-MM(既定=支給日の前月)")
    ap.add_argument("--apply", action="store_true", help="beauty_monthly_data に書き込む(既定は dry-run)")
    ap.add_argument("--json", action="store_true", help="明細を JSON で出力")
    args = ap.parse_args()

    data = fetch_bonus_rows()
    rows = data["rows"]
    print(f"📄 Nicolio 保管CSV: {data['file']} (kind={data['kind']}) 美容事業部の賞与行 {len(rows)}件")
    if not rows:
        sys.exit("美容事業部の賞与行がありません")

    pay_dates = sorted({r["pay_date"] for r in rows})
    pay_date_s = args.pay_date or pay_dates[-1]
    if pay_date_s not in pay_dates:
        sys.exit(f"支給日 {pay_date_s} の美容行がありません。あるのは: {', '.join(pay_dates)}")
    rows = [r for r in rows if r["pay_date"] == pay_date_s]
    pay_date = date.fromisoformat(pay_date_s)

    if args.month:
        y, m = (int(x) for x in args.month.split("-"))
    else:
        y, m = default_target_month(pay_date)
    fy = fiscal_year_for(y, m)
    print(f"📅 支給日 {pay_date_s} (CSV上の支給月分: {rows[0]['pay_month']}) → 反映先 {y}年{m}月 (FY{fy}) bonus 実績"
          f"{'' if args.month else ' [既定=支給日の前月]'}")
    if pay_date.day >= 25 and not args.month:
        print("  ⚠ 月末支給です。当月分の可能性があるので --month で反映月を明示してください")

    alias = get_alias_by_tkc()
    by_store: dict[int, int] = {}
    unresolved: list[dict] = []
    print()
    print(f"  {'社員番号':<9}{'氏名':<12}{'店舗':<6}{'賞与':>10}{'差引支給':>10}")
    for r in rows:
        code = r["employee_code"].lstrip("0")
        a = alias.get(code)
        if not a:
            unresolved.append(r)
            print(f"  {r['employee_code']:<9}{r['name']:<12}{'?? 未解決':<6}{r['gross']:>10,}{r['net']:>10,}")
            continue
        store_id = STORE_ID_BY_CODE.get(a["store_code"])
        if store_id is None:
            unresolved.append(r)
            print(f"  {r['employee_code']:<9}{r['name']:<12}{'?? ' + a['store_code']:<6}{r['gross']:>10,}{r['net']:>10,}")
            continue
        by_store[store_id] = by_store.get(store_id, 0) + r["gross"]
        print(f"  {r['employee_code']:<9}{r['name']:<12}{STORE_NAME[store_id]:<6}{r['gross']:>10,}{r['net']:>10,}")

    print()
    for sid in sorted(by_store):
        print(f"  {STORE_NAME[sid]} 合計 {by_store[sid]:>10,}")
    print(f"  全体   合計 {sum(by_store.values()):>10,}")

    if args.json:
        print(json.dumps({"pay_date": pay_date_s, "target": {"fiscal_year": fy, "month": m},
                          "rows": rows, "by_store": by_store}, ensure_ascii=False, indent=2))

    if unresolved:
        sys.exit(f"\n❌ 店舗に解決できない社員が {len(unresolved)}名。salonboard_staff_alias に tkc_code を登録してから再実行")

    if not args.apply:
        print("\n(dry-run: 書き込んでいません。反映するには --apply)")
        return

    print()
    for sid in sorted(by_store):
        res = upsert_bonus(sid, fy, m, by_store[sid])
        print(f"  ✅ {STORE_NAME[sid]} FY{fy}/{m}月 bonus 実績 = {by_store[sid]:,} → {res}")


if __name__ == "__main__":
    main()
