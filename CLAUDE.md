# Uribo - CLAUDE.md

## プロジェクト概要

- **プロジェクト名**: Uribo
- **説明**: 美容部門売上管理ツール（うりぼー）
- **技術スタック**: React + TypeScript + Tailwind + PHP + MySQL
- **リポジトリ**: https://github.com/hipper-gif/uribo

## デプロイ先

- **使う人区分**: 👤 個人（美容部長必須） + 🏢 社内（他部門長/経営層閲覧）※両面持ち
- **公開URL**: https://twinklemark.xsrv.jp/uribo/
- **デプロイ先パス**: `~/twinklemark.xsrv.jp/public_html/uribo/`
- **DB**: `twinklemark_nicolio`（**Nicolio共有DB、beauty_monthly_data 等のテーブル**）
- **⚠️ 共有DB**: DDL変更は Nicolio/Thalia/しんせいくん等に影響。安全フロー必須
- **詳細ルール**: `clio/knowledge/deploy-layout.md`

## 技術スタック

React + TypeScript + Tailwind + PHP + MySQL

## beauty_item_master の運用ルール ★必須

UIに表示される項目は `useItemMaster` (`frontend/src/lib/useBeautyData.ts`) で `is_active=eq.1` でフィルタされている。

### 妻向けダッシュボードに出す項目(`is_active=1`)
- 売上カテゴリ: `sales` / `customers` / `unit_price` の3つだけ
- 経費は 9区分(下記)で大まかにまとめた項目
- 細かい売上内訳(現金日別・カード・電マネ等)は **出さない**

### 経費の9区分(2026-05-23確定・経営判断軸)

「テコ入れポイントの可視化」と「目標設定時の予測しやすさ」を両立する分類。

| 区分 | 性質 | 主なitem | 予測ロジック | テコ入れ難度 |
|------|------|---------|------------|------------|
| **変動費** | 売上連動 | cogs, supplies, fees, hpb | 売上×% | 中 |
| **人件費** | 半固定・人員計画依存 | salary_total, bonus, recruitment, training, welfare, transport_total, commute_allowance | 人員計画 | 高 |
| **法定費用** | 強制・削減不可 | legal_welfare, workers_comp, withholding_tax, vat_purchase, net_payable_tax | 自動算定 | 不可 |
| **契約固定費** | 月額固定・契約縛り | rent, franchise_fee, depreciation, insurance, shopping_street | 確定値 | 低 |
| **インフラ** | 使用量で半変動 | electricity, gas, water_utility, communication, garbage | 前月±α | 中 |
| **サブスク** | 月額固定・解約容易 | water_supply, microsoft, spotify, amazon_prime | 確定値 | 高 |
| **スポット費用** | 不定期発生 | travel_expense, repair, entertainment, meeting, advertising, outsourcing | 年予算÷12 | 中 |
| **管理費** | 内部按分・固定 | twinkle_fee | 確定値 | 個別 |
| **その他** | 残り | discount, other_expense, 集計派生 | — | — |

### tax-exclusive 入力する item

`TAX_EXCLUSIVE_INPUT_CODES = { 'cogs', 'supplies' }`
UIでは税抜入力、DBでは×1.10して税込保存。受領レシートが税抜のため。

### ちょぼまる連携用の細粒度 item(`is_active=0`)
- 売上の細かい内訳(`cash_sales_d01_05`、`card_sales_d01_05` 等)はちょぼまるが TKC仕訳のために使う
- うりぼー UI では非表示(`is_active=0`)、DBにはデータ保持、ちょぼまるからは取得可能
- ちょぼまる側のクエリは `item_code=like.*sales*` で `is_active` フィルタを使っていないので問題なく読める

### 新規 item を追加する時のルール
- **デフォルトで `is_active=0` を指定する**
- 「妻にも見せたい」項目を新設するときだけ `is_active=1` にする
- 過去事故: 2026-05-22 に 18件の5日単位売上 item が `is_active=1` で投入され、ダッシュボードに「—」行がずらっと表示された

### ちょぼまる側ルール
`C:/Users/nikon/projects/chobomaru/CLAUDE.md` に同じルールを記載済み(対の関係)。

---

## TKC連携のイレギュラー運用ルール ★必須

TKC(税理士確定値)とうりぼーの数値は、以下の運用上のズレが**意図的にある**。
インポート機能や TKC 比較で「差分=エラー」と判定しないこと。

### 1. Twinkle代 (`twinkle_fee`)
- 実態: **爽夏さんへの給料**。介護部門も兼任しているため**部門間で按分**
- TKC: 6117外注費に**美容部門全額(例: 4月 171,000円)** が計上される
- うりぼー算式: **(TKC 6117のTwinkle代相当 − 40,000円(介護按分)) ÷ 2 = 各店舗 twinkle_fee**
  - 例: 4月 (171,000 − 40,000) ÷ 2 = 65,500円/店舗
- `MGMT_FEE_CODE = 'twinkle_fee'` で支出合計から除外される独立科目
- 取引先名「テインクル/ティンクル/twinkle/杉原/爽夏」で識別

### 2. 和田の委託費
- TKC: 6117 外注費に計上
- うりぼー: **`salary_total`(人件費)に含める給料扱い**
- 理由: 給料計算はうりぼーで完結させたいため

### 3. TKC 6117 外注費の扱い
- 中身: **Twinkle代(介護按分前の美容部門全額) + 和田委託費 + その他真の外注**
- **そのまま `outsourcing` にインポートしてはダメ**(二重計上になる)
- インポート時は 6117 を取引先名で分類:
  - Twinkle代相当 → 別ロジックで `twinkle_fee` に按分(項目1参照)
  - 和田委託費相当 → うりぼー側は `salary_total` に既に含むので無視
  - その他真の外注 → `outsourcing`

### 4. 寝屋川店の家賃構成
- 請求額: **124,000円/月** (寝屋川店分)
- 内訳: **121,000円が家賃本体 + 3,000円は水道代**
- うりぼー: `rent` = 121,000円、水道代3,000円は `water_utility` 等に分離計上
- 守口店: 別構成(2026年4月時点で要確認)

### 5. 過去 `rent` データの実態乖離 (2025fy以前)
- 過去のうりぼー `rent`(月426K等)は「**家賃以外の固定費を混ぜ込んだ総額**」
- 実態の家賃は TKC 6215 の値が真。寝屋川店分しか TKC にない可能性大、守口店分は別経路の疑い
- **過去 rent をそのまま比較・遡及修正してはいけない**。2026年4月以降を「正しい仕分け」で運用

### 6. cogs と supplies の分離
- 過去(2025fy以前): `cogs` に材料仕入と備品消耗品が混在
- 2026年4月以降: 寝屋川店から分離開始(`cogs`=材料、`supplies`=ハサミ/コーム/タオル等)
- TKC マッピング: 5211 材料仕入高 → `cogs` / 6225 備品消耗品費 → `supplies`

### 7. transport_total (通勤手当) の運用
- `transport_total` は `is_calculated=1 / is_active=0` だが、**実際は値が入力されている**(2026年4月時点)
- 給料計算ルート(Payroll経由)で集計される独自運用
- 新規追加した `commute_allowance` は **不要** → is_active=0 に戻す
- TKC 6111 通勤交通費 → `transport_total` にマッピング(commute_allowance は使わない)

### 8. 守口店 2026年4月の入力欠落
- rent / cogs / supplies / 固定費類が未入力(2026-05-23 確認時点)
- TKCインポートで補完予定

### インポート機能の設計含意
- 売上(4111): `(TKC × 1.10) + 既存 discount` で復元、discount は触らない
- 6117 外注費: 全額自動取込せず、プレビューで手動振り分け
- 6215 家賃: 寝屋川店分は実態値で上書きOK、守口店分は別途確認
- 1対多TKC科目(6113/6116/6218/6219/6312): プレビューで各 uribo item へ分配入力
- 3月決算月: 期末調整があるためプレビュー必須・自動取込除外推奨
- うりぼー独自(discount/twinkle_fee/withholding_tax/派生計算): インポート対象外

---

## Clio連携ルール（必須・全プロジェクト共通）

このリポジトリは **Clio（パーソナル秘書AI）** のタスク管理対象です。
サブセッション（このリポジトリで開発作業をするClaude Codeセッション）は、以下のルールに従ってください。

### Nicolio API 情報

| 項目 | 値 |
|------|-----|
| API URL | `https://twinklemark.xsrv.jp/nicolio-api/api.php` |
| 認証 | `Authorization: Bearer nicolio_secret_2525xsrv` |
| タスク更新 | `PATCH /tasks?id=eq.{UUID}` |

### タスクステータス即時更新（必須）

**作業が進んだら、その場でタスクのnext_actionとstatusを更新する。セッション終了まで待たない。**

以下のいずれかに該当したら即更新:
- 成果物（ファイル・コード・設計書等）を完成した
- git commit & push した
- ブロッカーが解消された（前提機能の完成等）
- フェーズが進んだ（要件定義→実装等）

**next_actionの書き方**: 完了した内容（過去形）ではなく、**次にやるべきこと**を書く。

```bash
# 更新例
python -c "
import urllib.request, json
url = 'https://twinklemark.xsrv.jp/nicolio-api/api.php/tasks?id=eq.{TASK_UUID}'
data = json.dumps({'next_action': '次にやること', 'status': '進行中'}).encode()
req = urllib.request.Request(url, data=data, headers={
    'Authorization': 'Bearer nicolio_secret_2525xsrv',
    'Content-Type': 'application/json'
}, method='PATCH')
urllib.request.urlopen(req)
"
```

### セッション完了時プロトコル（必須）

セッション終了前に**必ず**以下を実行:

1. **git commit & push** — 未コミット変更を残さない
2. **タスク更新** — next_actionが「次のステップ」を指しているか確認。完了したアクションが残っていたら書き換える
3. **git status** — 未コミットがないことを最終確認

### Git運用ルール

- デプロイしたら**必ず** git commit & push（デプロイ済みコードがGitHub未反映の状態を残さない）
- 作業の区切り（機能追加・バグ修正・設定変更等）ごとにこまめに commit & push
- コミットメッセージは日本語で簡潔に
