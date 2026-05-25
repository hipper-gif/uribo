-- ===========================================================
-- beauty_item_master.item_category: ENUM → VARCHAR(20)
-- ===========================================================
-- 経緯 (2026-05-23):
--   item_category を旧7区分 ENUM('売上','仕入','人件費','法定福利','固定費','税金','その他') から
--   9区分 + 売上 への再カテゴリ化を実施したが、ENUM 制約で
--   新カテゴリ値('変動費','契約固定費','インフラ','サブスク','スポット費用','管理費','法定費用')
--   が **silent に空文字列保存** されてダッシュボードで項目が消える事故が発生。
--
--   ENUM拡張ではなく VARCHAR にすることで今後のカテゴリ追加・変更を柔軟に。
--   既存値('売上'/'人件費'/'その他')はそのまま VARCHAR に migrate される(MySQL自動)。
-- ===========================================================

USE twinklemark_nicolio;
SET NAMES utf8mb4;

ALTER TABLE beauty_item_master
  MODIFY COLUMN item_category VARCHAR(20) NOT NULL;

-- 旧UPDATE で空文字列になった項目を正しいカテゴリに修正
UPDATE beauty_item_master SET item_category = '変動費'      WHERE item_code IN ('cogs','supplies','fees','hpb');
UPDATE beauty_item_master SET item_category = '法定費用'    WHERE item_code IN ('legal_welfare','workers_comp','health_ins_total','withholding_tax','vat_purchase','net_payable_tax');
UPDATE beauty_item_master SET item_category = '契約固定費'  WHERE item_code IN ('rent','depreciation','franchise_fee','insurance','shopping_street');
UPDATE beauty_item_master SET item_category = 'インフラ'    WHERE item_code IN ('electricity','gas','water_utility','communication','garbage');
UPDATE beauty_item_master SET item_category = 'サブスク'    WHERE item_code IN ('water_supply','microsoft','spotify','amazon_prime');
UPDATE beauty_item_master SET item_category = 'スポット費用' WHERE item_code IN ('advertising','travel_expense','outsourcing','repair','entertainment','meeting');
UPDATE beauty_item_master SET item_category = '管理費'      WHERE item_code = 'twinkle_fee';

-- 検証
SELECT item_category, COUNT(*) AS n
FROM beauty_item_master
WHERE is_active = 1
GROUP BY item_category
ORDER BY n DESC;
