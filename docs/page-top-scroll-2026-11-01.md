# PageTopNavのスクロール処理の修正

## 原因と対応

従来は各scrollイベントでフッターの `getBoundingClientRect()` を読み、固定ボタンの `bottom` に位置補正を反映していた。フッター付近を30段階スクロールする制御下の計測で、ChromiumのLayoutCountが30回増えた。

フッターの文書内座標をキャッシュし、ResizeObserver・リサイズ・pageshowで再計測する。スクロール時はスクロール量とビューポートの値だけを使い、更新を描画フレームへまとめる。表示状態と補正量が同じならDOMを書き換えない。

フッターを避ける移動は `bottom` の変更から `translate3d` へ移し、ボタンだけに `will-change: transform` を指定した。通常の下端余白、会員ページの下部ナビとの間隔、120pxの表示判定、先頭へ戻る操作は維持する。

レイアウト値の読み書きを繰り返す負荷についての参考：[Chromeチームの解説](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing)。今回の数値はこのリポジトリの修正前後を同じ条件で測定したもの。

## 検証

| 計測 | 修正前 | 修正後 |
| --- | ---: | ---: |
| scrollイベント120回でのフッター位置の読み取り（3ブラウザー） | 120回 | 0回 |
| フッター付近30段階スクロールのLayoutCount増分（Chromium） | 30回 | 0回 |

Chrome・Firefox・WebKitの関連18ケースがローカルで成功。公開12ページの390／1440px、レイアウト変更・画面リサイズ、履歴復帰・再読み込み、スムーズスクロール・動きの軽減設定、スクロール中の固定位置、会員画面320／390／430／768pxでの下部ナビ・フッターとの間隔を検証した。型検査はエラー0・警告0、ビルド成功。

数値は制御下の比較であり、端末全体のFPSを保証するものではない。実機iOSでの計測とは区別する。

## 本番反映

対象は `src/components/PageTopNav.astro`、`src/styles/PrivateMobile.css`、`tests/browser/public-controls.spec.ts` の3ファイル。本番の修正前SHA-256が一致することを確認し、最新本番から作成した隔離候補に差分だけを適用する。

リリース：`/home/ubuntu/scharade-releases/page-top-scroll-20261101`。退避先：`/home/ubuntu/scharade-backups/before-page-top-scroll-20261101`。環境設定・会員データを保持し、Webのみを切り替える。復旧は退避先の `rollback.py` を使う。

検証ログ、修正前後の計測、対象SHA-256は `/private/tmp/scharade-page-top-scroll-20261101/` に保存。最終候補の検証と本番反映結果は以下に記載する。

## 反映結果

2026-11-01 09:21 JSTに本番反映。最初の検証中に写真UIの3ファイル、続いてエラー処理の36ファイルの別更新を検知し、切り替えを止めた。それぞれを保持した本番候補へ取り込み、関連単体25件、型検査・ビルド、合成アカウントのSSR・権限確認が成功した。最終Linux成果物の関連ブラウザーテスト18件はすべて成功（失敗・スキップ・再試行0）。公開12ページのスマホ幅・PC幅、会員画面の4幅、レイアウト変動、履歴復帰、クリック・キーボード・動きの軽減設定を含む。

対象はソース2・テスト1の3ファイル。558成果物を本番と照合し、環境設定・対象外ソース・3ワーカーのPIDを保持した。旧版と環境・PM2設定を退避し、Webのみ再起動して4プロセスのonlineと、その後のPID・再起動回数の安定を確認した。会員データの移行・上書きは行っていない。

公開HTTPS6ページが200、保護6経路が未ログイン時に302、新しい共通CSSとロゴを含む14配信ファイルのSHA-256が候補と一致した。さらに本番のDisclaimerを実フォントで表示し、Chrome・Firefox・WebKitのスマホ幅で再計測。120回のscrollでのフッター位置読み取り・ボタンの不要な書き換えはいずれも0、フッターとの位置誤差は0px。Chromiumで30段階スクロール中のLayoutCount増分も0だった。実会員のログインや試験データの本番書き込みはせず、ブラウザーのPOSTは検証側で遮断している。

証跡はリリース内の `deployment.json`、`browser-validation.json`、`live-verification.json`、`live-scroll-performance.json` と、ローカルの `before.json`・`after.json`・`linux-latest-browser.log`・`release-record.json` に保存した。
