"""TKC PX2 給与明細PDF と beauty_payroll_monthly を突合 / DB反映

杉原さんがTKCに入力後、生成された給与明細PDFをアップロードして実行する。
スクリプト計算結果との差異を一覧表示し、爽夏さんの補正漏れ等を検知する。

--apply オプション: 突合後、PDFの値を beauty_payroll_monthly に反映 +
店舗別の人件費合計・法定福利費を beauty_monthly_data に UPSERT (uribo月次入力)。

使い方:
    python verify_tkc_pdf.py path/to/can202605.pdf
    python verify_tkc_pdf.py path/to/can202605.pdf --month 2026-04
    python verify_tkc_pdf.py path/to/can202605.pdf --apply  # DBに反映
    python verify_tkc_pdf.py path/to/can202605.pdf --json   # JSON出力

PDFから抽出する項目:
    TKCコード, 名前, 基本給, 役職手当, 指名報酬, 売上達成金,
    支給合計(gross_total), 差引支給額(net_payment),
    社会保険料合計(social_insurance_total), 所得税, 住民税

--apply 時のDB反映:
    beauty_payroll_monthly: gross_total, net_payment, social_insurance_total,
        income_tax, resident_tax, tkc_pdf_filename, tkc_verified_at, status='tkc_entered'
    beauty_monthly_data: 店舗別合計を 人件費(item_id=6) / 法定福利費(item_id=11) に UPSERT
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime
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
    """TKC PX2 形式の給与明細PDFをパース (座標ベース)。各人を1辞書として返す。"""
    return _parse_by_coords(pdf_path)


# X座標範囲(各セクションのラベル位置から決定)
_X_RANGES = {
    "col1": (50, 90),    # 基本給 / 指名報酬 / 健康保険
    "col2": (90, 145),   # 役職手当 / 売上達成金 / 厚生年金
    "col3": (145, 185),  # 職務手当 / 皆勤手当 / 雇用保険
    "col4": (185, 230),  # 技術手当 / 時間外手当 / 社会保険料合計
    "col5": (230, 280),  # 介護報酬 / 課税対象額
    "col6": (280, 325),  # 特定処遇改善 / 所得税
    "col7": (325, 380),  # 処遇改善加算 / 住民税
    "col8": (380, 420),  # ﾍﾞｰｽｱｯﾌﾟ加算 / 課税支給額 / 貸付金返済
    "col9": (420, 470),  # 固定残業手当 / 立替金
    "col10": (470, 510), # 特別手当 / 食事代
    "col_total": (515, 560),  # 支給合計 / 差引支給額
}


def _in_range(x: float, key: str) -> bool:
    lo, hi = _X_RANGES[key]
    return lo <= x < hi


def _parse_by_coords(pdf_path: Path) -> list[dict]:
    with pdfplumber.open(str(pdf_path)) as pdf:
        all_words = []
        for page in pdf.pages:
            all_words.extend(page.extract_words(use_text_flow=False))

    # ブロック分割: 「002」アンカー + 「(数字6桁)：(名前)」パターン
    block_starts = []
    for i, w in enumerate(all_words):
        if w["text"] != "002":
            continue
        for j in range(i, min(i + 5, len(all_words))):
            m = re.match(r"^(\d{6})[:：](.+)?", all_words[j]["text"])
            if m:
                name_part = (m.group(2) or "").strip()
                # 次の word が名前続きの可能性
                if j + 1 < len(all_words):
                    nxt = all_words[j + 1]["text"]
                    if nxt not in ("殿", "税額表", "扶養等"):
                        name_part = (name_part + " " + nxt).strip()
                name_part = name_part.replace("殿", "").strip()
                block_starts.append((i, m.group(1), name_part))
                break

    def find_y(words, label: str) -> float | None:
        for w in words:
            if w["text"] == label:
                return w["top"]
        return None

    def values_at(words, label_y: float | None, dy_max: float = 20) -> list[tuple[float, int]]:
        if label_y is None:
            return []
        out = []
        for w in words:
            if label_y < w["top"] < label_y + dy_max:
                if re.match(r"^[-]?[\d,]+$", w["text"]):
                    x = (w["x0"] + w["x1"]) / 2
                    out.append((x, parse_amount(w["text"])))
        return out

    results = []
    for k, (start_idx, tkc, name) in enumerate(block_starts):
        end_idx = block_starts[k + 1][0] if k + 1 < len(block_starts) else len(all_words)
        bw = all_words[start_idx:end_idx]

        rec = {
            "tkc_code": tkc, "name": name,
            "base_salary": 0, "position_allowance": 0,
            "nomination_allowance": 0, "commission_amount": 0,
            "perfect_attendance_amount": 0,
            "gross_total": 0, "net_payment": 0,
            "social_insurance_total": 0, "income_tax": 0, "resident_tax": 0,
            "reimbursement": 0,
        }

        # 1. 基本給・役職手当
        # 注: TKC PDFテンプレートでは役職手当の値は col3 位置に表示される
        # (ラベルは col2 だが、値は col3 にずれて表示される仕様)
        base_y = find_y(bw, "基本給(月給)") or find_y(bw, "基本給(時給)")
        for x, v in values_at(bw, base_y):
            if _in_range(x, "col1"):
                rec["base_salary"] = v
            elif _in_range(x, "col3"):
                rec["position_allowance"] = v

        # 2. 支給セクション (指名報酬・売上達成金・皆勤手当・支給合計)
        nom_y = find_y(bw, "指名報酬")
        for x, v in values_at(bw, nom_y):
            if _in_range(x, "col1"):
                rec["nomination_allowance"] = v
            elif _in_range(x, "col2"):
                rec["commission_amount"] = v
            elif _in_range(x, "col3"):
                rec["perfect_attendance_amount"] = v
            elif _in_range(x, "col_total"):
                rec["gross_total"] = v

        # 3. 控除セクション (社会保険料合計・所得税・住民税・立替金)
        # 「健康保険」ラベル行の下に「控」記号行を挟んで値行が来るため dy_max=30
        health_y = find_y(bw, "健康保険")
        for x, v in values_at(bw, health_y, dy_max=30):
            if _in_range(x, "col4"):
                rec["social_insurance_total"] = v
            elif _in_range(x, "col6"):
                rec["income_tax"] = v
            elif _in_range(x, "col7"):
                rec["resident_tax"] = v
            elif _in_range(x, "col9"):
                rec["reimbursement"] = v

        # 4. 差引支給額
        net_y = find_y(bw, "差引支給額")
        for x, v in values_at(bw, net_y):
            if _in_range(x, "col_total"):
                rec["net_payment"] = v

        results.append(rec)
    return results


def _parse_text_legacy(pdf_path: Path) -> list[dict]:
    """旧テキストベース実装(参照用、未使用)。"""
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
            "net_payment": 0,
            "social_insurance_total": 0,
            "income_tax": 0,
            "resident_tax": 0,
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
                    record["net_payment"] = nums[-1]
                break

        # 5. 社会保険料合計・所得税・住民税
        # ラベル: 「健康保険 厚生年金 雇用保険 社会保険料合計 課税対象額 所 得 税 住 民 税 ...」
        # 値: [健保, 厚年, 雇用, 社保合計, 課税対象額, 所得税, 住民税, ...]
        # PDF構造: 「健康保険…食事代」行 → 「控」記号行 → 値行 のため数値含む行を探す
        for i, line in enumerate(lines):
            if "健康保険" in line and "厚生年金" in line and "雇用保険" in line:
                for j in range(i + 1, min(i + 5, len(lines))):
                    cand = lines[j]
                    nums = extract_numbers(cand)
                    if len(nums) >= 3:
                        if len(nums) >= 4:
                            record["social_insurance_total"] = nums[3]
                        if len(nums) >= 6:
                            record["income_tax"] = nums[5]
                        if len(nums) >= 7:
                            record["resident_tax"] = nums[6]
                        break
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
    grade = get_active_grade_record(employee_id, year, month)
    return grade["employment_type"] if grade else ""


def get_active_grade_record(employee_id: int, year: int, month: int) -> dict | None:
    """その月時点で active な beauty_employee_grade レコードを返す"""
    qs = urllib.parse.urlencode({
        "employee_id": f"eq.{employee_id}",
        "order": "effective_from.desc",
    })
    rows = _api_get(f"beauty_employee_grade?{qs}")
    month_start = f"{year:04d}-{month:02d}-01"
    month_end = f"{year:04d}-{month:02d}-31"
    for r in rows:
        if r["effective_from"] <= month_end:
            eto = r.get("effective_to")
            if eto is None or eto >= month_start:
                return r
    return None


def get_grade_master_amount(employment_type: str, grade: str, year: int, month: int) -> int:
    """beauty_salary_grade マスタからその月時点の base_amount を取得"""
    qs = urllib.parse.urlencode({
        "employment_type": f"eq.{employment_type}",
        "grade": f"eq.{grade}",
        "order": "effective_from.desc",
    })
    rows = _api_get(f"beauty_salary_grade?{qs}")
    month_start = f"{year:04d}-{month:02d}-01"
    month_end = f"{year:04d}-{month:02d}-31"
    for r in rows:
        if r["effective_from"] <= month_end:
            eto = r.get("effective_to")
            if eto is None or eto >= month_start:
                return int(r.get("base_amount") or 0)
    return 0


def check_contract_drift(emp_id: int, year: int, month: int, pdf_base_salary: int) -> dict | None:
    """契約ドリフト検知: TKC PDFの基本給 vs DB(マスタ+override)を比較

    ズレがあれば { master, override, db_total, pdf_actual, diff, suggested_override } を返す。
    用途: 契約書とDBの不整合・override設定漏れの早期検知
    """
    grade = get_active_grade_record(emp_id, year, month)
    if grade is None:
        return None
    if grade["employment_type"] == "パート":
        return None  # パートはTKC側で時給×時間決定なので対象外
    master = get_grade_master_amount(grade["employment_type"], grade["grade"], year, month)
    db_override = int(grade.get("base_salary_override") or 0)
    db_total = master + db_override
    if db_total == pdf_base_salary:
        return None
    return {
        "master": master,
        "db_override": db_override,
        "db_total": db_total,
        "pdf_actual": pdf_base_salary,
        "diff": pdf_base_salary - db_total,
        "suggested_override": pdf_base_salary - master,
        "employment_type": grade["employment_type"],
        "grade": grade["grade"],
        "grade_id": grade["id"],
    }


def get_payroll_record(employee_id: int, year: int, month: int) -> dict | None:
    qs = urllib.parse.urlencode({
        "employee_id": f"eq.{employee_id}",
        "year": f"eq.{year}",
        "month": f"eq.{month}",
    })
    rows = _api_get(f"beauty_payroll_monthly?{qs}")
    return rows[0] if rows else None


def _api_send(method: str, path: str, body: dict) -> None:
    url = f"{API_URL}/{path}"
    data = json.dumps(body).encode()
    headers = {"Authorization": f"Bearer {API_TOKEN}", "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    urllib.request.urlopen(req).read()


def fiscal_year_for(year: int, month: int) -> int:
    return year if month >= 4 else year - 1


def upsert_monthly_data(store_id: int, fiscal_year: int, month: int, item_id: int, amount: int) -> str:
    qs = urllib.parse.urlencode({
        "store_id": f"eq.{store_id}",
        "fiscal_year": f"eq.{fiscal_year}",
        "month": f"eq.{month}",
        "data_type": "eq.実績",
        "item_id": f"eq.{item_id}",
    })
    existing = _api_get(f"beauty_monthly_data?{qs}")
    body: dict = {"amount": str(amount)}
    if existing:
        _api_send("PATCH", f"beauty_monthly_data?{qs}", body)
        return "updated"
    body.update({
        "store_id": store_id,
        "fiscal_year": fiscal_year,
        "month": month,
        "data_type": "実績",
        "item_id": item_id,
    })
    _api_send("POST", "beauty_monthly_data", body)
    return "inserted"


def upload_pdf_to_server(local_pdf: Path, year: int, month: int) -> bool:
    """PDFをサーバの非公開ディレクトリに scp。爽夏さんがUriboから開けるように。"""
    ssh_key = Path(os.path.expanduser("~/.ssh/id_xserver_panel"))
    if not ssh_key.exists():
        print(f"  [warn] SSH鍵が見つかりません: {ssh_key} - PDFアップロードをスキップ")
        return False
    if not shutil.which("scp"):
        print("  [warn] scp コマンドが見つかりません - PDFアップロードをスキップ")
        return False
    remote_name = f"{year:04d}-{month:02d}.pdf"
    remote = f"twinklemark@sv16114.xserver.jp:~/twinklemark.xsrv.jp/private/payroll_pdfs/{remote_name}"
    cmd = ["scp", "-P", "10022", "-i", str(ssh_key), str(local_pdf), remote]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            print(f"  ✓ PDFアップロード成功: private/payroll_pdfs/{remote_name}")
            return True
        else:
            print(f"  [warn] PDFアップロード失敗 (rc={r.returncode}): {r.stderr[:200]}")
            return False
    except Exception as e:
        print(f"  [warn] PDFアップロード例外: {e}")
        return False


def apply_to_db(year: int, month: int, pdf_records: list[dict],
                alias_map: dict[str, dict], pdf_filename: str,
                pdf_path: Path | None = None) -> None:
    """PDFの値を beauty_payroll_monthly + beauty_monthly_data に反映"""
    print("\n=== DB反映 (--apply) ===")
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # store_code → store_id (1=寝屋川, 2=守口)
    STORE_MAP = {"neyagawa": 1, "moriguchi": 2}
    by_store: dict[int, dict] = {1: {"salary": 0, "welfare": 0}, 2: {"salary": 0, "welfare": 0}}

    for pdf in pdf_records:
        alias = alias_map.get(pdf["tkc_code"])
        if not alias:
            print(f"  [skip] tkc_code={pdf['tkc_code']} ({pdf['name']}): 未登録")
            continue
        emp_id = int(alias["employee_id"])
        store_id = STORE_MAP.get(alias["store_code"], 0)

        body = {
            "gross_total": pdf.get("gross_total", 0),
            "net_payment": pdf.get("net_payment", 0),
            "social_insurance_total": pdf.get("social_insurance_total", 0),
            "income_tax": pdf.get("income_tax", 0),
            "resident_tax": pdf.get("resident_tax", 0),
            "tkc_pdf_filename": pdf_filename,
            "tkc_verified_at": now_str,
            "status": "tkc_entered",
        }
        qs = urllib.parse.urlencode({
            "employee_id": f"eq.{emp_id}",
            "year": f"eq.{year}",
            "month": f"eq.{month}",
        })
        try:
            _api_send("PATCH", f"beauty_payroll_monthly?{qs}", body)
            print(
                f"  ✓ {pdf['name']:<14} gross=¥{pdf['gross_total']:>9,} "
                f"net=¥{pdf['net_payment']:>9,} 社保=¥{pdf['social_insurance_total']:>7,} "
                f"所得税=¥{pdf['income_tax']:>5,} 住民税=¥{pdf['resident_tax']:>5,}"
            )
        except Exception as e:
            print(f"  ✗ {pdf['name']}: PATCH失敗 {e}")
            continue

        # 店舗別集計
        if store_id in by_store:
            by_store[store_id]["salary"] += pdf.get("gross_total", 0)
            by_store[store_id]["welfare"] += pdf.get("social_insurance_total", 0)

    # 店舗別合計を beauty_monthly_data へ UPSERT
    print("\n=== 月次入力反映 (beauty_monthly_data) ===")
    print("    [前提] 法定福利費は労使折半の概算で社会保険料合計×2 とする")
    fy = fiscal_year_for(year, month)
    STORE_LABEL = {1: "寝屋川店", 2: "守口店"}
    for store_id, vals in by_store.items():
        salary = vals["salary"]
        welfare = vals["welfare"] * 2  # 労使折半概算
        if salary == 0 and welfare == 0:
            continue
        a1 = upsert_monthly_data(store_id, fy, month, 6, salary)
        a2 = upsert_monthly_data(store_id, fy, month, 11, welfare)
        print(f"  {STORE_LABEL[store_id]}: 人件費=¥{salary:,} ({a1}) / 法定福利費=¥{welfare:,} ({a2})")

    # PDFをサーバーの非公開ディレクトリにアップロード (爽夏さんがUriboで参照できるように)
    if pdf_path is not None:
        print("\n=== PDFサーバーアップロード ===")
        upload_pdf_to_server(pdf_path, year, month)


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
    parser.add_argument("--apply", action="store_true",
        help="突合後、PDF値を beauty_payroll_monthly に反映 + 店舗別合計を beauty_monthly_data (人件費/法定福利費) に投入")
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

    # ===== 契約ドリフト検知 =====
    print(f"\n=== 契約ドリフト検知 (DB grade × master vs PDF実額) ===")
    drift_count = 0
    for pdf_rec in pdf_records:
        alias = alias_map.get(pdf_rec["tkc_code"])
        if not alias:
            continue
        emp_id = int(alias["employee_id"])
        drift = check_contract_drift(emp_id, year, month, pdf_rec.get("base_salary", 0))
        if drift is None:
            continue
        drift_count += 1
        print(f"  ⚠ {pdf_rec['name']:<14} ({drift['employment_type']}{drift['grade']}ランク)")
        print(f"      マスタ値: ¥{drift['master']:,}  +  DB override: ¥{drift['db_override']:>+,}  =  DB合計: ¥{drift['db_total']:,}")
        print(f"      PDF実額: ¥{drift['pdf_actual']:,}  (差: ¥{drift['diff']:>+,})")
        print(f"      推奨対応: beauty_employee_grade(id={drift['grade_id']}).base_salary_override = {drift['suggested_override']}")
        print(f"        → 契約書記載と一致するか確認 / DB更新するなら notes に変更理由を記録")
    if drift_count == 0:
        print("  ✓ ドリフト無し（DBの契約情報とPDF実額が一致）")

    if args.json:
        print("\n--- JSON ---")
        print(json.dumps(all_results, ensure_ascii=False, indent=2))

    if args.apply:
        apply_to_db(year, month, pdf_records, alias_map, args.pdf.name, args.pdf)


if __name__ == "__main__":
    main()
