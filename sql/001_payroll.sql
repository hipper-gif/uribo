-- うりぼー 美容部給与計算サブシステム DDL
-- 設計書: clio/projects/uribo-staff-sync.md
-- 適用環境: 本番MySQL（Nicolio/Uribo共有DB）
-- 作成: 2026-05-05

-- ===========================================================
-- マスタ系
-- ===========================================================

-- 給与グレードマスタ
CREATE TABLE IF NOT EXISTS beauty_salary_grade (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employment_type ENUM('パート','有期雇用','正社員') NOT NULL,
  grade ENUM('A','B','C','D') NOT NULL,
  base_amount INT NOT NULL COMMENT '時給(パート)or月給(有期/正社員)',
  description TEXT,
  effective_from DATE NOT NULL,
  effective_to DATE DEFAULT NULL COMMENT 'NULL=現行',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (employment_type, grade, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 歩合テーブル（売上下限→達成金）
CREATE TABLE IF NOT EXISTS beauty_commission_table (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sales_threshold INT NOT NULL COMMENT '売上下限(円)、以上',
  commission_amount INT NOT NULL COMMENT '達成金(円)',
  effective_from DATE NOT NULL,
  effective_to DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (effective_from, effective_to, sales_threshold)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 役職手当マスタ
CREATE TABLE IF NOT EXISTS beauty_position_allowance (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  position_name VARCHAR(64) NOT NULL,
  amount INT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_active (position_name, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- スタッフ属性
-- ===========================================================

-- スタッフ別ランク履歴（昇給フローで履歴管理）
CREATE TABLE IF NOT EXISTS beauty_employee_grade (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL COMMENT 'mneme.employees.id',
  employment_type ENUM('パート','有期雇用','正社員') NOT NULL,
  grade ENUM('A','B','C','D') NOT NULL,
  base_salary_override INT DEFAULT NULL COMMENT '個別ベースアップ加算(NULL=マスタ通り)',
  effective_from DATE NOT NULL,
  effective_to DATE DEFAULT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_employee_active (employee_id, effective_from, effective_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- サロンボード表示名マッピング
CREATE TABLE IF NOT EXISTS salonboard_staff_alias (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  store_code VARCHAR(32) NOT NULL,
  salonboard_name VARCHAR(64) NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_store_name (store_code, salonboard_name),
  INDEX idx_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- 月次データ
-- ===========================================================

-- 月次給与計算データ
CREATE TABLE IF NOT EXISTS beauty_payroll_monthly (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  store_id INT UNSIGNED NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  month TINYINT UNSIGNED NOT NULL,

  -- 自動取得
  sales_total INT DEFAULT 0,
  sales_treatment INT DEFAULT 0,
  sales_product INT DEFAULT 0,
  sales_option INT DEFAULT 0,
  customers_total INT DEFAULT 0,
  customers_new INT DEFAULT 0,
  customers_repeat INT DEFAULT 0,
  nomination_count_scraped INT DEFAULT 0 COMMENT 'サロンボード上の指名件数(参考)',
  nomination_sales INT DEFAULT 0,

  -- 計算値(自動)
  base_salary INT DEFAULT 0 COMMENT '雇用形態×ランク+override',
  commission_amount INT DEFAULT 0 COMMENT '歩合(売上→達成金)',
  position_allowance INT DEFAULT 0 COMMENT '役職手当',

  -- 手入力(爽夏さん補正)
  nomination_count_actual INT DEFAULT 0 COMMENT '実績指名件数(給与計算ベース)',
  nomination_allowance INT DEFAULT 0 COMMENT '指名手当(actual×500)',
  paid_leave_days DECIMAL(4,1) DEFAULT 0,
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  transit_amount INT DEFAULT 0,
  reimbursement INT DEFAULT 0,
  perfect_attendance TINYINT(1) DEFAULT 0 COMMENT '皆勤達成フラグ',
  perfect_attendance_accrual INT DEFAULT 0 COMMENT '皆勤積立額(達成月¥5,000)',
  manual_adjustments JSON DEFAULT NULL COMMENT 'その他調整(理由付き)',

  -- 計算値(合計)
  total_amount INT DEFAULT 0 COMMENT '月次支給合計(皆勤積立は含めない)',

  -- ステータス
  status ENUM('draft','confirmed','tkc_entered') NOT NULL DEFAULT 'draft',
  confirmed_by INT UNSIGNED DEFAULT NULL,
  confirmed_at TIMESTAMP NULL DEFAULT NULL,
  notes TEXT,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_employee_month (employee_id, year, month),
  INDEX idx_store_month (store_id, year, month),
  INDEX idx_status (status, year, month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================================================
-- 初期マスタデータ
-- ===========================================================

-- 給与グレード（12行）
INSERT INTO beauty_salary_grade (employment_type, grade, base_amount, description, effective_from) VALUES
('パート',   'D', 1177, '1hサービスができる', '2026-04-01'),
('パート',   'C', 1200, '1.5h以上のサービスができる', '2026-04-01'),
('パート',   'B', 1250, '全サービス可・土日祝出勤可', '2026-04-01'),
('パート',   'A', 1300, '全サービス高水準・土日祝出勤可・店舗管理可', '2026-04-01'),
('有期雇用', 'D', 208000, '未経験・研修期間', '2026-04-01'),
('有期雇用', 'C', 210000, '全サービス最低限・土日祝出勤可', '2026-04-01'),
('有期雇用', 'B', 220000, '全サービス可・土日祝出勤可・店舗管理可', '2026-04-01'),
('有期雇用', 'A', 230000, '全サービス高水準・土日祝出勤可・店舗管理可', '2026-04-01'),
('正社員',   'D', 215000, '一部サービス最低限・土日祝出勤可', '2026-04-01'),
('正社員',   'C', 220000, '全サービス最低限・土日祝出勤可', '2026-04-01'),
('正社員',   'B', 230000, '全サービス可・土日祝出勤可・店舗管理可', '2026-04-01'),
('正社員',   'A', 240000, '全サービス高水準・土日祝出勤可・店舗管理可', '2026-04-01');

-- 歩合テーブル（9行）
INSERT INTO beauty_commission_table (sales_threshold, commission_amount, effective_from) VALUES
(100000,   500, '2026-04-01'),
(200000,  1000, '2026-04-01'),
(300000,  2000, '2026-04-01'),
(350000,  3500, '2026-04-01'),
(400000,  5000, '2026-04-01'),
(450000,  7500, '2026-04-01'),
(500000, 10000, '2026-04-01'),
(550000, 15000, '2026-04-01'),
(600000, 20000, '2026-04-01');

-- 役職手当（店長 ¥30,000）
INSERT INTO beauty_position_allowance (position_name, amount, effective_from) VALUES
('店長', 30000, '2026-04-01');

-- サロンボードマッピング（10名・4月実機検証済）
INSERT INTO salonboard_staff_alias (store_code, salonboard_name, employee_id) VALUES
('neyagawa',  'Yuuna　.M',  68),
('neyagawa',  'Nene　.M',   73),
('neyagawa',  'Maria　.T',  74),
('neyagawa',  'Utaha　.H',  76),
('neyagawa',  'Akari　.K',  75),
('moriguchi', 'Kotoe　.K',  77),
('moriguchi', 'Maho　.W',   78),
('moriguchi', 'Rionn　.I',  82),
('moriguchi', 'Yuuna　.K', 104),
('moriguchi', 'Mei　.K',   106);

-- スタッフ別ランク履歴（10名・4月明細から確定）
INSERT INTO beauty_employee_grade (employee_id, employment_type, grade, base_salary_override, effective_from, notes) VALUES
( 68, '正社員',   'A', NULL,  '2026-04-01', '寝屋川店長'),
( 73, '有期雇用', 'B', NULL,  '2026-04-01', NULL),
( 74, 'パート',   'D', NULL,  '2026-04-01', NULL),
( 75, 'パート',   'D', NULL,  '2026-04-01', NULL),
( 76, '有期雇用', 'C', NULL,  '2026-04-01', NULL),
( 77, '正社員',   'A', 6000,  '2026-04-01', '守口店長・個別ベースアップ¥6,000'),
( 78, 'パート',   'A', NULL,  '2026-04-01', NULL),
( 82, '有期雇用', 'B', NULL,  '2026-04-01', NULL),
(104, 'パート',   'D', NULL,  '2026-04-01', NULL),
(106, 'パート',   'D', NULL,  '2026-04-01', NULL);

-- ===========================================================
-- ロールバック用（必要時）
-- ===========================================================
-- DROP TABLE IF EXISTS beauty_payroll_monthly;
-- DROP TABLE IF EXISTS salonboard_staff_alias;
-- DROP TABLE IF EXISTS beauty_employee_grade;
-- DROP TABLE IF EXISTS beauty_position_allowance;
-- DROP TABLE IF EXISTS beauty_commission_table;
-- DROP TABLE IF EXISTS beauty_salary_grade;
