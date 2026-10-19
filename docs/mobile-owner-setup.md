# アプリ公開のための所有者設定手順

確認日：2026-10-19。現在のScharadeのコードと、Expo・Firebase・Apple・Googleの公式資料に合わせた手順です。所有者の承認後に実施したFirebase・Expoの資格情報設定とAndroidビルドの結果も記録しています。Apple・Googleの開発者登録、契約・支払い、ストア提出は未完了です。

先にVPSのNginx修正とExpoへのログインを済ませ、その後にFirebase・Apple・Googleの設定を進めると引き継ぎやすくなります。途中で止まっても、完了した項目から引き継げます。

## 1. 登録するサービスとアプリID

| サービス | 用途 | 所有者が行うこと |
| --- | --- | --- |
| Expo / EAS | iOS・Androidのビルド、署名情報の管理、通知中継 | アカウント作成と、このMacでのCLIログイン |
| Firebase | Androidへの通知配信（FCM） | プロジェクト作成とAndroidアプリ登録 |
| Apple Developer | iOSの署名、通知、App Store配布 | 本人／団体確認・契約・支払い |
| Google Play Console | Google Play配布とアプリ署名 | 本人／組織確認・契約・支払い |

Appleは年額99米ドルが基準で、地域により現地通貨の料金が表示されます。Google Playは25米ドルの一回払いです。決済画面の表示を確認してください。[Apple登録](https://developer.apple.com/programs/enroll/)、[Google登録](https://support.google.com/googleplay/android-developer/answer/6112435?hl=ja)。

サークルで継続管理できる所有者を決めてください。Appleの組織登録には契約主体になれる法人・D-U-N-S番号などが必要です。サークル名があるだけで組織登録できるとは限りません。個人登録と組織登録の条件を確認して選びます。

このコードで使用するIDは次のとおりです。

| 種類 | iOS Bundle ID / Androidパッケージ名 | EASプロファイル |
| --- | --- | --- |
| ストア版・配布確認版 | `jp.scharade.app` | `production` / `preview` |
| 開発版 | `jp.scharade.app.dev` | `development` |

以下ではまず`jp.scharade.app`を設定します。後でdevelopmentビルドを使う場合は、FirebaseとAppleにも`.dev`を別登録し、EASのdevelopment環境へ対応する設定を置きます。

## 2. VPSのNginx修正

このサイトでは2026-10-19 13:13 JSTに所有者が適用を完了しました。実行ログはHome 200、関連付け2件503、非公開経路5件404で、期待値に一致しています。通常の再実行は不要です。以下は初期設定・再設定時の手順として残しています。

2026-10-19に、初回版が再読み込み直後の404を一度で失敗判定して復元する問題を修正しました。Nginxは新旧ワーカーを切り替えるため、再読み込み要求が成功しても新設定の応答がまだ得られない場合があります。[Nginxの設定変更](https://nginx.org/en/docs/control.html)。修正版は反映を一定時間待って確認し、404が続く場合の失敗・復元は維持します。

初回版で`Unexpected association response: 404`と出た場合、同じファイルをそのまま再実行せず、まずMac上の修正版を転送してください。2026-10-19の修正時は、自動承認レビューのモデル混雑により、こちらからの転送が実行されていません。

Macの新しいターミナルで実行します（VPSの`ubuntu@...`の画面ではありません）。

```sh
scp -i /Users/kofizeri/.ssh/id_ed25519_sakura /Users/kofizeri/Desktop/VScode/Scharade-HomePage/deploy/enable-mobile-app-links.sh ubuntu@160.16.217.93:/home/ubuntu/scharade-releases/mobile-20261018-1792268240030/deploy/enable-mobile-app-links.sh
```

### MacからVPSへ接続する

Macの「ターミナル」で実行します。

```sh
ssh -i /Users/kofizeri/.ssh/id_ed25519_sakura ubuntu@160.16.217.93
```

秘密鍵のパスフレーズを聞かれた場合は、その鍵のパスフレーズを入力します。接続後のプロンプトが`ubuntu@...`になればVPS上です。

### sudo認証と適用

VPS上で順番に実行します。

```sh
sudo -v
sudo bash /home/ubuntu/scharade-releases/mobile-20261018-1792268240030/deploy/enable-mobile-app-links.sh
```

`[sudo] password for ubuntu:`には、VPSのubuntuユーザーのパスワードを入力します。MacのログインパスワードやSSH秘密鍵のパスフレーズとは別です。入力中に文字や点が表示されなくても、そのまま入力してEnterを押します。

このスクリプトは変更前の設定ハッシュを確認し、バックアップを作り、アプリ関連付けURL2件だけを例外にします。HTTP確認では新しい接続で応答を取り直し、反映まで20秒程度待ちます。構文検査・再読み込み・HTTP確認のいずれかに失敗した場合は元へ戻します。2026-10-19の復元後の読み取り確認でも、現行設定のハッシュは適用対象のものと一致しました。

成功時の表示例：

```text
nginx: configuration file /etc/nginx/nginx.conf test is successful
apple-app-site-association: 503
assetlinks.json: 503
App association routing enabled. Backup: ...
```

この段階の503は、Apple Team IDとAndroid署名情報が未入力であることを示します。関連付け用の2件に限れば想定どおりです。値を設定した後は200になります。

### HTTPを確認する

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://scharade.jp/
curl -s -o /dev/null -w '%{http_code}\n' https://scharade.jp/.well-known/apple-app-site-association
curl -s -o /dev/null -w '%{http_code}\n' https://scharade.jp/.well-known/assetlinks.json
curl -s -o /dev/null -w '%{http_code}\n' https://scharade.jp/.env
```

順に、トップ200、関連付け2件は503または設定済みなら200、`.env`は404が期待値です。

| 表示・問題 | 次の対応 |
| --- | --- |
| sudoのパスワードが不明 | VPSを管理した方にubuntuのsudo認証方法を確認する。パスワードをチャットに送る必要はない |
| `Live Nginx configuration changed` | 設定が変わっているため停止した状態。表示結果を伝え、差分を再確認してから適用する |
| `Prepared configuration changed` | 準備ファイルの内容が変わった状態。表示結果を伝える |
| 関連付けURLが404のまま | 修正が未反映、または復元された可能性がある。実行結果を確認する |
| `App association configuration is already installed` | 設定ファイルは適用済み。スクリプトは再読み込みとHTTP確認を継続する |
| `Waiting for Nginx configuration to become active` | 切り替えの反映待ち。自動で確認を繰り返すので待つ |
| `HTTP verification failed` | 待機しても期待する応答が得られなかった状態。復元結果とこの表示を伝える |

終わったら`exit`でMacへ戻ります。

## 3. Expo / EASへログインする

1. [Expoのアカウント作成](https://expo.dev/signup)で所有者のアカウントを作成し、案内に従ってメール確認などを済ませます。
2. Macのターミナルで次を実行します。VPSではなく、このプロジェクトがあるMacです。

```sh
cd /Users/kofizeri/Desktop/VScode/Scharade-HomePage/mobile
npx eas-cli@latest login
npx eas-cli@latest whoami
```

初回に`eas-cli`を取得してよいか聞かれた場合は、パッケージ名を確認して進めます。ログイン画面またはCLIの案内に従い、ご本人が認証してください。`whoami`が所有者のExpoユーザー名を表示すれば完了です。[EAS公式セットアップ](https://docs.expo.dev/build/setup/)。

ログイン後は、次の手順で既存プロジェクトへのアクセスを確認します。パスワードの共有は不要です。

### Googleで登録し、CLIがメール・パスワードを要求する場合

`init`の途中で`Log in to EAS with email or username`と表示され、`Your username, email, or password was incorrect`になる場合は、入力待ちをControl+Cで終了し、Macのターミナルでブラウザー認証を明示します。

```sh
cd /Users/kofizeri/Desktop/VScode/Scharade-HomePage/mobile
npx eas-cli@latest login --browser
```

開いたブラウザーで、プロジェクトを作成したのと同じGoogleアカウントを使ってExpoへログインし、CLIとの接続を許可します。GoogleのパスワードをCLIへ入力する必要はありません。完了後、`npx eas-cli@latest whoami`でExpoユーザー名が表示されることを確認します。[EAS CLIのブラウザー認証](https://docs.expo.dev/eas/cli/#eas-accountlogin)。

2026-10-19に所有者からログイン完了の報告がありました。提示された既存プロジェクトのIDは`ddd4bf45-97ab-4a42-b601-9bb96bd92e49`で、既存アプリ本体の`mobile/app.json`へ設定済みです。作業対象は`mobile/`です。追加で作成された`mobile/scharade/`は別プロジェクトとして保持しています。

### EASプロジェクトと公開IDを確認する

既存のProject IDを設定済みなので、同じプロジェクトを作り直す必要はありません。Macで次を実行します。

```sh
cd /Users/kofizeri/Desktop/VScode/Scharade-HomePage/mobile
npx eas-cli@latest project:info
```

表示される所有者／プロジェクト名とIDを確認します。設定したIDが表示されれば、現在のアカウントでアクセスできています。権限やslugの不一致が表示された場合は、そのエラーから設定を調整します。ローカル設定だけでは、Expo側の所有者やアクセス権を確認したことにはなりません。

2026-10-19に所有者が提示した`project:info`の結果で、`fullName @scharadejp/scharade`、`ID ddd4bf45-97ab-4a42-b601-9bb96bd92e49`を確認しました。`mobile/app.json`にも`owner: scharadejp`を保存済みです。Expoへの接続確認と、以下のFirebaseのAndroid設定は完了しています。

現在の設定は次のとおりです。

- `mobile/app.json`の`expo.extra.eas.projectId`へ公開IDを保存し、`app.config.ts`が引き継ぎます。
- `EXPO_PUBLIC_EAS_PROJECT_ID`を指定した場合は、その値を優先します。現在のプロジェクトを使う場合、追加の設定やexportは不要です。
- `expo.owner`は実際の所有アカウント／Organizationである`scharadejp`に設定済みです。

接続先を指定する場合の`mobile/.env.local`の形式：

```dotenv
EXPO_PUBLIC_SITE_URL=https://scharade.jp
```

本番URLはproduction用です。preview／developmentで架空アカウントを使う操作テストを行う際は、会員データを分離したHTTPSの接続先も準備します。Project IDは`.env.local`を読み込まないEASの処理でも取得できることをローカルで検証済みです。

## 4. FirebaseのAndroid設定

### プロジェクトとアプリを登録する

1. [Firebase Console](https://console.firebase.google.com/)を所有者のGoogleアカウントで開きます。このアプリ用の既存プロジェクトがあれば選び、なければ「プロジェクトを作成」を選びます。
2. 名前は管理しやすい`Scharade`などにします。このアプリの通知だけであれば、Google Analyticsの追加設定は必須ではありません。
3. プロジェクトのAndroidアプリ追加を選び、パッケージ名に`jp.scharade.app`を入力します。ニックネームは`Scharade`などにします。
4. `google-services.json`をダウンロードします。コード側のネイティブ設定はExpoで生成するため、この作業ではGradleファイルを手で変更しません。[Firebase公式手順](https://firebase.google.com/docs/android/setup?hl=ja)。

ダウンロードしたファイルをMacの次の場所へ置きます。ファイル名の`(1)`などは外します。

```text
/Users/kofizeri/Desktop/VScode/Scharade-HomePage/mobile/google-services.json
```

このファイルはAndroidアプリをFirebaseへ登録するための設定です。後述の秘密鍵JSONとは別のものです。ローカルの設定検査に使用しますが、ビルド用アーカイブからは除外するため、クラウドビルドには下記のEAS File変数も設定します。

2026-10-19に配置を確認し、Firebaseプロジェクト`scharade-homepage`に`jp.scharade.app`が登録されていること、設定の必要項目、`release:check`の成功を確認しました。両OSのネイティブ設定生成も成功し、Androidへのファイル転写とGoogle Servicesプラグインを確認済みです。

### 通知を送るための秘密鍵をExpoへ登録する

1. Google Cloudの「IAMと管理」→「サービスアカウント」で、通知専用の`scharade-expo-push`を選びます。これは2026-10-19に作成済みです。
2. このアカウントには`Firebase Cloud Messaging API 管理者`（`roles/firebasecloudmessaging.admin`）を付与済みです。「鍵」から発行したJSONを、Git管理外の安全な場所へ保管します。今回のキーは発行済みなので、保存済みのファイルを使用します。
3. EASプロジェクトの設定が済んだMacで、次を実行します。

```sh
cd /Users/kofizeri/Desktop/VScode/Scharade-HomePage/mobile
npx eas-cli@latest credentials --platform android
```

4. `production` → `Google Service Account` → `Manage your Google Service Account Key for Push Notifications (FCM V1)`を選びます。
5. 新しいサービスアカウントキーをアップロードする選択肢を選び、取得した秘密鍵JSONのパスを指定します。

同じ設定はExpoのProject settings → Credentials → Androidの`jp.scharade.app` → FCM V1 service account keyからも可能です。既存のサービスアカウントを使う場合は、FCMを送る権限も必要です。[ExpoのFCM設定](https://docs.expo.dev/push-notifications/fcm-credentials/)。

### EASビルド用に設定ファイルを登録する

Expoのプロジェクト設定 → Environment variables → Add Variablesで次を登録します。

| 変数名 | 種類・公開範囲 | 内容 |
| --- | --- | --- |
| `EXPO_PUBLIC_SITE_URL` | String / Plain text | productionは`https://scharade.jp` |
| `GOOGLE_SERVICES_JSON` | File / Secret | `google-services.json`をアップロード |

Project IDはアプリの設定に保存済みです。別のIDで上書きする場合だけ、`EXPO_PUBLIC_EAS_PROJECT_ID`をString / Plain textで指定します。まずproduction環境へ設定します。previewも使う場合は、対応する接続先と同じパッケージ向け設定をpreview環境へ用意します。`GOOGLE_SERVICES_JSON`にFCM秘密鍵JSONを入れないでください。[EAS環境変数](https://docs.expo.dev/eas/environment-variables/manage/)。

`GOOGLE_SERVICES_JSON`のproduction環境への登録は2026-10-19に完了しました。EAS CLIの`env:set`でFile / Secretとして作成しています。Firebase画面ではCloud Messaging API（V1）の有効状態を確認しました。Google Cloudコンソールで必要な本人確認は所有者がブラウザー内で完了しています。

所有者の本人確認後、`scharade-expo-push`（表示名`Scharade Expo Push`）の作成済み状態を確認しました。所有者から「認証キーの発行とExpoへの登録を承認します」との承認を受け、[Firebase Cloud Messaging API Admin](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging)（`roles/firebasecloudmessaging.admin`）を付与し、再度開いた権限画面でこの1件の保存を確認しました。

アプリ内ブラウザーでは最初のキー2本（`0651c3d02910…`、`789805f2f94e…`）の実ファイルを保存できませんでした。所有者の新キー発行・Expo登録・旧2本削除の承認後、Chromeで`scharade-homepage-41d4f5415ac0.json`のダウンロード完了を確認しました。MacのDownloadsに保存されたJSONを読み、対象プロジェクト・通知専用サービスアカウント・RSA秘密鍵形式を検査しています。秘密鍵の値は表示・リポジトリ保存していません。

EAS CLIでこのキーを`@scharadejp/scharade`の`jp.scharade.app`にFCM V1用として登録しました。アップロード・割り当ての成功応答に加え、資格情報画面でプロジェクト`scharade-homepage`、通知用メールアドレス、キーID `41d4f5415ac09948439b67c0c3bd6241ff5d7f06`の一致を確認しています。旧キー2本の削除は、最終操作を自動承認レビューが一度拒否しましたが、所有者の削除直前の再承認後に完了しました。Google Cloudの一覧を新しく開き、登録した新キー1本だけがActiveで、旧2本が存在しないことを確認しています。

AndroidのKeystoreは、所有者の明示承認後にExpo側で生成・保存済みです。productionビルド（1.0.0、versionCode 2）は2026-10-19 15:15:17 JSTに成功しました。[ビルド結果](https://expo.dev/accounts/scharadejp/projects/scharade/builds/0bf438bf-b7cc-4576-829a-3a1e89fa2ea3)と、`mobile/build/scharade-1.0.0-2.aab`を次のGoogle Playのテスト配布で使用します。AABのZIP整合性と署名証明書の一致は確認済みです。実機での通知受信とストア提出はまだ行っていません。

## 5. Apple Developerを登録・設定する

2026-10-19に所有者から、Apple Developer ProgramとGoogle Play Consoleは「どちらも未登録・確認中」との回答を受けました。同日のEAS CLIのproduction／iOS資格情報は、`jp.scharade.app`に`No credentials set up yet!`でした。Appleへのログインは行わず終了しています。このMacの開発ツールはCommand Line Toolsのみで、ローカルのiOS実行環境は未設定です。以下の登録・契約・支払いと本人認証は所有者が行います。

1. Apple Accountの2ファクタ認証を準備します。
2. [Apple Developer Program](https://developer.apple.com/programs/enroll/)から登録し、個人／組織の選択、本人確認、契約、支払いを進めます。会費は年99米ドルで、地域に応じた現地通貨の金額が登録画面に表示されます。個人登録では本人の法的氏名が販売元として表示されます。組織登録には契約できる法人格と原則D-U-N-S番号が必要なので、サークル名だけで組織登録できるとは限りません。
3. 登録が有効になったら[Apple Developer Account](https://developer.apple.com/account/)へログインし、「Membership details」で10文字のTeam IDを控えます。[Team IDの説明](https://developer.apple.com/help/glossary/team-id/)。
4. EASのプロジェクト設定後、Macで次を実行します。

```sh
cd /Users/kofizeri/Desktop/VScode/Scharade-HomePage/mobile
npx eas-cli@latest credentials --platform ios
```

5. `production`を選び、ご本人がAppleへのログインと2ファクタ認証を行います。EASに署名情報を管理させる方法を選び、配布証明書・Provisioning Profile・Push Notification Keyの設定を進めます。ビルド時に不足分の作成を案内される場合もあります。[EASの署名情報管理](https://docs.expo.dev/app-signing/managed-credentials/)、[署名情報の種類](https://docs.expo.dev/app-signing/app-credentials/)。

EASが登録するBundle IDは`jp.scharade.app`です。Apple側のIdentifiersでは、このIDにPush NotificationsとAssociated Domainsの機能が有効であることを確認します。手動登録が必要な場合は[App IDの登録手順](https://developer.apple.com/help/account/identifiers/register-an-app-id/)に従います。

その後[App Store Connect](https://appstoreconnect.apple.com/)で「マイApp」→「＋」→「新規App」を選び、iOS、Scharade、日本語、上記Bundle IDを指定します。SKUは管理用の一意な値（例：`scharade-ios-001`）にします。App Store上の名前が使用済みの場合は利用可能な表示名へ調整します。[新規Appの公式手順](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/)。

この段階ではAppの登録までです。TestFlightや審査への提出は署名済みビルドができた後に行います。

## 6. Google Play Consoleを登録・設定する

1. [Google Play Console](https://play.google.com/console/signup)を開きます。
2. 個人用／組織用の条件を確認して選び、25米ドルの登録料、本人／組織確認、連絡先、必要に応じたデバイス確認を済ませます。[登録手順](https://support.google.com/googleplay/android-developer/answer/6112435?hl=ja)。
3. 「アプリを作成」で名前Scharade、デフォルト言語日本語、アプリ／ゲームではアプリ、無料／有料では予定する配布形態を指定し、必要な宣言へ回答します。[アプリ作成手順](https://support.google.com/googleplay/android-developer/answer/9859152?hl=ja)。
4. ビルド後、`jp.scharade.app`のAABを最初のテストリリースへアップロードし、Playアプリ署名の設定を済ませます。最初のAABでパッケージ名が確定するため、`.dev`のビルドを使わないよう確認します。
5. Play Consoleの「Playアプリ署名」画面を開き、「アプリ署名鍵」のSHA-256を控えます。画面の入口は「Google Playによる保護」→「Google Playストアでの配信」などです。「アップロード鍵」の欄は使いません。複数の有効なアプリ署名鍵が表示される場合は、必要なフィンガープリントをすべて控えます。[Playアプリ署名](https://support.google.com/googleplay/android-developer/answer/9842756?hl=ja)。

新しい個人用アカウントで一般公開へ進む場合は、12人以上が14日間連続で参加するクローズドテストと、その後の製品版へのアクセス申請が必要です。アカウントを作った直後に一般公開できるとは限りません。[Googleのテスト要件](https://support.google.com/googleplay/android-developer/answer/14151465?hl=ja)。

### ストア登録を待つ間に確認できるもの

`mobile/eas.json`に、以下の確認用プロファイルを追加しました。どちらも本番用アプリIDとproduction環境を引き継ぎ、自動でビルド番号を増やしません。`development`・`preview`の隔離環境向け設定とは別です。

| プロファイル | 対象 | 作成物と用途 |
| --- | --- | --- |
| `device-test` | Android | APK。Google Play登録前でも端末へ直接インストールして確認できます。既存のExpo管理Keystoreを使用します。 |
| `ios-simulator` | iOS | MacのiOS Simulator用アプリ。Apple Developer登録前のネイティブコンパイル確認に使います。iPhoneへはインストールできません。 |

```sh
cd /Users/kofizeri/Desktop/VScode/Scharade-HomePage/mobile
npx eas-cli@latest build --platform android --profile device-test
npx eas-cli@latest build --platform ios --profile ios-simulator
```

AndroidのAABは直接端末へインストールできないため、実機確認にはAPKを使います。[ExpoのAPK配布手順](https://docs.expo.dev/build-reference/apk/)。iOSシミュレーター版はApple Developerアカウントなしでビルドできますが、起動確認にはXcodeとiOS Simulatorが必要です。[Expoのシミュレーター手順](https://docs.expo.dev/build-reference/simulators/)。どちらも、ビルドの成功だけで実機の通知受信やストア審査が完了したとは扱いません。

2026-10-19に両方のビルドが成功しました。[Android APKのビルド画面](https://expo.dev/accounts/scharadejp/projects/scharade/builds/3b5dde94-8678-423f-97c2-8aa5b7196148)をAndroid端末で開き、InstallからAPKを取得します。Mac側の保存先は`mobile/build/scharade-device-test-1.0.0-2.apk`です。[iOSシミュレーター版](https://expo.dev/accounts/scharadejp/projects/scharade/builds/2f685cfd-d065-41d7-a080-54b81fa36b0f)も保存・識別情報の検査が完了しています。インストール後の操作は[アプリの端末確認票](mobile-device-validation.md)に沿って記録します。

接続先は本番サイトです。最初は自身に許可されたアカウントでログイン・表示・通知設定・ログアウトを確認します。通知の全会員配信、既存企画の変更、退会処理を動作確認のために行わないでください。本番のプッシュ配信は引き続き停止中です。

## 7. 通知用トークンとサーバー設定

### Expo側

Expoの設定で通知送信用のAccess Tokenを発行し、Enhanced Push Securityを有効にします。[Expoの追加セキュリティ](https://docs.expo.dev/push-notifications/sending-notifications/#additional-security)、[トークンの発行・管理](https://docs.expo.dev/accounts/programmatic-access/)。

このトークンは秘密情報です。アプリや`EXPO_PUBLIC_`の変数へ入れず、VPSのサーバー環境ファイルだけに保存します。

### VPS側

SSHでVPSに接続し、既存の環境ファイルを編集します。ファイル全体を置き換えず、対象の設定だけを追加／更新します。

```sh
cd /var/www/my-astro-app
nano .env
```

設定するキーと値の種類：

```dotenv
EXPO_ACCESS_TOKEN=Expoで発行した実際の秘密トークン
APPLE_TEAM_ID=Appleの実際の10文字のTeam-ID
ANDROID_APP_SIGNING_SHA256=Google-Playのアプリ署名鍵の実際のSHA-256
PUSH_DELIVERY_ENABLED=0
```

複数のSHA-256は1行でカンマ区切りにします。まだ取得できていない値は空欄のままにし、説明用の文字列をそのまま保存しません。nanoはControl+O、Enterで保存し、Control+Xで閉じます。

保存後のPM2再起動と確認はこちらで引き継げます。自分で行う場合はVPS上で次を実行します。以下は現在のVPSで確認したNode／PM2の配置に合わせています。

```sh
export PATH="/home/ubuntu/.nvm/versions/node/v22.23.1/bin:/home/ubuntu/.nvm/versions/node/v24.18.0/bin:$PATH"
pm2 restart astro-site scharade-push-worker --update-env
pm2 status
```

Nginx修正が適用済みで識別子も正しければ、手順2の関連付けURLが200になります。片方の設定だけ済んだ場合、もう片方は503のままです。

`PUSH_DELIVERY_ENABLED`は0を維持します。署名済みアプリへテスト端末を登録し、対象を限定した通知テストを行う段階で1に変更します。

## 8. 設定ファイルを取り違えないための一覧

| 値・ファイル | 保存先 | 役割 |
| --- | --- | --- |
| Expo Project ID | MacとEASの公開設定 | アプリをExpoプロジェクトへ紐付ける公開ID |
| `google-services.json` | Macのmobile/とEASのFile変数 | AndroidアプリがFirebaseを識別する設定 |
| サービスアカウントの秘密鍵JSON | EASのFCM V1資格情報 | ExpoがAndroidへ通知を送る秘密鍵 |
| AppleのAPNsキー（.p8） | EASのiOS資格情報 | ExpoがiOSへ通知を送る秘密鍵。EAS自動管理なら手動発行は不要 |
| `EXPO_ACCESS_TOKEN` | VPSの.envだけ | サーバーからExpoへの通知送信を認証する秘密トークン |
| Apple Team ID | VPSの.env | Appleの所有者識別子 |
| Google Playアプリ署名鍵のSHA-256 | VPSの.env | 配布されるAndroidアプリの公開証明書の識別子 |

秘密鍵JSON・.p8・トークン・パスワードをチャットへ貼る必要はありません。Project ID、Team ID、証明書のSHA-256は秘密鍵ではないので、設定の引き継ぎに使えます。

## 9. 完了の伝え方と次の作業

次のうち完了した項目を伝えてください。全項目が揃うまで待つ必要はありません。

- ExpoのCLIログイン済み（whoamiで確認）
- Firebaseのgoogle-services.jsonを指定場所へ保存済み
- FCM V1サービスアカウントをExpoへ登録済み
- Apple Developerの登録が有効、Team ID取得済み
- Google Play Console登録済み（SHA-256は最初のビルド登録後でもよい）
- Nginx適用スクリプトの実行結果
- VPSの.envに通知トークンを保存済み（値は送らない）

こちらでEAS紐付け・設定検査・ビルド準備を進め、署名時の本人認証が必要になったところを案内します。署名済みIPA／AAB、両OS実機での通知受信とリンク起動、ストア申請は別の完了確認です。設定が済んだだけでは公開完了とは扱いません。
