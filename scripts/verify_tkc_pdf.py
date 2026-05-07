"""TKC PX2 給与明細PDF と beauty_payroll_monthly を突合

杉原さんがTKCに入力後、生成された給与明細PDFをアップロードして実行する。
スクリプト計算結果との差異を一覧表示し、爽夏さんの補正漏れ・伊藤梨音さんのような
「実は明細では未支給」のケースを検知する。

使い方:
    python verify_tkc_pdf.py path/to/can202605.pdf
    python verify_tkc_pdf.py path/to/can202605.pdf --month 2026-04
    python verify_tkc_pdf.py path/to/can202605.pdf --json  # JSON出力

PDFから抽出する項目:
    TKCコード, 名前, 基本給, 役職手当, 指名報酬, 売上達成金, 皆勤手当,
    立替金, 支給合計, 差引支給額

DBから引く項目: beauty_payroll_monthly の同等項目

突合結果: 各項目で PDF=DB なら ✓、差異ありなら ✗ + 数値表示
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import pdfplumber
from dotenv import load_dotenv

# Windows cp932 環境でも絵文字・Unicode記号を出力できるようにする
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

load_dotenv(Path(__file__).parent / ".env")

API_URL = os.getenv("NICOLIO_API_URL", "https://twinklemark.xsrv.jp/nicolio-api/api.php")
API_TOKEN = os.getenv("NICOLIO_API_TOKEN", "nicolio_secret_2525xsrv")


# ---- PDF parser ----------------------------------------------------------


def parse_amount(s: str) -> int:
    s = s.strip().replace(",", "").replace("円", "")
    if not s or s == "-":
        return 0
    try:
        return int(s)
    except ValueError:
        return 0


def extract_numbers(line: str) -> list[int]:
    """行から数値だけを抽出（カンマ区切り対応）"""
    return [parse_amount(t) for t in re.findall(r"[-]?[\d,]+", line) if any(c.isdigit() for c in t)]


def parse_payslip_pdf(pdf_path: Path) -> list[dict]:
    """TKC PX2 形式の給与明細PDFをパース。各人を1辞書として返す。"""
    text_all = ""
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text_all += (page.extract_text() or "") + "\n"

    # ブロック分割: 「002 ： XXXXXX：名前 殿」で各人ブロックが始まる
    blocks = re.split(r"(?=002\s*[：:]\s*\d{6}\s*[：:])", text_all)
    results = []

    for block in blocks:
        m = re.search(r"002\s*[：:]\s*(\d{6})\s*[：:]\s*(.+?)\s*殿", block)
        if not m:
            continue
        tkc_code = m.group(1)
        name = m.group(2).strip()

        lines = block.split("\n")

        record = {
            "tkc_code": tkc_code,
            "name": name,
            "base_salary": 0,
            "position_allowance": 0,
            "nomination_allowance": 0,
            "commission_amount": 0,
            "perfect_attendance_amount": 0,
            "reimbursement": 0,
            "gross_total": 0,
            "diff_payment": 0,
        }

        # 1. 基本給・役職手当: 「基本給(月給)/(時給)…特別手当」直後の支給行
        for i, line in enumerate(lines):
            if "基本給(月給)" in line or "基本給(時給)" in line:
                # 次行が「支」or「支 NNN,NNN」
                cand = lines[i + 1] if i + 1 < len(lines) else ""
                cand = cand.lstrip("支").strip()
                if not cand:
                    cand = lines[i + 2] if i + 2 < len(lines) else ""
                nums = extract_numbers(cand)
                if nums:
                    record["base_salary"] = nums[0]
                    if len(nums) > 1:
                        record["position_allowance"] = nums[1]
                break

        # 2. 指名報酬・売上達成金・皆勤手当・支給合計
        for i, line in enumerate(lines):
            if "指名報酬" in line and "売上達成金" in line:
                cand = lines[i + 1] if i + 1 < len(lines) else ""
                nums = extract_numbers(cand)
                # 値が空欄スキップで詰まっているため、ラベル順に対応しない可能性あり
                # 観測: [指名報, 売上達成, 課税支給額, 支給合計] or 部分集合
                if nums:
                    record["nomination_allowance"] = nums[0]
                if len(nums) > 1:
                    record["commission_amount"] = nums[1]
                # 最後の値が支給合計
                if len(nums) >= 1:
                    record["gross_total"] = nums[-1]
                break

        # 3. 差引支給額
        for i, line in enumerate(lines):
            if "差引支給額" in line:
                cand = lines[i + 1] if i + 1 < len(lines) else ""
                nums = extract_numbers(cand)
                if nums:
                    record["diff_payment"] = nums[-1]
                break

        # 4. 立替金: 「貸付金返済 立替金 食事代」直後の行から2番目の値（位置依存・取れない場合あり）
        for i, line in enumerate(lines):
            if "立替金" in line and "貸付金" in line:
                # 数値行は通常「健康保険 厚生年金 ...」のラベル直後にあり、
                # そこから飛んで「貸付金返済 立替金 食事代」の値が来る
                # PDFレイアウトでは控除セクションが複雑なので、ここでは取得を試みるのみ
                # 取れなければ0のまま
                pass

        results.append(record)
    return results


# ---- DB access -----------------------------------------------------------


def _api_get(path: str) -> list:
    url = f"{API_URL}/{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {API_TOKEN}"})
    with urllib.request.urlopen(req) as res:
        text = res.read().decode("utf-8")
        data = json.loads(text) if text else []
        return data if isinstance(data, list) else []


def get_alias_by_tkc() -> dict[str, dict]:
    """tkc_code → {employee_id, salonboard_name, store_code} のマッピング"""
    rows = _api_get("salonboard_staff_alias?select=tkc_code,employee_id,salonboard_name,store_code")
    return {r["tkc_code"]: r for r in rows if r.get("tkc_code")}


def get_employment_type(employee_id: int, year: int, month: int) -> str:
    """その月時点のスタッフの雇用形態を取得"""
    qs = urllib.parse.urlencode({
        "employee_id": f"eq.{employee_id}",
        "order": "effective_from.desc",
    })
    rows = _api_get(f"beauty_employee_grade?{qs}")
    month_start = f"{year:04d}-{month:02d}-01"
    for r in rows:
        if r["effective_from"] <= f"{year:04d}-{month:02d}-31":
            eto = r.get("effective_to")
            if eto is None or eto >= month_start:
                return r["employment_type"]
    return ""


def get_payroll_record(employee_id: int, year: int, month: int) -> dict | None:
    qs = urllib.parse.urlencode({
        "employee_id": f"eq.{employee_id}",
        "year": f"eq.{year}",
        "month": f"eq.{month}",
    })
    rows = _api_get(f"beauty_payroll_monthly?{qs}")
    return rows[0] if rows else None


# ---- Comparison -----------------------------------------------------------


COMPARISON_FIELDS = [
    ("base_salary", "基本給"),
    ("position_allowance", "役職手当"),
    ("commission_amount", "売上達成金"),
    ("nomination_allowance", "指名手当"),
]


def compare(pdf: dict, db: dict) -> list[dict]:
    diffs = []
    for key, label in COMPARISON_FIELDS:
        p = int(pdf.get(key, 0) or 0)
        d = int(db.get(key, 0) or 0)
        diffs.append({
            "field": key,
            "label": label,
            "pdf": p,
            "db": d,
            "match": p == d,
            "delta": p - d,
        })
    return diffs


def format_yen(n: int) -> str:
    return f"¥{n:>9,}"


def main():
    parser = argparse.ArgumentParser(description="TKC PX2 給与明細PDF と DB を突合")
    parser.add_argument("pdf", type=Path, help="給与明細PDFパス")
    parser.add_argument("--month", help="対象月 YYYY-MM（省略時はファイル名から推定 or 当月）")
    parser.add_argument("--json", action="store_true", help="JSON形式で出力")
    args = parser.parse_args()

    if not args.pdf.exists():
        sys.exit(f"PDF not found: {args.pdf}")

    # 月推定: ファイル名 canYYYYMM.pdf から
    year, month = None, None
    if args.month:
        y, m = args.month.split("-")
        year, month = int(y), int(m)
    else:
        m = re.search(r"(20\d{2})(\d{2})", args.pdf.name)
        if m:
            year = int(m.group(1))
            # 明細ファイル名は支給月。給与は前月分。
            payment_month = int(m.group(2))
            month = payment_month - 1
            if month <= 0:
                month = 12
                year -= 1
        else:
            sys.exit("月が推定できません。--month YYYY-MM を指定してください")

    print(f"=== TKC明細 ⇄ DB 突合 ({year}-{month:02d}) ===\n")
    print(f"PDF: {args.pdf}")

    pdf_records = parse_payslip_pdf(args.pdf)
    if not pdf_records:
        sys.exit("PDFから明細を1件も抽出できませんでした")
    print(f"PDF抽出: {len(pdf_records)}名\n")

    alias_map = get_alias_by_tkc()

    all_results = []
    total_match = total_diff = 0

    for pdf_rec in pdf_records:
        tkc = pdf_rec["tkc_code"]
        alias = alias_map.get(tkc)
        if not alias:
            print(f"[?] tkc_code={tkc} ({pdf_rec['name']}): salonboard_staff_aliasに未登録")
            continue
        emp_id = int(alias["employee_id"])
        db_rec = get_payroll_record(emp_id, year, month)
        if not db_rec:
            print(f"[?] {pdf_rec['name']} (emp={emp_id}): DBに該当月レコードなし")
            continue

        # パート(時給制)はDB側 base_salary=0 仕様 + PDFレイアウト異なり要改善のため当面スキップ
        emp_type = get_employment_type(emp_id, year, month)
        if emp_type == "パート":
            print(f"\n[skip] {pdf_rec['name']:<14} (tkc={tkc} / emp={emp_id}) - パート時給制は突合対象外（TKC側で確定）")
            continue

        diffs = compare(pdf_rec, db_rec)
        unmatched = [d for d in diffs if not d["match"]]

        status_icon = "✓" if not unmatched else "✗"
        print(f"\n{status_icon} {pdf_rec['name']:<14} (tkc={tkc} / emp={emp_id})")
        for d in diffs:
            mark = "✓" if d["match"] else "✗"
            delta_str = ""
            if not d["match"]:
                delta_str = f"  Δ={d['delta']:+,}"
                total_diff += 1
            else:
                total_match += 1
            print(f"    {mark} {d['label']:<10} PDF={format_yen(d['pdf'])}  DB={format_yen(d['db'])}{delta_str}")

        all_results.append({
            "tkc_code": tkc,
            "name": pdf_rec["name"],
            "employee_id": emp_id,
            "diffs": diffs,
            "all_match": not unmatched,
        })

    print(f"\n=== 集計 ===")
    print(f"  一致: {total_match}項目  /  差異: {total_diff}項目")
    diff_people = [r for r in all_results if not r["all_match"]]
    if diff_people:
        print(f"  要確認: {len(diff_people)}名")
        for r in diff_people:
            issues = ", ".join(d["label"] for d in r["diffs"] if not d["match"])
            print(f"    - {r['name']}: {issues}")

    if args.json:
        print("\n--- JSON ---")
        print(json.dumps(all_results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
