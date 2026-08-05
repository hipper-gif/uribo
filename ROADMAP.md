# Uribo ROADMAP

> dev backlogの置き場（clio/Thaliaタスク台帳には入れない）。現況・statusの正本=projectsテーブル。

## バックログ

### 今道寿子の歩合計算（売上×50%・リアライズ支給）— 2026-08-05 杉原氏要望

- **ルール**（facts F7・6月実績で機械検証済み）: 報酬 = サロンボード本人売上（beauty_staff_raw sales_total）× 50%。**支給はリアライズ（別会社）**＝Smiley PX2に載せない
- **実装**: calc_payroll（beauty_payroll_monthly生成）に個人ルールとして追加。出力先は通常の給与draftと分け、**リアライズ支給額**として明示（PochiClock realize_manual_entries への連携が理想＝PX2取込CSVがリアライズ分を自動差引する既存機構に乗る）
- **当面の運用**: 月初にClioが beauty_staff_raw の売上×50%を手計算して PochiClock リアライズ手入力に登録（2026-07分=21,400×50%=10,700円で初運用）
- 給与月次フロー全体の正本 = clio `projects/payroll-monthly.md`
