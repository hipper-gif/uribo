# Uribo - CLAUDE.md

## プロジェクト概要

- **プロジェクト名**: Uribo
- **説明**: 美容部門売上管理ツール（うりぼー）
- **技術スタック**: React + TypeScript + Tailwind + PHP + MySQL
- **リポジトリ**: https://github.com/hipper-gif/uribo

## 技術スタック

React + TypeScript + Tailwind + PHP + MySQL

<!-- 以下はプロジェクト固有セクション。必要に応じて記載 -->
<!--
## ディレクトリ構成
## DBスキーマ
## デプロイ方法
## コーディングルール
-->

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
