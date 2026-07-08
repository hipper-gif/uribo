# ADR-0001: baseline（現在の主要な決定のスナップショット）

> **この型の目的**: 「何を決めたか・なぜ・そこからどう変わったか」を1本の鎖で追えるようにする（Nygard式 ADR）。
> **これは baseline**: これまでに確定した うりぼー の**主要決定のスナップショット**。以降、決定が変わったら本書は書き換えず**新ADR（0002以降）を作って該当行（D番号）を supersede** する。
> **出典**: CLAUDE.md / README.md / sql/{001_payroll,002_missing_tables,003_item_category_to_varchar} / clio memory project_uribo / CLAUDE-dataflow.md / knowledge/autonomous-ops.md §10。※SPEC.md/ROADMAP.mdはrepoに無く、スコープ正本はCLAUDE.md＋clio memory/dataflowに分散＝負債。

| 項目 | 値 |
|---|---|
| Status | `accepted`（D12＝公開中昇格/SPEC整備 のみ `proposed`） |
| 日付 | 2026-07-08 |
| Supersedes | なし |
| Superseded-by | （後で個別ADRが特定の決定を置き換えたらここへ追記） |
| 関連 | CLAUDE.md / 共有DB twinklemark_nicolio(beauty_*) / facts F1-F6 |

## Context（背景・なぜ決める必要があるか）

美容部門（Can I dressy／ネイルサロンTwinkle・寝屋川/守口/紬）の売上・経費・給与を、妻（美容部長）向けダッシュボードと社内閲覧の両面で月次管理するツール。前身はExcel「年間売上目標.xlsm」（3ブロック＝サマリー/経費明細/人件費明細）。repoは独立だがDBはNicolio共有DBに間借りするためDDL変更のblast radiusが他プロダクトに及ぶ。数値は税理士確定値（TKC）と運用上のズレを意図的に持つ。

## Decision（確定した主要決定＝1決定1行）

| # | 決定 | 理由（1行） | 出典 |
|---|------|------|------|
| D1 | **美容部門の売上・経費・給与の月次管理ツール**(妻向けダッシュボード＋他部門長/経営層の閲覧の両面) | Excel「年間売上目標.xlsm」のDB＋Web化。経営のテコ入れポイント可視化 | CLAUDE L3-16 / project_uribo L13,45-49 |
| D2 | **命名＝うりぼー**(「売上簿」→うりぼー)。repo=uribo | まぬけ感・愛着(2026-04-16)。直訳系＝スタッフ向け命名系譜 | project_uribo L17-19 |
| D3 | **repoは独立、DBはNicolio共有DB twinklemark_nicolio に間借り**(beauty_*テーブル群)。DDL変更はNicolio/Thalia/しんせいくん等に波及→安全フロー必須 | 独立プロダクトだが基盤集約のため物理DBは共有。共有ゆえENUM事故等のblast radius対策が要る | CLAUDE L8,15-17,63-69 / dataflow L26 |
| D4 | **データモデル＝beauty_stores×beauty_item_master×beauty_monthly_data の3軸**(店舗×会計年月×項目、data_type=実績/目標/見通し、UNIQUE(store,fy,month,data_type,item))。「見通し＝何もしなければこうなる最低目標」 | 店舗×月×項目の疎行列で任意項目を持てる。実績/目標/見通しの3系列比較が中核UI | 002_missing_tables.sql L46-86 |
| D5 | **妻ダッシュボードの表示粒度をis_activeフラグで制御**(売上3項目/経費9区分に集約。細粒度内訳はis_active=0で非表示だがDB保持しちょぼまるがTKC仕訳用に読む) | 妻には「テコ入れできる粒度」だけ見せ、機械連携は細粒度を保持。新規itemは既定is_active=0 | CLAUDE L23-108 |
| D6 | **経費9区分(2026-05-23確定・経営判断軸)＋item_categoryをENUM→VARCHAR(20)に型変更(003)** | テコ入れ難度の可視化と予測しやすさを両立。ENUM固定で新カテゴリがsilent空文字保存される事故を型変更で恒久解消 | CLAUDE L32-46,63-69 / 003 |
| D7 | **預かり税(消費税)をキャッシュ視点で月次経費に継続計上**(会計上はBS負債だが実質納付税額を経費扱い)。TKC比較では意図的差分 | 妻ダッシュボードで「手元に残るリアルな金」を見せる | CLAUDE L71-83 |
| D8 | **TKC(税理士確定値)との意図的差分を宣言表RECON_RULES(tkcRecon.ts)で管理し「差分=エラー」と判定しない**(Twinkle代按分・和田委託→守口salary_total・家賃/水道分離等を1対1で宣言) | TKCは社外の一次発生源で運用ズレが構造的にある。宣言表で真の誤りだけを残差突合で検出 | CLAUDE L112-181 |
| D9 | **サロンボード売上取得を2026-07-01にちょぼまるへ一本化。うりぼうはログインせず取り込み口を持たない**(beauty_staff_raw stagingを読みcalc_payroll→beauty_payroll_monthlyに月初draft保存・DB→DB) | 1回ログイン集約でスクレイプ重複と認証事故を減らす。うりぼーは読み手＋給与計算に専念 | project_uribo L42 / dataflow L65-67 / autonomous-ops §10 |
| D10 | **beauty_monthly_dataの書き手をちょぼまる単独に一意化**(旧うりぼーpush_to_uribo等は停止＝二重書き解消)。うりぼうは読み手 | 1正本1書き手(規約7条)。二重書きによる齟齬を構造的に排除 | dataflow L66 |
| D11 | **スタック＝React+TS+Tailwind(Vite)+PHP+MySQL on Xserver共有**(公開URL twinklemark.xsrv.jp/uribo/、deploy=ビルド→deploy.sh直送) | Node永続不可の共有サーバー制約に合わせ静的PWA＋PHPに寄せる | CLAUDE L7,10-14 / deploy.sh |
| D12 | `proposed` **公開中昇格は実利用(妻の本運用)確認後。SPEC.md不在のため当面リリース判定はROADMAP DoD/repo-syncを正とする** | 磨き込み沼防止＝実運用で価値確認してから昇格。正本がCLAUDE.md＋clio memoryに分散＝負債 | CLAUDE L195 / project_uribo L43-44 |

## Consequences（この決定で何が変わるか・トレードオフ）

- 良くなること: 妻が「テコ入れできる粒度(売上3項目＋経費9区分)」だけを見られ、機械連携用の細粒度は同一DBに保持（D5）。実績/目標/見通しの3系列比較が3軸モデルで一貫（D4）。サロンボード取り込みがちょぼまる1口に集約されうりぼーは給与計算＋閲覧に専念＝二重書き/二重ログインが消えた（D9/D10）。TKCとの意図的差分が宣言表で明示され「差分=エラー」の誤判定を排除（D8）。預かり税をキャッシュ計上して手元資金が実額一致（D7）。
- 引き受けるコスト・制約: 共有DB twinklemark_nicolio上のためDDL変更がNicolio/Thalia等に波及しENUM事故のようなblast radiusを安全フローで抑え続ける必要（D3/D6）。RECON_RULESとCLAUDE.md「イレギュラー運用」節の二重メンテ(片方だけ変えると突合が無意味化)（D8）。サロンボード停止検知は月初0件警告に依存（D9）。SPEC.md/ROADMAP.md不在でスコープ正本が分散＝lossy-contextリスク（D12）。
- 捨てた選択肢と理由:
  - うりぼう独自のサロンボードログイン取り込み → スクレイプ重複と認証事故のためちょぼまるへ一本化、旧ログイン経路は--with-staffフォールバックのみ残置（D9）。
  - うりぼう独自の従業員/売上マスタ → 従業員はMneme、月次売上は共有beauty_*を参照(規約2条)。
  - item_categoryをENUMのまま運用 → 対象外値がsilent空文字保存でダッシュボードから項目が消える事故→VARCHAR化（D6）。
  - welfare/commute_allowance/net_payable_taxの新規item → 既存項目と重複→is_active=0に戻し廃止。
  - 過去rent(2025fy以前)をそのまま比較・遡及修正 → 家賃以外の固定費混在で実態乖離→2026年4月以降を正しい仕分けで運用(過去は触らない)。
