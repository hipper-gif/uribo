"""全社等級表(Mneme salary_grades)からの基本給マスタ取得 — うりぼう共有ヘルパー。

正本 = Mneme `salary_grades` (twinklemark_employee DB, department_id=3 が美容部)。
うりぼうの旧 `beauty_salary_grade` は廃止済(2026-06-09 一本化)。

employment_type の表記差に注意:
  - 等級表(salary_grades)        : 'パート・アルバイト' / '有期雇用' / '正社員'
  - うりぼう個人割当(beauty_employee_grade): 'パート' / '有期雇用' / '正社員'
  本ヘルパーは うりぼう表記を受け取り、等級表表記へマップして引く。

有効期間: active = effective_from <= 対象日 AND (effective_to IS NULL OR effective_to >= 対象日)。
"""
import json
import os
import urllib.parse
import urllib.request

BEAUTY_DEPT_ID = 3


# 注: トークンは呼び出し時に読む（モジュール読込が load_dotenv より先だと
# 環境変数が未反映で placeholder のまま 401 になるため。2026-07-01 修正）
def _mneme_url() -> str:
    return os.getenv("MNEME_API_URL", "https://twinklemark.xsrv.jp/mneme-api/index.php")


def _mneme_token() -> str:
    return os.getenv("MNEME_API_TOKEN", "mneme_secret_2525xsrv")

# うりぼう雇用形態 → Mneme salary_grades.employment_type
ETYPE_TO_GRADE_VOCAB = {
    "パート": "パート・アルバイト",
    "有期雇用": "有期雇用",
    "正社員": "正社員",
}

_cache: dict[int, list[dict]] = {}


def fetch_salary_grades(department_id: int = BEAUTY_DEPT_ID) -> list[dict]:
    """Mneme salary_grades を部門で取得(プロセス内キャッシュ)。"""
    if department_id in _cache:
        return _cache[department_id]
    qs = urllib.parse.urlencode({"department_id": f"eq.{department_id}", "order": "grade.asc"})
    req = urllib.request.Request(
        f"{_mneme_url()}/salary_grades?{qs}",
        headers={"Authorization": f"Bearer {_mneme_token()}"},
    )
    with urllib.request.urlopen(req) as res:
        text = res.read().decode("utf-8")
        rows = json.loads(text) if text else []
    rows = rows if isinstance(rows, list) else []
    _cache[department_id] = rows
    return rows


def get_master_amount(uribo_employment_type: str, grade: str, target_date: str,
                      department_id: int = BEAUTY_DEPT_ID) -> int | None:
    """target_date(YYYY-MM-DD)時点で有効な base_salary を返す。無ければ None。

    uribo_employment_type は うりぼう表記('パート'等)で渡す。
    """
    vocab = ETYPE_TO_GRADE_VOCAB.get(uribo_employment_type, uribo_employment_type)
    cands = []
    for r in fetch_salary_grades(department_id):
        if r.get("employment_type") != vocab or r.get("grade") != grade:
            continue
        ef = r.get("effective_from")
        et = r.get("effective_to")
        if ef and ef <= target_date and (et is None or et >= target_date):
            cands.append((ef, int(r["base_salary"])))
    if not cands:
        return None
    cands.sort()
    return cands[-1][1]  # 最新発効を採用
