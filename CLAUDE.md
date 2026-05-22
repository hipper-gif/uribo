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
- 経費カテゴリ: 仕入・人件費・法定福利・固定費・税金・その他 で大まかにまとめた項目
- 細かい売上内訳(現金日別・カード・電マネ等)は **出さない**

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
