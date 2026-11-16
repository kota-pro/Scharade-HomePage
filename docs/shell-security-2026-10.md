# React2Shell・HTTP2Shell対策（2026-10-26）

## 対象と判断

本番はAstro 7.3.8 / @astrojs/node 11.1.7で、RSCを使わない。依存ロックにもReact / Next.js / react-server-dom-*は含まれず、React2Shell（CVE-2025-55182）の対象外。

HTTP2Shell / Node2Shell（CVE-2026-111497）はBrotliデコーダーの境界外書き込みで、HTTP/2固有の問題ではない。NodeのfetchもBrotli応答を自動展開するため、CMS・Adobe・Google連携などの送信側が対象になる。要求のbr拒否やAccept-Encodingの変更だけでは送信側を保護できない。

本番確認時はWeb・会計・写真展・プッシュの4プロセスがNode 22.23.1、PM2 7.0.1のデーモンがNode 24.18.0を使用。systemdの自動起動も旧24系のPM2を指し、enabled / inactiveだった。

## コード側の対策

- Nodeの要件は `>=22.23.4 <23`、`.nvmrc`は22.23.4。
- 共通ランタイム判定をAstro設定・SSR・PM2のpreload・ワーカー・管理CLIで実行する。古いNodeで処理を開始しない。事前検証は引き続きJSONで失敗理由を返す。
- API要求のBrotli一律拒否は同日14:38 JSTに解除。修正済みNodeのデコーダーでbr / gzip / deflateを展開し、既存のJSON・フォーム・画像アップロード処理へ渡す。圧縮前後と各展開段階に容量制限を適用し、認証・Origin・回数制限を維持する。
- 公式Node 22.23.4のBrotli表示は1.1.0だが、修正はバックポート済み。Brotliの表示バージョンだけで未修正と判断しない。

## Brotliの通常受付（同日14:38 JST追記）

所有者の指示により、追加防御として導入したBrotli本文の一律415拒否を解除した。Node 22.23.4にCVE-2026-111497の修正がバックポートされていることを公式告知と稼働中プロセスで再確認。Brotli表示は1.1.0のままだが、修正されたデコーダーのエラー定数も確認した。独自ビルドや別の未検証ランタイムへの置換は不要。

Content-Encodingは大文字小文字を区別せず、複数の圧縮は指定の逆順に最大3段まで展開する。送信時の容量と各展開結果を、通常APIは512 KiB、アップロードは21 MiB以下に制限する。アップロード先の既存の個別上限も適用される。壊れた圧縮は400、容量超過は413として扱う。応答の圧縮設定は変更していない。

ローカルの型検査・ビルド、関連単体34件、Chromium / Firefox / WebKitの18件が成功。Linux隔離環境でも関連単体34件と、圧縮JSON・URLエンコードフォーム・画像multipart・通常ログイン・必須MFA・写真展保存を合成データで確認した。

14:38 JSTにWebのみを再起動して反映。526配信ファイルと対象ソースの一致、公開ページ200、会員APIの未認証401、管理画面302を確認した。公開HTTPSでは空のログイン入力を圧縮して送り、br / BR / gzip, br / br, gzipのすべてが非圧縮時と同じ通常の必須項目エラー400になることを確認した。実会員の認証情報による本番ログインや外部への送信は行っていない。

環境設定・対象外ソースを維持し、3ワーカーは停止せず稼働を継続。退避先は `/home/ubuntu/scharade-backups/brotli-support-20261026T053822Z`、検証記録は `/home/ubuntu/scharade-releases/brotli-support-20261026/reports/`。初回は検証スクリプトのHTTPヘッダー名の大文字小文字の扱いで失敗判定となり自動復旧し、判定修正後に再適用した。

## ローカルのNext.js試作

`next-app/`は本番未使用でGit管理対象外。所有者の指示でNext 15.5.28、React / React DOM 19.1.10に固定し、専用Yarn lockを作成。Nodeの要求版と共通起動チェックも適用した。2026-10-14のRSC関連修正も含める。非同期params、戻るリンク部分のSuspense、Reactの型定義を整える。

この試作は新しいcloneには含まれない。実体とlockは別途保全し、Astro本番へ混ぜて配布しない。

## 反映と復旧

本番ソースの隔離コピーへ今回の差分だけを適用する。ビルドには公開Maps設定のみを渡し、会員データ・秘密設定は複製しない。切替時には4プロセスを停止して永続データを整合性のある状態で退避する。環境設定と既存ソースを保全し、PM2の実行ファイル・保存構成・systemd・nvm既定版を照合する。

復旧は修正版Nodeを維持して旧アプリ成果物を使う。旧ランタイムへ戻す手順を通常の復旧手段にしない。適用結果は [2026年10月の公開記録](deployment-2026-10.md) を参照。稼働中の4プロセスとPM2本体は22.23.4へ切替済み。2026-10-26 14:19 JSTにsystemdの自動起動設定も適用し、active / enabledと修正版Nodeでの復元を確認済み。14:21 JSTの最終検証で526配信ファイルの一致、公開HTTPS、Brotli拒否、外部連携ready=trueを確認した。

## 公式情報

- [React2Shell公式告知](https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components)
- [Node.js 2026-10-21セキュリティ更新](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
- [Node.js 22.23.4のバックポート内容](https://nodejs.org/en/blog/release/v22.23.4)
- [Google Brotli 1.2.1](https://github.com/google/brotli/releases/tag/v1.2.1)
- [HTTP2Shellの解説・緩和策](https://www.aikido.dev/blog/python-packages-vulnerable-node2shell-brotli-cve-2026-111497)
- [Next.js 2026-10-14更新](https://nextjs.org/blog/nextjs-security-update-october-14-2026)
- [React RSC追加修正](https://github.com/react/react/security/advisories/GHSA-xqc2-xf4c-x3h3)
