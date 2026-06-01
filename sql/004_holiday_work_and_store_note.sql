-- うりぼー 給与計算: 休日交代出勤手当 + 店舗メモ
-- 対象DB: twinklemark_nicolio（Nicolio共有）
-- 作成: 2026-06-01
--
-- 1) beauty_payroll_monthly に休日交代出勤の手当カラムを追加
--    休日に交代で出勤した回数を入力 → ×¥500 を支給合計に算入（指名手当と同方式）
-- 2) beauty_payroll_store_note: 店舗×年月単位の編集メモ（爽夏さんの申し送り用）

-- ===========================================================
-- 1) 休日交代出勤手当
-- ===========================================================
ALTER TABLE beauty_payroll_monthly
  ADD COLUMN holiday_work_count INT DEFAULT 0 COMMENT '休日交代出勤の回数（手入力）' AFTER perfect_attendance_accrual,
  ADD COLUMN holiday_work_allowance INT DEFAULT 0 COMMENT '休日交代出勤手当（count×¥500）' AFTER holiday_work_count;

-- ===========================================================
-- 2) 店舗メモ（月×店舗）
-- ===========================================================
CREATE TABLE IF NOT EXISTS beauty_payroll_store_note (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_id INT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_store_month (store_id, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- ロールバック用（必要時）
-- ===========================================================
-- ALTER TABLE beauty_payroll_monthly DROP COLUMN holiday_work_allowance, DROP COLUMN holiday_work_count;
-- DROP TABLE IF EXISTS beauty_payroll_store_note;
