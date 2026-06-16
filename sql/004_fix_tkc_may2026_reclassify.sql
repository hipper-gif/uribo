-- 2026-06-16: 2026年5月実績のTKCインポート取りこぼし補正
-- 原因: ① 6117 Twinkle代の店舗別クロバー(過小) ② 親科目細目の primary 全寄せ
-- tkcImport.ts 根本修正(commit 31f1fb2)後の値に、5月実績を手動で揃える。
-- 対象: twinklemark_nicolio.beauty_monthly_data / fiscal_year=2026 month=5 data_type='実績' store 1,2
-- 検算: 各親TKC科目の税込合計は保存(6218/6219/6226/6227/6117)。HPB(寝屋川)はTKCに無く対象外。

-- ① Twinkle代: 全6117合算235,000 → (235,000-40,000)÷2 = 97,500/店
UPDATE beauty_monthly_data SET amount=97500 WHERE id=7844;  -- 寝屋川 twinkle_fee 12,500→97,500
UPDATE beauty_monthly_data SET amount=97500 WHERE id=7837;  -- 守口   twinkle_fee 12,500→97,500

-- ② 6218 通信費の細分(サブスクを分離、残りcommunication)
UPDATE beauty_monthly_data SET amount=10268 WHERE id=7846;  -- 寝屋川 communication 12,522→10,268
UPDATE beauty_monthly_data SET amount=11710 WHERE id=7834;  -- 守口   communication 13,964→11,710
INSERT INTO beauty_monthly_data (store_id,fiscal_year,month,data_type,item_id,amount) VALUES
  (1,2026,5,'実績',20,714),   -- 寝屋川 microsoft
  (1,2026,5,'実績',21,940),   -- 寝屋川 spotify
  (1,2026,5,'実績',23,600),   -- 寝屋川 amazon_prime
  (2,2026,5,'実績',20,714),   -- 守口   microsoft
  (2,2026,5,'実績',21,940),   -- 守口   spotify
  (2,2026,5,'実績',23,600);   -- 守口   amazon_prime

-- ② 6227 支払手数料の細分(ゴミ回収を分離)
UPDATE beauty_monthly_data SET amount=26387 WHERE id=7831;  -- 寝屋川 fees 28,137→26,387
INSERT INTO beauty_monthly_data (store_id,fiscal_year,month,data_type,item_id,amount) VALUES
  (1,2026,5,'実績',22,1750);  -- 寝屋川 garbage(北口建設 ゴミ回収)

-- ② 6219 水道光熱費の細分(守口の水道を分離)
UPDATE beauty_monthly_data SET amount=12278 WHERE id=7841;  -- 守口 electricity 15,422→12,278
INSERT INTO beauty_monthly_data (store_id,fiscal_year,month,data_type,item_id,amount) VALUES
  (2,2026,5,'実績',19,3144);  -- 守口 water_utility(水道代)

-- ② 6226 福利厚生費の細分(非ウォーター分をwelfareへ)
UPDATE beauty_monthly_data SET amount=3300 WHERE id=7832;   -- 守口 water_supply 7,330→3,300
INSERT INTO beauty_monthly_data (store_id,fiscal_year,month,data_type,item_id,amount) VALUES
  (2,2026,5,'実績',70,4030);  -- 守口 welfare(京阪百貨店 スターバックス)
