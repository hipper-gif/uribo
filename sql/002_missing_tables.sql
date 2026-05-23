-- ===========================================================
-- うりぼー 未管理テーブル ベースライン DDL
-- ===========================================================
-- 出典   : twinklemark_nicolio MySQL から mysqldump で救出（2026-05-23）
-- 計画書 : clio/knowledge/thalia-nicolio-restructure.md
--
-- 経緯:
--   001_payroll.sql で給与計算系の主要テーブル（beauty_salary_grade /
--   beauty_commission_table / beauty_position_allowance / beauty_employee_grade /
--   salonboard_staff_alias / beauty_payroll_monthly）は管理していたが、
--   月次データ・マスタ系の以下 6 テーブルが孤児化していた:
--
--     beauty_stores                 美容店舗マスタ
--     beauty_item_master            月次データ項目マスタ
--     beauty_monthly_data           店舗×月×項目の月次データ
--     beauty_monthly_meta           店舗×月のメタ情報（人員数等）
--     beauty_employee_monthly       従業員×月の月次（旧データ・移行用）
--     beauty_staff_store_map        Mneme従業員 ↔ 店舗の紐付け
--
-- 注意:
--   - 既存 DB への再適用安全のため CREATE TABLE IF NOT EXISTS を採用
--   - AUTO_INCREMENT 値は seed では不要のため除去
--   - 外部キー順序: beauty_stores → beauty_item_master →
--     beauty_monthly_data, beauty_monthly_meta, beauty_employee_monthly,
--     beauty_staff_store_map
-- ===========================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------
-- beauty_stores : 美容店舗マスタ
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `beauty_stores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `code` varchar(20) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_store_name` (`name`),
  UNIQUE KEY `idx_store_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- beauty_item_master : 月次データ項目マスタ（売上/仕入/人件費/法定福利 等）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `beauty_item_master` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_category` enum('売上','仕入','人件費','法定福利','固定費','税金','その他') NOT NULL,
  `item_code` varchar(50) NOT NULL,
  `item_name` varchar(100) NOT NULL,
  `unit` varchar(20) NOT NULL DEFAULT '円',
  `is_calculated` tinyint(1) NOT NULL DEFAULT 0,
  `calc_formula` varchar(200) DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_item_code` (`item_code`),
  KEY `idx_category_sort` (`item_category`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- beauty_monthly_data : 店舗×月×項目 月次データ
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `beauty_monthly_data` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `store_id` int(11) NOT NULL,
  `fiscal_year` smallint(6) NOT NULL,
  `month` tinyint(4) NOT NULL,
  `data_type` enum('実績','目標','見通し') NOT NULL,
  `item_id` int(11) NOT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_entry` (`store_id`,`fiscal_year`,`month`,`data_type`,`item_id`),
  KEY `idx_store_period` (`store_id`,`fiscal_year`,`month`),
  KEY `fk_monthly_item` (`item_id`),
  CONSTRAINT `fk_monthly_item` FOREIGN KEY (`item_id`) REFERENCES `beauty_item_master` (`id`),
  CONSTRAINT `fk_monthly_store` FOREIGN KEY (`store_id`) REFERENCES `beauty_stores` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- beauty_monthly_meta : 店舗×月 メタ情報（人員数・自由メモ）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `beauty_monthly_meta` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `store_id` int(11) NOT NULL,
  `fiscal_year` smallint(6) NOT NULL,
  `month` tinyint(4) NOT NULL,
  `data_type` enum('実績','目標','見通し') NOT NULL,
  `notes` varchar(1000) DEFAULT NULL,
  `fulltime_count` smallint(6) DEFAULT NULL,
  `parttime_count` smallint(6) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_meta` (`store_id`,`fiscal_year`,`month`,`data_type`),
  KEY `idx_meta_period` (`store_id`,`fiscal_year`,`data_type`),
  CONSTRAINT `fk_meta_store` FOREIGN KEY (`store_id`) REFERENCES `beauty_stores` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- beauty_employee_monthly : 従業員×月の月次（旧形式・移行データ）
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `beauty_employee_monthly` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `store_id` int(11) NOT NULL,
  `fiscal_year` smallint(6) NOT NULL,
  `month` tinyint(4) NOT NULL,
  `employee_name` varchar(100) NOT NULL,
  `data_type` enum('実績','目標','見通し') NOT NULL,
  `salary` decimal(10,2) NOT NULL DEFAULT 0.00,
  `transport_allowance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `pension` decimal(10,2) NOT NULL DEFAULT 0.00,
  `health_insurance` decimal(10,2) NOT NULL DEFAULT 0.00,
  `personal_sales` decimal(10,2) NOT NULL DEFAULT 0.00,
  `notes` varchar(500) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_unique_employee` (`store_id`,`fiscal_year`,`month`,`data_type`,`employee_name`),
  CONSTRAINT `fk_emp_store` FOREIGN KEY (`store_id`) REFERENCES `beauty_stores` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------
-- beauty_staff_store_map : Mneme従業員 ↔ 店舗の紐付け
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `beauty_staff_store_map` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `mneme_employee_id` int(11) NOT NULL,
  `store_id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employee` (`mneme_employee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS = 1;
