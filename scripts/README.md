# Uribo データ同期スクリプト

外部システムから美容部門の月次売上データを取得し、Uribo (Nicolio API) に投入するスクリプト群。

## sync_salonboard.py — サロンボード→Uribo

サロンボードの「売上管理 → 売上報告 → 集計」結果から月次データを取得し、`beauty_monthly_data` (data_type=`実績`) に UPSERT する。

### 取得項目とマッピング

| サロンボードの値 | beauty_item_master |
|---|---|
| 純売上（金額） | `sales` (item_id=1) |
| 純売上（客数） | `customers` (item_id=2) |
| 割引（金額） | `discount` (item_id=4) |

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
```

### 自動実行（Windows タスクスケジューラ）

毎月1日 9:00 に前月分を同期する例:

1. タスクスケジューラを開く → 「タスクの作成」
2. **トリガー**: 毎月 1日 09:00
3. **操作**:
   - プログラム: `python`
   - 引数: `sync_salonboard.py`
   - 開始: `C:\Users\nikon\projects\uribo\scripts`
4. **条件**: 「ユーザーがログオンしているときのみ実行する」（GUI 必須のため）

### 既知の制約

- サロンボードは公式 API なし。HTML 構造が変わると壊れる
- ログイン後にキャプチャを要求されるケースは未対応（出たら手動で通す）
- 同月の `実績` レコードを上書きする。既に手入力した値は保持されない（`amount` のみ更新、`notes` は触らない）
