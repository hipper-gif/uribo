# ADR-0002: TKC仕訳帳CSVの取り込みをCLIからも行えるようにし、預かり税の再計算を取り込みに含める

| 項目 | 値 |
|---|---|
| Status | `accepted` |
| 日付 | 2026-08-14 |
| Supersedes | なし（0001 の D7・D8 を運用面で補強する） |
| Superseded-by | — |
| 関連 | `frontend/scripts/tkcImportCli.ts` / `frontend/src/lib/tkcImport.ts` / `frontend/src/lib/tkcAudit.ts` / CLAUDE.md「TKC連携のイレギュラー運用ルール」 |

## Context（背景・なぜ決める必要があるか）

TKC仕訳帳CSVの取り込みは、これまでブラウザの「TKCインポート」画面（`pages/TkcImport.tsx`）でしか実行できなかった。月次の反映のたびに人が画面を開き、ファイル選択・プレビュー確認・ボタン押下という手順を踏む必要があり、**Clio（Claude Code）にCSVを渡して反映してもらう**運用ができなかった。

さらに構造的な抜けがあった。取り込みは経費（課税仕入）を書き換えるが、**預かり税 `withholding_tax`（=実質の納付税額。0001 D7）は DataEntry の保存時にしか再計算されない**。取り込み後に DataEntry を開いて保存し直さないと、預かり税が仕入控除前の値のまま残り、支出合計が過大・純利益が過小に見える。実際に 2026年度 4月・6月がその状態で残っていた（寝屋川 4月 163,377／6月 183,800 が正しくは 113,032／134,683。守口も同様。計 167,378円ぶん利益が過小表示）。この抜けは「取り込み → 別画面で再保存」という2手順に依存していたことが原因で、人が1手順を忘れれば必ず再発する。

## Decision（確定した主要決定＝1決定1行）

| # | 決定 | 理由（1行） |
|---|------|------|
| D13 | **TKC仕訳帳CSVの取り込みをCLIからも実行できるようにする**（`npm run tkc-import -- --csv <path> [--apply]`。既定はdry-run） | CSVを渡すだけで反映が終わる形にし、画面操作を人がやらなくて済むようにする |
| D14 | **CLIは判定ロジックを一切持たず、`src/lib/tkcImport.ts`（変換規則）と `src/lib/tkcAudit.ts`（異常検知）をそのまま呼ぶ**。CLIが担うのは I/O（CSV読み・DB読み書き・表示）だけ | ロジックを再実装すると正本が2つになりドリフトする。CLAUDE.mdの「イレギュラー運用ルール」を lib に直せば画面とCLIの両方に効く状態を保つ |
| D15 | **取り込みの一部として預かり税を自動で再計算し書き戻す**（DataEntry の保存時と同じ入力集合＝`is_active=1` の item のみで `calcDerivedAmount` を回す） | 「取り込み→別画面で再保存」の2手順依存をなくす。1手順にすれば忘れようがない |
| D16 | **CLIが書き戻す派生itemは `withholding_tax` だけに限定する**（`unit_price` は表示側が動的計算、`vat_purchase` は参考行だが AnnualView等のカテゴリ合計から除外されていないため書くと法定費用が二重に膨らむ） | 触っても意味がない／触ると壊れる派生には手を出さない |
| D17 | **CSV無しで預かり税だけ検算・是正できる経路を持つ**（`--recalc-only --year Y --month M`） | 過去にTKC取込だけして再保存しなかった月を後から救済でき、毎月の検算にも使える |
| D18 | **CLIのDBアクセスはSSH経由 mysql の UPSERT**（`ON DUPLICATE KEY UPDATE`。UNIQUE(store,fiscal_year,month,data_type,item)に依拠） | ブラウザ側APIは Nicolioセッション Cookie 認証でCLIから使えない。UPSERTなら何度流しても冪等で、途中失敗の後始末が要らない |

## Consequences（この決定で何が変わるか・トレードオフ）

- 良くなること: 仕訳帳CSVを渡すだけで、美容部門の月次経費の反映と預かり税の是正までが1コマンドで終わる（D13/D15）。dry-runが既定で、監査の「要対応」があると `--force` なしでは書き込まないため、画面と同じゲートがCLIにも効く。`--recalc-only` で過去月の検算ができ、実際に 2026年度4月・6月の預かり税を是正した（5月・7月は差分ゼロ＝DataEntry保存済みの月とCLIの計算が完全一致することの検算にもなった）。
- 引き受けるコスト・制約: `frontend/scripts/` は `tsconfig.app.json` の `include: ["src"]` の外にあるため **CLIは `npm run build` の型チェック対象外**（型ミスは実行時にしか出ない）。CLIの実行にはXserverへのSSH鍵（`~/.ssh/id_xserver_panel`）が要るので、鍵のない端末では動かない。TS実行は vite の依存にある jiti に相乗りしている（`jiti` が node_modules から消えると動かなくなる）。
- 同時に直した既存バグ: `tkcAudit.ts` R21（派生計算の再計算照合）が、`is_active=0` の売上細目（`cash_sales_d01_05` 等）まで課税仕入として数えていたため、課税仕入が水増しされ再計算値が常に0になり「預かり税がズレ」の誤検知が毎月出ていた。DataEntry と同じ `is_active=1` のみに入力集合を揃えて解消（ブラウザ側にも同じ修正が効く）。
- 捨てた選択肢と理由:
  - Pythonで変換ロジックを書き直す（`scripts/` の既存Python群に合わせる）→ 変換規則の正本が2つになり、CLAUDE.mdのイレギュラー運用ルールの変更が片方に反映されない事故が確実に起きるため不採用。
  - CLIから nicolio-api を叩く → beauty_* は admin/sysadmin セッション限定でトークン認証の口がなく、CLI用に口を開けるのはblast radiusが大きいため不採用（SSH経由の直接DBに寄せた）。
