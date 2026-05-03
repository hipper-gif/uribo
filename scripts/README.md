# Uribo データ同期スクリプト

外部システムから美容部門の月次売上データを取得し、Uribo (Nicolio API) に投入するスクリプト群。

## sync_salonboard.py — サロンボード→Uribo

サロンボードの「売上管理 → 売上報告 → 集計」結果から月次データを取得し、`beauty_monthly_data` (data_type=`実績`) に UPSERT する。

### 取得項目とマッピング

| サロンボードの値 | beauty_item_master |
|---|---|
| 総売上（金額） | `sales` (item_id=1) |
| 純売上（客数） | `customers` (item_id=2) |
| 割引（金額） | `discount` (item_id=4) |
| 純売上の内消費税 | `withholding_tax` (item_id=24) |

`sales` には割引控除前の総売上、`discount` には割引額（正の値）を入れる。
Uribo の純利益計算は `net_profit = sales - discount - 経費合計` のため、
sales に純売上（=総売上-割引）を入れると割引が二重控除になる。

### 前提

- **Python 3.10+**
- **GUI 環境**: サロンボードは Akamai Bot Manager 対策で headless=False 必須。実行中にブラウザウィンドウが開く
- **認証情報**: 寝屋川店・守口店それぞれの ID/PASS が必要

### セットアップ

```powershell
cd C:\Users\nikon\projects\uribo\scripts
pip install -r requirements.txt
playwright install chromium

copy .env.example .env
# .env にサロンボード認証情報を記入
```

### 実行

```powershell
# 両店・前月分（運用デフォルト）
python sync_salonboard.py

# 寝屋川のみ
python sync_salonboard.py --store neyagawa

# 月指定
python sync_salonboard.py --month 2026-04

# 取得結果だけ確認（API更新せず）
python sync_salonboard.py --dry-run

# 自動実行で CAPTCHA に当たったら待たず即エラー (cron 用)
python sync_salonboard.py --non-interactive
```

### CAPTCHA / 追加認証が出たとき

短時間に何度もログインすると、サロンボード側で画像認証
（「カップケーキの上に果物を載せて〜」等のドラッグパズル）が発動します。

通常モード (`--non-interactive` を付けない) では、ログインが20秒待っても
KLP/top に到達しない場合に手動介入待ちになります:

```
[!] 寝屋川店 のログインが自動完了しませんでした。
    開いているブラウザで CAPTCHA / 追加認証を手動で解いてください。
    ログイン後トップ画面 (URL に /KLP/top/) に到達したら Enter を押下。
    > Enter で続行: ▏
```

ブラウザは開いたままなので、手で CAPTCHA を解いてログインボタンを押し、
トップ画面に来たらターミナルで Enter を押すと処理が再開します。
最大2分間トップ画面到達を待ちます。中止は Ctrl+C。

### 自動実行（Windows タスクスケジューラ）

毎月1日 9:00 に前月分を同期する例:

1. タスクスケジューラを開く → 「タスクの作成」
2. **トリガー**: 毎月 1日 09:00
3. **操作**:
   - プログラム: `python`
   - 引数: `sync_salonboard.py --non-interactive`
   - 開始: `C:\Users\nikon\projects\uribo\scripts`
4. **条件**: 「ユーザーがログオンしているときのみ実行する」（GUI 必須のため）

`--non-interactive` を付けることで、CAPTCHA に当たった場合に手動介入を待たず
即エラー終了します。失敗ログを後から確認し、対話モードで再実行する運用が安全。

### 既知の制約

- サロンボードは公式 API なし。HTML 構造が変わると壊れる
- ログイン後にキャプチャを要求されるケースは未対応（出たら手動で通す）
- 同月の `実績` レコードを上書きする。既に手入力した値は保持されない（`amount` のみ更新、`notes` は触らない）
