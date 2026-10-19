# Scharade iOS・Androidアプリ

`mobile/`はExpo SDK 58／React Nativeを使用する共通アプリです。既存Astroサイトのログインと機能をWebViewで利用し、ネイティブの通知一覧・設定・戻る操作・ファイル保存／共有を追加します。Member・Staff・Adminの権限とデータの正本は既存サーバーにあります。

2026-10-19時点：サーバー側は本番反映済みで、Nginxのアプリリンク用経路も所有者による適用が完了しました。Expoプロジェクトは`@scharadejp/scharade`へ接続済みです。FirebaseのAndroid設定を検査し、EASのproduction環境へFile変数として登録しました。通知用サービスアカウントのFCM V1キーをExpoへ登録し、Androidの署名済みAABのビルドも成功しました。保存できなかった旧キー2本は削除済みで、登録した新キー1本だけがActiveであることを確認しています。iOSの署名・APNs、Apple／Googleのストア設定、実機確認・ストア提出は未完了です。本番の通知配信は停止しています。

2026-10-19のGit整理により、アプリ本体 `mobile/` と `.easignore`、アプリ専用の補助スクリプト・ネイティブテストはWebリポジトリの管理対象外です。この資料と関連資料はWeb連携の説明・過去の作業記録として残します。ネイティブ開発手順には別途保管したアプリ本体が必要で、Webのcloneだけでは実行できません。

## 開発・検証

Node.js 22.13以上の22系とYarn 1.22を使用します。Web側とmobile側にそれぞれ独立したpackage.json・yarn.lockがあります。

```sh
yarn install --frozen-lockfile
yarn run check
yarn test
yarn build
yarn run test:browser tests/browser/mobile-app.spec.ts
cd mobile
yarn install --frozen-lockfile
yarn run lint
yarn run check
yarn run bundle
yarn run prebuild:check
```

`bundle`の成功は両OSのJavaScript/Hermesバンドル生成の確認です。`prebuild:check`はネイティブプロジェクトと設定プラグインの生成を確認します。署名済みIPA/AABのコンパイルや実機での動作確認とは区別します。生成したios/・android/・build/はGit管理外で、app.config.tsから再生成します。

EASの送信対象はリポジトリ直下の`.easignore`（ローカル設定、WebのGit対象外）で`mobile/`本体へ限定します。Web用ソース、`mobile/scharade/`の別アプリ、依存・生成物・ローカル設定・署名情報を除外します。[Expo公式の除外設定](https://docs.expo.dev/build-reference/easignore/)に従い、ネイティブディレクトリを送らずクラウド側で生成します。Firebaseの`google-services.json`はEASのFile変数から渡します。

開発ビルドはExpo Goではなくexpo-dev-clientで使用します。`APP_VARIANT=development`でアプリIDは`jp.scharade.app.dev`になり、ストア版の`jp.scharade.app`と区別できます。開発・preview環境には、本番会員と分離したHTTPSの接続先を`EXPO_PUBLIC_SITE_URL`へ設定してください。ローカルのブラウザーテストは一時DATA_DIR・架空アカウント・模擬SMTPと外部サービスを使います。

## アカウント所有者が準備するもの

画面操作・コマンド・設定の保存先を含む[所有者向けの詳細手順](mobile-owner-setup.md)を参照してください。

1. Apple Developer ProgramとGoogle Play Consoleに登録し、本人／団体確認・必要な契約と支払いを完了します。これらはアカウント所有者が行います。
2. Expo/EASの所有者とProject IDは確認・設定済みです。所有者は`scharadejp`で、`EXPO_PUBLIC_EAS_PROJECT_ID`でのID上書きも可能です。Firebaseプロジェクトは所有者のアカウントで用意します。
3. FirebaseにAndroidアプリ`jp.scharade.app`を登録します。取得したgoogle-services.jsonをGit管理外の`mobile/google-services.json`、またはEASのファイル環境変数`GOOGLE_SERVICES_JSON`へ設定します。開発版は`jp.scharade.app.dev`用に別登録し、開発環境の同じ変数へ対応する設定を指定します。
4. EASでAndroidのFCM v1サービスアカウントとiOSのAPNsキー・署名証明書・Provisioning Profileを設定します。秘密鍵・サービスアカウントはGitやチャットに貼りません。
5. ExpoのEnhanced Push Securityを有効にし、サーバーだけに`EXPO_ACCESS_TOKEN`を設定します。
6. Apple Team IDをWebサーバーの`APPLE_TEAM_ID`へ、Google Playの**アプリ署名鍵**のSHA-256フィンガープリントを`ANDROID_APP_SIGNING_SHA256`へ設定します。後者にアップロード鍵を使わないでください。複数ある場合はカンマ区切りです。

```sh
cd mobile
yarn run release:check
npx eas-cli@latest build --profile development --platform all
```

2026-10-19にFirebase設定の配置とproduction用File変数`GOOGLE_SERVICES_JSON`の登録が完了し、`release:check`は成功しました。FCM V1資格情報とAndroid KeystoreもExpoへ登録済みです。Androidのproductionビルド（1.0.0、versionCode 2）は同日15:15:17 JSTに成功しました。[EASのビルド結果](https://expo.dev/accounts/scharadejp/projects/scharade/builds/0bf438bf-b7cc-4576-829a-3a1e89fa2ea3)から取得したAABは`mobile/build/scharade-1.0.0-2.aab`に保存しています（48,948,191バイト、SHA-256 `7ac4eeddce019454445eda1c213d925e35f9d443fbd0eca5c197680743529eb3`）。ZIPの整合性と、含まれる署名証明書のSHA-256がExpoのKeystoreと一致することを確認しました。追加でOpenSSLによるPKCS7署名検証、署名対象マニフェストと全1,284コンテンツのSHA-256照合に成功しました。署名対象外のコンテンツは0件です。署名者はExpoのKeystoreの証明書フィンガープリントと照合しています。

AABはGoogle Playへの提出用です。テスト配布と実機確認、iOSの署名済みビルドは引き続き必要です。Google Playのアプリ署名鍵は、このAABのアップロード鍵とは別に確認します。

所有者からApple DeveloperとGoogle Play Consoleは未登録・確認中との回答を受け、ストア登録前の検証用ビルドも作成しました。`device-test`のAndroid APK（1.0.0／2）は17:37:09 JST、`ios-simulator`のiOSアプリ（1.0.0／1）は17:33:02 JSTに成功しています。APKは`mobile/build/scharade-device-test-1.0.0-2.apk`、iOSシミュレーター用アーカイブは`mobile/build/scharade-ios-simulator-1.0.0-1.tar.gz`に保存済みです。Androidは署名・内容の照合、iOSはアーカイブ・アプリ識別情報の照合まで完了しました。端末へのインストール・起動・通知受信は未確認です。

## 本番のアプリリンク設定

Nginxのドットパス保護を維持しながら、`/.well-known/apple-app-site-association`と`/.well-known/assetlinks.json`の2件だけを例外にする設定を`deploy/security-nginx.conf`へ追加しました。最初に一致する正規表現を使う[Nginxのlocation規則](https://nginx.org/en/docs/http/ngx_http_core_module.html#location)に従い、この例外を保護ルールより前へ置いています。

VPSの通常ユーザーで動かした隔離Nginxで、構文と7経路を検証しました。2026-10-19 13:13 JST、所有者の実行ログで修正版の本番適用と8経路の成功を確認しています。通常の再適用は不要です。以下は再設定時のコマンドです。設定ハッシュが作成時と違う場合は上書きせず停止し、構文検査・再読み込み・HTTP確認に失敗した場合は元へ戻します。

2026-10-19の初回適用ではHTTP確認で404となり復元しました。確認処理を反映待ち付きへ修正し、所有者が修正版を転送して再適用を完了しました。確認処理の回帰テストは`node --test tests/mobile-app-links.test.mjs`で実行できます。

```sh
sudo bash /home/ubuntu/scharade-releases/mobile-20261018-1792268240030/deploy/enable-mobile-app-links.sh
```

適用後、所有者設定が未入力の間は2件とも503のJSONを返すのが正しい状態です。Apple Team IDとGoogle Playアプリ署名鍵の設定後には、200の関連付けJSONと署名済み実機でのリンク起動を確認してください。`.env`・`.git`や他の非公開パスは404のままです。

## 通知ワーカーと保存データ

- `push-devices.json`：端末秘密情報のハッシュ、所有会員・認証バージョン、Expoトークン、通知設定。最大10端末／会員。パスワードやCookieの値は保存しません。
- `member-activities.json`の任意の`push`：通知ごとの永続送信キューとリマインド予約。既存version 1と互換で、過去の通知を再送しません。
- `account-deletion-requests.json`：メール所有確認、削除申請、運営の処理状態、完了メールの再試行。コードはハッシュ化し、完了メール送信後に連絡先と確認用の保存先一覧を消去します。

PM2の`scharade-push-worker`が30秒ごとに動きます。`PUSH_DELIVERY_ENABLED=0`が初期値です。APNs/FCMとテスト端末の検証後に1へ変更します。削除完了メールの再試行は、このフラグとは独立して実行します。既存のDATA_DIRバックアップへ追加ファイルも含めてください。

通知は件名と通知IDだけをOSへ送り、本文は含めません。通知詳細を開いた時点で既読になります。端末をログアウトすると登録を解除します。承認取消・権限変更・パスワード再設定後は、古い認証バージョンの端末へ送りません。送信リトライは内部IDで重複を抑えますが、プロバイダー側の重複・遅延・不達を完全には排除できません。履歴はサイト内通知を正本としてください。

リマインドは、企画の未回答者へ締切24時間前、参加者へ開催24時間前、写真展の未回答者へ投票締切24時間前、参加者のうち未提出者へ提出締切24時間前に生成します。送信直前にも最新の状態を確認します。直前公開分の過ぎた予約時刻は遡って送らず、保存済み予約の実行が遅れた場合は締切・開始前に限って再試行します。日付はUTC保存・日本時間表示です。

Adminの「プッシュ通知の配信状況」で待ち・receipt・失敗を確認できます。receipt成功はApple/Googleへの引き渡しを示し、実機での受信・閲覧を示しません。失敗コードとワーカーログから資格情報や端末の状態を確認してください。

## 削除申請の運用

`/AccountDeletion`はログイン前から利用できます。承認待ち・ログイン不能でも、登録メールの所有確認後に申請できます。Memberの安全設定とアプリの設定からもアクセスできます。

Adminは申請一覧を毎日確認し、**申請から7日以内**に処理します。

1. 対象を確認して「削除処理を開始する」を押します。ログイン・通知を停止し、ローカルの提出データ・写真・領収書を削除し、班の共有履歴を匿名化します。この処理は再試行できます。
2. 開始後15分は待ち、進行中の外部送信が終了してから外部データを確認します。表示される識別子・保存先を使い、Google Forms/Sheets/Drive、Lightroom、microCMS画像原本、会計側、名簿の参照元、バックアップを確認してください。共有する出力を除去した場合は、残るメンバーのデータから再生成します。
3. すべての確認欄と対象メールアドレスを確認して確定します。既存の削除処理でアカウント・Portfolioを削除し、完了メールをキューへ登録します。完了メール失敗時はワーカーが再試行します。

自分の申請を自分で処理できません。最後の管理者は先に別の管理者へ引き継いでください。外部データ・バックアップの確認が終わる前に完了扱いにしないでください。

## ストア提出物と実機確認

表示名：Scharade。アイコン：既存カメラロゴ。[プライバシーポリシー](https://scharade.jp/AppPrivacy)と[削除申請](https://scharade.jp/AccountDeletion)は本番で公開済みです。

審査用の架空データ・会員／運営／管理者アカウントと二段階認証の確認手順を用意します。本番の実会員データや共有管理者のパスワードを審査に使いません。スクリーンショットは署名済みアプリの実機／シミュレーターで撮影します。WebViewのブラウザー画像を実機アプリの確認として扱いません。

ストアのデータ申告では、アカウント情報、名簿属性、活動・参加回答、写真・提出物、立替・返金情報、通知用の端末識別子など、既存機能を含めた実際の取扱情報を確認します。広告・トラッキング用の識別子を追加する実装はありません。

実機では両OSについて、初回許可・拒否・OS設定からの再許可、使用中・バックグラウンド・終了中の受信、通知タップ、認証後の復帰、既読、複数端末、ログアウト、写真選択、画像コピー、PDF/PNG/ZIP保存と共有、写真展のタッチ操作、Adminの編集・公開を確認します。

インストールする形式、確認する操作、期待結果と両OSの未実施項目は[アプリの端末確認票](mobile-device-validation.md)に記録します。ストア登録を待つ間は`device-test`のAndroid APKと`ios-simulator`のiOSシミュレーター用ビルドを使用します。いずれもproduction環境の本番サイトへ接続します。

参照：[Expo通知設定](https://docs.expo.dev/push-notifications/push-notifications-setup/)、[Expo配信仕様](https://docs.expo.dev/push-notifications/sending-notifications/)、[Apple削除要件](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)、[Google Play削除要件](https://support.google.com/googleplay/android-developer/answer/13327111?hl=ja)。
