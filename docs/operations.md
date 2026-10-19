# VPS運用・公開・バックアップ・復旧

最初に[引き継ぎ書](handover.md)で担当範囲と保存先、[機能別ファイル対応表](file-guide.md)で修正対象を確認してください。本番パス・過去の移行記録は担当交代時にVPSの実設定と照合します。

## 環境変数

実際の値は `.env` に置き、所有者だけが読める権限（600）にします。公開情報と秘密キーを区別してください。`.env.example` が項目の一覧です。

| 変数                                      | 用途                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| SITE_URL                                  | 本番の正規URL。申請・再設定メールのリンク                              |
| HOST / PORT                               | Nodeの待受。通常127.0.0.1 / 4321                                       |
| DATA_DIR                                  | 会員・セッション・編集内容等の永続保存先。現在の本番は /home/ubuntu/scharade-data |
| TRUST_PROXY                               | Nginx経由だけで到達でき、X-Real-IPを上書きしている場合のみ1            |
| PUBLIC_GOOGLE_MAPS_API_KEY                 | About usの地図。ブラウザに公開されるキー。変更後は再ビルドが必要       |
| MICROCMS_SERVICE_DOMAIN                   | microCMSのサービスID                                                   |
| MICROCMS_SERVER_API_KEY                   | Hobby向けの新しいサーバー専用キー。blog/card_imageはGET、PortfolioはGET/POST/PATCH/DELETE、Managementはメディアアップロードとコンテンツの取得（一覧・詳細）だけ |
| MICROCMS_PORTFOLIO_ENDPOINT / GRADE_FIELD | 通常portfolio / grade                                                  |
| ADOBE_CLIENT_ID / CLIENT_SECRET           | Adobe OAuth                                                            |
| ADOBE_REFRESH_TOKEN                       | 初回認証用。更新後はadobe-auth.json側が優先                            |
| LIGHTROOM_CATALOG_ID                      | Lightroomカタログ                                                      |
| SIGNUP_REVIEW_SECRET                      | 申請承認URLの署名・登録メール確認コードのHMAC。32文字以上の鍵が必須 |
| GALLERY_SIGNING_SECRET                    | 写真所属証明・追加読込カーソルの署名。独立した32文字以上の鍵が必須    |
| MFA_ENCRYPTION_KEY                       | メール二段階認証コードのHMAC鍵。64桁hex、会員データと分けて保管（既存の変数名・鍵を維持） |
| GMAIL_PASS                                | contact@scharade.jpのメール送信用アプリパスワード                      |
| INSTAGRAM\_\*                             | 旧連携を利用する場合のみ。新規会員の自動承認はしない                   |
| ACCOUNTING_GAS_URL / ACCOUNTING_WEBHOOK_SECRET | 会計受付GASと署名鍵。`gas/intake/` 側と一致させる |
| EXHIBITION_GAS_URL / EXHIBITION_WEBHOOK_SECRET | 写真展Forms連携GASと署名鍵 |
| EXHIBITION_DRIVE_GAS_URL / EXHIBITION_DRIVE_WEBHOOK_SECRET | 写真展Drive連携GASと署名鍵。旧フォーム用入口と用途を分ける |
| PUSH_DELIVERY_ENABLED / EXPO_ACCESS_TOKEN | 配信有効化フラグとサーバー専用Expoトークン。初期値は配信無効 |
| APPLE_TEAM_ID / ANDROID_APP_SIGNING_SHA256 | 公開アプリ関連付け情報。AndroidはPlayのアプリ署名証明書を使う |

シークレットは `openssl rand -hex 32` などで個別に生成し、パスワードマネージャーに保存します。ドメインやキー変更後はビルドとPM2再起動を行ってください。Adobeトークンの期限は現行IMS v3の秒単位を扱い、旧Lightroomのミリ秒応答も互換処理します。[Adobe IMS公式仕様](https://developer.adobe.com/developer-console/docs/guides/authentication/UserAuthentication/ims)

## アカウント削除に必要なmicroCMS権限

Content APIのPortfolioに対するDELETE権限に加え、Management APIの「コンテンツの取得（一覧・詳細）」を有効にします。後者は、削除の再試行時に「削除済み」と「下書き・非公開」を区別するために使用します。

microCMSサービスの左側「○個のAPIキー」から新しいサーバー専用キーを設定します。Hobbyプランの上限1個を維持するため、用途別の鍵分離は行えません。デフォルトのContent API権限はすべて無効にし、blog/card_imageのGETとPortfolioのGET/POST/PATCH/DELETEだけを個別に許可します。Management APIでは画像アップロードと「コンテンツの取得（一覧・詳細）」だけを許可します。旧キーの露出に対する切替と最小権限は[セキュリティ対策記録](security-hardening.md)を参照してください。Content API側の下書き・非公開コンテンツの全取得は有効にしません。[APIキーの公式説明](https://document.microcms.io/content-api/x-microcms-api-key)、[メタ情報取得に必要な権限](https://document.microcms.io/management-api/get-content)。

Content APIの400・404だけでは削除済みと判断しません。削除済み確認にはManagement APIの一覧取得成功と対象詳細の404が必要です。403の場合は権限、400で対象が残る場合はDELETE権限・ほかのコンテンツからの参照を確認します。失敗時にアカウントが残るのは、Portfolioの削除漏れを防ぐためです。

運営・管理者はログイン時に二段階認証が必要です。セキュリティ切替時の強制再設定・旧セッション失効・復旧手順は[セキュリティ対策記録](security-hardening.md)を優先してください。

## 初回の移行（既存会員データを守る）

1. 作業前に現在のGitコミット、PM2設定、Nginx設定、.env、既存.dataの所在を記録する。内容を公開リポジトリへ貼らない。
2. `pm2 stop astro-site` で書き込みを止める。
3. 既存の.data全体と.envを、アクセス制限した保存先へコピーする。
4. 永続ディレクトリを作り、**現在のusers.json・sessions.json・adobe-auth.json等をまとめて移す**。新しい空のusers.jsonで上書きしない。
5. PM2実行ユーザーが所有し、ディレクトリ700、JSON600にする。
6. .envのDATA_DIRをその絶対パスへ変更する。開発用のテストデータを本番へコピーしない。
7. 新コードをビルドし、PM2設定を確認して起動する。
8. 既存の一般会員でログイン可能か確認してから `yarn admin:create` で専用管理者を作る。

既存会員のrole欠落はmemberとして読まれるため、一括編集は不要です。管理者用のmicroCMSフィールド（generation、role、isExecutive、displayOrder）が存在するか確認します。

## 通常の公開手順

2026-10-10に秘密情報を除去するためGitHubの履歴を差し替えています。それ以前のcloneで以下の`git pull`を実行しないでください。既存の環境ファイル・本番データ・未保存の変更を保全してから、新しい履歴でcloneし直します。今回のセキュリティ反映には[セキュリティ対策と反映記録](security-hardening.md)の切替手順を使います。

ここでのコマンドはVPS上のリポジトリ直下で実行します。リポジトリの絶対パスやブランチは実環境に合わせてください。

```sh
git status --short
git rev-parse HEAD
git pull --ff-only
yarn install --frozen-lockfile
yarn test
yarn build
pm2 restart astro-site --update-env
pm2 status
pm2 logs astro-site --lines 50 --nostream
```

変更前のコミットIDを復旧用に控えます。作業ツリーに変更がある場合は、内容を確認するまでpullしません。ビルドまたはテストが失敗したら再起動しません。`git pull --ff-only` は予期しないマージを避けます。PM2設定を本リポジトリのものに初めて揃えるときは `pm2 start ecosystem.config.cjs`、既存登録との二重起動を避けてください。

本番PM2は単一forkを推奨します。ファイル保存は複数プロセスでも直列化しますが、microCMSキャッシュはプロセスごとで、複数workerでは更新反映まで最大60秒かかります。

### Web以外のPM2ワーカー

上の例はWebのみの再起動です。`ecosystem.config.cjs` は `astro-site` に加え、`scharade-accounting-worker`（立替再送）、`scharade-exhibition-worker`（写真展連携・転送・通知）、`scharade-push-worker`（リマインダー・プッシュ配信）を定義します。共有ライブラリやワーカーの変更時は `pm2 status` で起動済みの名前を確認し、該当プロセスも `pm2 restart <名前> --update-env` で再起動します。構成変更後は稼働を確認して `pm2 save` します。

新規ワーカー導入と本番通知の有効化は別作業です。設定にあることだけで起動済み・配信確認済みとは判断しません。起動対象の確認なしに全定義を追加して重複起動しないでください。

### SEOの反映確認

新規の公開固定ページは `src/data/publicPages.ts` へ追加します。公開後に `/sitemap` の案内、`/sitemap.xml` のURL・更新日時・公開範囲、`/robots.txt` のSitemap行とアクセス設定を確認します。記事・Portfolio・Galleryの収集失敗時はその系統が省略されるため、XMLが200でもURL数と主要URLを確認してください。

Search Consoleの所有権を持つ担当者がサイトマップレポートで `https://scharade.jp/sitemap.xml` を送信し、読み込み結果・エラーを確認します。個別の更新はURL検査で確認します。会員・管理・企画共有URLを掲載対象に広げません。検索掲載の判断は検索エンジン側にあり、コミット・デプロイ・登録だけで掲載完了とは扱いません。

公開後に確認するもの：

- Home、About us、Gallery、Portfolio、Activity、Contactが表示される。
- 一般会員のログイン、登録名の挨拶、本人Portfolioリンク、ログアウト。
- 管理者で下書き保存・プレビュー。一般ユーザーには下書きが見えない。
- 公開アルバム／会員限定アルバムのログイン有無による違い。
- 問い合わせ送信は担当者が承認したテスト内容で1件だけ実施し、実際の受信を確認。
- PM2ログに継続的な5xx・認証エラーがない。

## Nginxの確認

既存のTLS証明書設定は維持し、Nodeを直接インターネットへ露出させません。以下はlocation部分の例です（実環境のポートに合わせる）。

```nginx
client_max_body_size 21m;
location / {
    proxy_pass http://127.0.0.1:4321;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 60s;
}
```

**HTML・/api/・/Admin/にproxy_cacheを適用しない**でください。特にユーザー別の挨拶や会員限定画像を共有キャッシュへ保存してはいけません。設定変更後は `sudo nginx -t` が成功してからreloadします。圧縮配信はNginx側でテキスト・CSS・JS・SVGに適用できます。アップロードを許可する最大サイズはアプリ側20MB、プロキシ側はmultipartの余白を含め21MBです。

## バックアップ

### 対象

- DATA_DIR全体（会員・セッション・MFA・登録確認・再設定、サイト情報、Adobe認証、活動・通知キュー・端末、写真展設定・原本・出力・履歴、立替受付・領収書、監査記録等）。列挙漏れを避け、ディレクトリ全体を保全する
- .env、PM2/Nginx設定、デプロイしたGitコミットID
- microCMSのコンテンツ・メディア
- Lightroomの元写真とアルバム構成（サイトのバックアップだけでは原本を保存できない）

### 手順と世代

少なくとも変更前・毎日・年度交代前に取得します。日次7世代、週次4世代、月次12世代を目安に担当者が容量に合わせて決めます。実行環境への定期ジョブ登録は別途必要です。この実装だけではバックアップは自動実行されません。

整合性を確保するため、`pm2 status` で書き込み元を確認し、Web・会計・写真展・プッシュのうち稼働中のプロセスと同じDATA_DIRを使うCLIをすべて停止して、DATA_DIRと.envをコピーし、元のプロセスを再開します。Webだけ止めてもワーカーから書き込まれます。tar等でまとめる際は所有者だけが読み書きできる場所に保存し、暗号化してVPS以外にも保管します。バックアップには個人情報・認証キーを含むため公開リンクを作らないでください。エクスポート後は容量・展開可否・取得日を記録します。

## 復旧

1. PM2を停止する。**現在の壊れた可能性があるデータも別名で退避**する。
2. 復旧対象としたバックアップを一時ディレクトリへ展開し、JSONが読めること、件数を確認する。
3. DATA_DIR全体を同じ時点のセットで復元し、所有者・権限を戻す。
4. 必要なら控えたコードのコミットへ戻して再ビルドする。知らないコミットへ推測で戻さない。
5. PM2起動後、ログイン・写真取得・管理画面を確認する。
6. セッションの侵害が疑われる場合は、停止中にsessions.jsonを空配列にして全員をログアウトし、管理パスワードと該当キーを変更する。

サイト情報だけの誤操作は、管理画面の前の公開版への復元を先に使います。コードだけ戻す場合も、今回追加したroleやsite-contentを旧コードがどう扱うか確認します。

### ロック残留

強制終了で `*.lock/` が残ると、保存は10秒後に失敗します。稼働中に削除すると同時更新を壊すため、自動解除しません。

PM2と同じDATA_DIRを使うCLIを**すべて停止**し、ロック内owner.jsonのPIDが実行中でないことを確認します。そのロックディレクトリだけを削除し、JSONを確認して再開します。users.json等の本体を削除してはいけません。

## よくある障害

| 症状                           | 確認箇所                                                       |
| ------------------------------ | -------------------------------------------------------------- |
| ログインできない               | usersの所在、approved、DATA_DIRが以前と同じか、PM2実行ユーザー |
| 管理画面が403                  | 専用管理アカウントでログインしたか。Portfolio役職とは別        |
| 編集が409                      | 他タブで先に保存。再読み込みして統合                           |
| 写真アップロードが失敗         | 20MB以下か、RAWでないか、Management APIメディア権限            |
| Gallery全体が取得失敗          | Adobe refresh token、カタログID、Adobe側の認可・接続           |
| 長時間閲覧後に写真だけ失敗     | 写真URLの1時間期限。ページを再読み込み                         |
| 保存できない・10秒程度でエラー | DATA_DIR権限、空き容量、残留lock、JSON破損                     |
| メール未着                     | Gmailのアプリパスワード、送信制限、迷惑メール、PM2ログ         |
| 更新が戻ったように見える       | 下書きと公開版の違い、DATA_DIR相違、別PM2プロセス              |

ログへ秘密キー、パスワード、リセットURLを記録しないでください。audit.jsonlは日時・実行者ID・操作・対象を記録し、本文やパスワードは記録しません。保存期間はサークルの運用方針で決めて定期的に保管・整理してください。
