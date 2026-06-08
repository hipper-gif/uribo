"""美容部スタッフの「現在の基本給」を うりぼう → Mneme へ同期する。

正本設計 (2026-06-08 確定):
  - 個人のランク割当・override・履歴の正本 = うりぼう beauty_employee_grade (+ beauty_salary_grade)
  - Mneme employees.base_salary / salary_type / employment_type は
    それを映す「派生スナップショット」。SmileyBase 等の他システムが読む用。
  - 同期方向は うりぼう → Mneme の一方向のみ。逆向き(Mnemeへ直接入力)はしない。

このスクリプトが計算する各人の値:
  - employment_type: beauty_employee_grade の雇用形態 (Mneme表記へ変換: パート→パート・アルバイト)
  - salary_type:     パート→時給 / それ以外→月給
  - base_salary:     beauty_salary_grade マスタ額(雇用形態×ランク) + base_salary_override

使い方:
    python sync_grades_to_mneme.py            # プレビュー(差分表示のみ・無変更)
    python sync_grades_to_mneme.py --apply    # Mneme employees に PATCH

注意:
    employee_id は Mneme employees.id と同一(うりぼう DDL の規約)。
    Mneme にいるが うりぼう にランク割当が無い美容部員(例: 杉原爽夏/今道寿子)は
    算出不能のためスキップし警告する。
"""
import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date

try:  # Windows コンソール(cp932)でも記号を出せるよう UTF-8 に固定
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

NIC_URL = os.getenv("NICOLIO_API_URL", "https://twinklemark.xsrv.jp/nicolio-api/api.php")
NIC_TOKEN = os.getenv("NICOLIO_API_TOKEN", "nicolio_secret_2525xsrv")
MNE_URL = os.getenv("MNEME_API_URL", "https://twinklemark.xsrv.jp/mneme-api/index.php")
MNE_TOKEN = os.getenv("MNEME_API_TOKEN", "mneme_secret_2525xsrv")

# うりぼう雇用形態 → Mneme employees.employment_type 表記
# ★Mneme employees.employment_type は ENUM('正社員','契約社員','パート','登録ヘルパー')。
#   ENUM外の値をPATCHすると MySQL が silent に空文字保存する事故になるため、
#   この ENUM に存在する値だけにマップすること (2026-06-08 事故: 有期雇用/パート・アルバイトで空保存)。
#   ※ Mneme salary_grades 側は 'パート・アルバイト'/'有期雇用' 表記だが employees の ENUM とは別物。
ETYPE_TO_MNEME = {
    "パート": "パート",
    "有期雇用": "契約社員",   # 有期雇用契約 = 契約社員
    "正社員": "正社員",
}

# Mneme employees の ENUM 許可値 (twinklemark_employee.employees)
MNEME_EMPLOYMENT_ENUM = {"正社員", "契約社員", "パート", "登録ヘルパー"}
MNEME_SALARY_ENUM = {"月給", "日給月給", "時給"}


def _get(base: str, token: str, path: str) -> list:
    req = urllib.request.Request(f"{base}/{path}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as res:
        text = res.read().decode("utf-8")
        data = json.loads(text) if text else []
        return data if isinstance(data, list) else []


def _patch(base: str, token: str, path: str, body: dict) -> None:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{base}/{path}", data=data, method="PATCH",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    urllib.request.urlopen(req).read()


def active_record(rows: list, today: str, **match) -> dict | None:
    """effective_from/effective_to で today 時点に有効な最初のレコードを返す。
    rows は effective_from 降順前提。"""
    for r in rows:
        if any(r.get(k) != v for k, v in match.items()):
            continue
        if r["effective_from"] <= today and (r.get("effective_to") is None or r["effective_to"] >= today):
            return r
    return None


def salary_type_for(uribo_etype: str) -> str:
    return "時給" if uribo_etype == "パート" else "月給"


def build_targets() -> tuple[list[dict], list[dict]]:
    """(変更/確認対象, スキップ=ランク未割当のMneme美容部員) を返す。"""
    today = date.today().isoformat()

    grades = _get(NIC_URL, NIC_TOKEN, "beauty_employee_grade?order=effective_from.desc")
    master = _get(NIC_URL, NIC_TOKEN, "beauty_salary_grade?order=effective_from.desc")

    emps = _get(MNE_URL, MNE_TOKEN, "employees?" + urllib.parse.urlencode({
        "or": "(primary_department.eq.美容,departments.cs.{美容})",
        "is_active": "eq.1",
        "select": "id,name,employment_type,salary_type,base_salary,job_title",
    }))
    empmap = {e["id"]: e for e in emps}

    # employee_id ごとの active grade
    active_by_emp: dict[int, dict] = {}
    for g in grades:
        eid = g["employee_id"]
        if eid in active_by_emp:
            continue
        if g["effective_from"] <= today and (g.get("effective_to") is None or g["effective_to"] >= today):
            active_by_emp[eid] = g

    def master_amount(etype: str, grade: str) -> int | None:
        rec = active_record(master, today, employment_type=etype, grade=grade)
        return int(rec["base_amount"]) if rec else None

    targets = []
    for eid, g in sorted(active_by_emp.items()):
        emp = empmap.get(eid)
        if not emp:
            continue  # うりぼうにランクはあるがMneme美容部に該当なし(配置替え等)
        uribo_etype = g["employment_type"]
        amt = master_amount(uribo_etype, g["grade"])
        if amt is None:
            continue
        override = int(g.get("base_salary_override") or 0)
        target = {
            "id": eid,
            "name": emp["name"],
            "employment_type": ETYPE_TO_MNEME.get(uribo_etype, uribo_etype),
            "salary_type": salary_type_for(uribo_etype),
            "base_salary": amt + override,
            "_grade": f"{uribo_etype}{g['grade']}",
            "_override": override,
            "_current": emp,
        }
        targets.append(target)

    skipped = [e for e in emps if e["id"] not in active_by_emp]
    return targets, skipped


def changed_fields(target: dict) -> tuple[dict, list[str]]:
    """(PATCHすべき差分, ENUM外で除外した警告) を返す。"""
    cur = target["_current"]
    out, warns = {}, []
    for f in ("employment_type", "salary_type", "base_salary"):
        cv = cur.get(f)
        if f == "base_salary" and cv is not None:
            cv = int(cv)
        if cv == target[f]:
            continue
        # ENUM ガード: 許可外の値は書かない(silent空保存を防ぐ)
        if f == "employment_type" and target[f] not in MNEME_EMPLOYMENT_ENUM:
            warns.append(f"employment_type='{target[f]}' はENUM外({MNEME_EMPLOYMENT_ENUM}) → 書込除外")
            continue
        if f == "salary_type" and target[f] not in MNEME_SALARY_ENUM:
            warns.append(f"salary_type='{target[f]}' はENUM外({MNEME_SALARY_ENUM}) → 書込除外")
            continue
        out[f] = target[f]
    return out, warns


def main():
    ap = argparse.ArgumentParser(description="美容部の基本給を うりぼう → Mneme へ同期")
    ap.add_argument("--apply", action="store_true", help="Mneme employees に PATCH 実行(既定はプレビュー)")
    args = ap.parse_args()

    targets, skipped = build_targets()

    print(f"=== うりぼう → Mneme 基本給同期 ({'APPLY' if args.apply else 'プレビュー'}) ===\n")
    n_change = n_ok = n_warn = 0
    for t in targets:
        diff, warns = changed_fields(t)
        cur = t["_current"]
        cur_s = f"{cur.get('salary_type') or '-'}/{cur.get('employment_type') or '-'}/" \
                f"{'空' if cur.get('base_salary') is None else format(int(cur['base_salary']), ',')}"
        tgt_s = f"{t['salary_type']}/{t['employment_type']}/{t['base_salary']:,}"
        if not diff and not warns:
            n_ok += 1
            print(f"  ○ {t['name']:<12} {tgt_s}  ({t['_grade']}) — 変更なし")
            continue
        if diff:
            n_change += 1
            print(f"  ✎ {t['name']:<12} {cur_s}  →  {tgt_s}  ({t['_grade']}+{t['_override']})")
            print(f"      更新: {', '.join(f'{k}={v}' for k, v in diff.items())}")
        for w in warns:
            n_warn += 1
            print(f"  ⚠ {t['name']:<12} {w}")
        if args.apply and diff:
            try:
                _patch(MNE_URL, MNE_TOKEN, f"employees?id=eq.{t['id']}", diff)
                print(f"      ✅ PATCH成功")
            except Exception as e:
                print(f"      ❌ PATCH失敗: {e}")

    if skipped:
        print(f"\n  [skip] うりぼうにランク割当が無いMneme美容部員 ({len(skipped)}名):")
        for e in skipped:
            print(f"      {e['id']:>4} {e['name']}  役職:{e.get('job_title') or '-'}")

    warn_s = f" / ⚠ENUM外除外{n_warn}件" if n_warn else ""
    print(f"\n=== {'反映' if args.apply else 'プレビュー'}: 変更{n_change}名 / 変更なし{n_ok}名 / スキップ{len(skipped)}名{warn_s} ===")
    if not args.apply and n_change:
        print("  → 反映するには  python sync_grades_to_mneme.py --apply")


if __name__ == "__main__":
    main()
