# アプリ化の不具合調査

着手前：既存の単体テスト266件成功、Astro型検査エラー0。既存変更を保持して追加実装する。

| ID | 問題・再現条件 | 対応・検証 |
| --- | --- | --- |
| M01 | 自動の端末登録中に通知設定を変更すると、サーバーの変更を飛ばして端末だけ保存する | 登録処理を直列化。型・両OSバンドル検証済み。実機での同時操作確認は公開準備後 |
| M02 | 同じ端末で別アカウントに切り替え、通知をオフにすると前アカウントの登録を解除できない | 端末秘密情報による解除を許可。所有確認・切り替え・解除の単体テストを追加 |
| M03 | Adminの下書きプレビューではアプリ連携まで無効になる | 表示用属性とアプリ連携用属性を分離。3ブラウザーで連携・保存／共有を確認 |
| M04 | 認証期限切れをネイティブ側が検知しても、表示中の管理画面が残る | ログインへ移動し、認証世代が変わった後の古い応答を破棄。型・バンドル検証済み、実機確認待ち |
| M05 | 埋め込み地図などのサブフレームの遷移を外部ブラウザーで開く可能性 | 遷移ポリシーを分離。地図iframe・外部ページ・危険なスキームの単体テスト成功 |
| M06 | 通知トークンの更新後に旧トークンの無効応答が来ると、新登録まで解除する可能性 | 登録世代を照合して解除。競合を再現する単体テスト成功 |
| M07 | 配信中の再起動・ネットワーク障害で送信状態が不明になる | 永続キュー・期限付きリース・再試行・receipt確認を実装。並行ワーカーの単体テスト成功 |
| M08 | Expo SDK 58の型で通知データ省略、WebViewの既定ジェネリック、削除されたStyleSheet属性が型エラーになる | 対応済み。mobileのTypeScript検査成功 |
| M09 | 個人データの削除処理で、無関係な企画のrevisionや班案まで変更する | 再現テストの失敗を確認後、対象者に関係する変更だけに制限して成功 |
| M10 | 写真展の公開直後に24時間前を迎えると、ワーカーの最初の巡回までに通知時刻が過ぎ、リマインドを予約できない | 公開・日時設定の時刻を保存し、初回巡回の遅れと直前公開を区別する |
| M11 | WebViewのoriginWhitelist外のURLは独自判定より先にOSで開かれる。iframe由来の連携メッセージもURLだけでは不十分 | 全遷移を独自ポリシーへ通し、トップフレームだけに注入するランダム値で連携を検証する |
| M12 | WebKitのスマートフォン幅で、Web用の長い会員挨拶とパンくずが横にはみ出す | アプリでは会員名をMember本文・ネイティブ設定に表示し、Web用の挨拶を省く |
| M13 | 生成ファイルのblob URLをアプリへ転送するとCSPに拒否され、保存・共有が進まない | blobの読み取りをconnect-srcに追加し、同一オリジンの検証を維持する |
| M14 | WebViewにClipboardItemがない場合、ネイティブの画像コピー機能があってもWeb側で未対応と判定する | PNGをネイティブ転送へ直接渡し、通常ブラウザーのSafari向け処理を維持する |
| M15 | 削除開始時に提出レコードを消すと、その後に進行中の処理が生成した出力を完了時に特定できない | 申請の保存先一覧に提出・作品・写真展IDを保持し、完了時の再走査でも使う |
| M16 | 展示配置から本人の作品を除去しても共同編集用revisionと編集者名が残る | 匿名化した配置を既存の版管理へ記録し、履歴の編集者情報も匿名化する |
| M17 | ワーカー終了要求後も完了メールの次の送信やプッシュ処理を開始し、強制停止まで長引く | メールの各送信間と次の処理開始前に終了要求を検査し、PM2の猶予を90秒へ揃える |
| M18 | 本番Nginxのドットパス保護が、アプリリンクの関連付けJSONも404にする | 2件限定の例外を作成。隔離Nginxの構文検査と7経路が成功。2026-10-19に所有者が修正版を適用し、関連付け2件の503と非公開経路の404を実行ログで確認 |
| M19 | 追加のReact静的検査で、描画中の連携用refの更新とHook依存関係が検出される | 識別値はstateで固定し、連携ハンドラーの更新をeffectへ移動。返却されたrefと関数を分けて依存を明示し、ボタンをコンポーネント化。lint・型検査・両OSバンドルが成功 |
| M20 | Nginxのreload要求直後にHTTPを一度だけ確認し、切替途中の旧ワーカーが返す404で即座に復元する可能性がある | 反映待ち・新しい接続による再確認・適用済みでも実稼働を確認する処理へ変更。Bash構文検査とcurl応答を差し替えた4ケースが成功。2026-10-19の所有者ログで修正版の適用成功を確認 |
| M21 | Project IDを環境変数だけで読む動的設定では、EASが設定を調べる際にdotenvを無効にすると、保存したIDが消える | 提示された公開IDをapp.jsonへ保存し、動的設定と公開設定検査が引き継ぐよう変更。dotenv無効での取得、環境変数による上書き、不正IDの拒否を検証 |
| M22 | mobile/scharade/に追加された別アプリまで本体のTypeScript検査に含まれ、別アプリの依存やエイリアスで検査が失敗する | 本体のApp.tsx・index.ts・app.config.ts・srcへ検査範囲を限定。別アプリのファイルを保持したまま、lint・型検査・両OSバンドルが成功 |
| M23 | Gitリポジトリ全体からEASの送信対象を選ぶため、Web用ソースとmobile/scharade/の別アプリも対象になる | リポジトリ直下の.easignoreでmobile/本体へ限定し、別アプリ・依存・生成物・ローカル設定・署名情報を除外。EAS CLI 25.2.0のコピー処理でローカルアーカイブを作成し、必要経路10件・除外経路14件と全22ファイルのハッシュ一致を確認 |

追加テストでは本文をプッシュペイロードへ含めないこと、古い通知を再配信しないこと、回答・提出後のリマインド除外、企画中止への追従も確認済みです。M10・M11・M15・M16・M17は境界・競合・終了要求の再現テストも成功しています。M12・M13・M14は3ブラウザーで修正後の操作を確認しています。

## 検証結果

- 単体テスト：289件成功、失敗0。
- Webの型検査・本番ビルド成功。既存のhint30件を除き、エラー0・警告0。
- 関連ブラウザーテスト：既存138ケース成功。新規12ケースは最終版をChromium・Firefox・WebKitで再実行してすべて成功。
- mobileの型検査、iOS・AndroidのHermesバンドル生成、両OSのネイティブ設定生成が成功。
- 追加監査後のmobile全ソース（App.tsx・src・app.config.ts・index.ts・scripts）のlint：エラー0・警告0。ESLint 9とExpo SDK 58対応の設定を追加し、`yarn run lint`で再実行できる。
- Expo/EASのProject IDとAndroidのFirebase設定は設定済みで、公開設定の検査は成功。FCM V1キーのExpo登録とAndroidの署名済みAABビルドも成功。iOSの署名済みIPA、両OSの実機受信、ストア審査は未完了。

検証中には別の診断サーバーがテスト用メールの参照ファイルを上書きしたため、その実行結果を採用せず環境を作り直しました。追加QRテストの誤った要素IDも修正し、最終版で12件の成功を確認しました。実会員のデータやメールは検証に使用していません。

実機検証・署名済みビルド・ストア審査は自動テストやJavaScriptバンドルの生成とは区別する。開発者アカウント・APNs/FCM設定の準備後に記録を追記する。

## 本番反映と残作業

2026-10-18 05:28:55 JSTにサーバー側を本番へ反映。VPSの隔離環境でも単体289件と本番ビルドが成功し、反映した80ソースファイルとHTTPS配信のCSS／JavaScript 5件のSHA-256が検証版と一致しました。アプリ表示用属性・no-store・blob転送用CSP、公開ページ、未ログインの管理画面302とAPI401、空の退会申請400と別Origin403を確認しています。

切替中のDATA_DIR 101ファイルの前後ハッシュが一致し、本番の環境ファイルは未変更です。会員を使った本番ログイン、通知送信、試験メール、退会処理は行っていません。Web・既存ワーカー2件・通知ワーカーはonlineで、新ワーカーの再起動回数は0です。

2026-10-18時点では関連付けURL2件は404でした。M18のNginx経路は2026-10-19の所有者による適用で解消し、識別情報を待つ503になりました。`release:check`、AndroidのFCM V1設定と署名済みAABは同日完了しました。通知配信の有効化、iOS署名・APNs、両OS実機・ストア提出は引き続き未完了です。

同日の追加監査でExpo CLIの`whoami`は未ログイン、Nginx設定は変更前のハッシュで、`sudo -n /usr/sbin/nginx -t`は本人のパスワード認証を要求しました。所有者による設定変更はまだ確認できていません。M19はローカルのアプリソースへの追加修正で、サーバー側の再反映は必要ありません。修正後の型検査とiOS／AndroidのHermes生成を再実行して成功しました。署名済みアプリの動作確認は引き続き未完了です。

## 2026-10-19 初回Nginx適用の失敗と修正

所有者の実行では構文検査が成功した後、関連付けURLの404を検知して元の設定へ復元しました。`astro.conf.before-mobile-20261019T035656Z`を確認し、現行設定のハッシュも変更前と一致しました。アプリ直通は503、HTTPS経由は404で、DNSと接続先は同じVPSでした。旧応答を一度で判定する確認処理をM20として修正しましたが、今回の404が切替タイミングによるものだったとログで断定したわけではありません。

`node --test tests/mobile-app-links.test.mjs`は4件成功。一時的な404→503、設定済み200、恒常的404の失敗、関連付けが正常でも`.env`が公開されている場合の失敗を、実際のBash確認処理とcurl応答の差し替えで検証しました。これは実Nginxの再読み込み試験ではありません。実Nginxで切替を遅延させる`scripts/verify-mobile-nginx-reload.mjs`も用意しましたが、VPSでの実行は未完了です。

追加ログ取得・修正版転送・昇格を要するローカルHTTP試験は、自動承認レビューがモデル混雑で完了せず未実行でした。修正版はローカルに保存済みで、本番への再転送・本人のsudo認証による再適用とHTTPS確認が残っています。

## 2026-10-19 修正版の適用成功

所有者が提示した実行ログで、構文検査成功、Home 200、apple-app-site-association 503、assetlinks.json 503、非公開経路5件404、最終の`App association routing enabled`を確認しました。バックアップは`/etc/nginx/conf.d/astro.conf.before-mobile-20261019T041328Z`（13:13:28 JST）です。Nginx適用は完了として記録します。関連付けJSONの200、署名済み端末でのリンク起動と通知受信は、識別情報・資格情報の設定後に別途確認します。

## 2026-10-19 Expoログイン後の設定

所有者からブラウザー認証によるログイン完了の報告を受けました。提示されたProject ID `ddd4bf45-97ab-4a42-b601-9bb96bd92e49`を本体の設定へ保存し、M21・M22を修正しました。lint・型検査とiOS／AndroidのHermesバンドル生成が成功しています。`release:check`の未完了項目はFirebase設定です。

こちらからのExpo APIへの照合は、自動承認レビューがモデル混雑で完了せず未実行でした。その後、所有者が提示した`project:info`の結果で`fullName @scharadejp/scharade`、`ID ddd4bf45-97ab-4a42-b601-9bb96bd92e49`を確認しました。所有者とslug・IDの一致を確認済みとし、`mobile/app.json`へ`owner: scharadejp`も保存しました。

追加監査では、EASの既存除外設定がWeb用ソースと別アプリを送信対象にすることを確認し、M23を修正しました。ローカル検証のアーカイブは`/tmp/scharade-eas-archive-fkF4Xz/mobile-build-inputs.tar.gz`、22ファイル・178,642バイトです。確認にはEAS CLIの`Ignore`と`makeShallowCopyAsync`を使用し、外部へのアップロードは行っていません。署名済みアプリのビルド成功を示すものではありません。`release:check`は再実行でもFirebase設定の不足で停止しています。

## 2026-10-19 FirebaseのAndroid設定

所有者が配置した`mobile/google-services.json`について、プロジェクト`scharade-homepage`、一致するAndroidクライアント`jp.scharade.app`が1件あること、アプリID・APIキーの項目があることを確認しました。`release:check`、lint・型検査と両OSのネイティブ設定生成が成功しました。生成先のAndroid設定ファイルが元と一致し、applicationIdとGoogle Services Gradleプラグインも設定されています。ファイルはGit管理外です。

Expoのproduction環境に、`GOOGLE_SERVICES_JSON`をFile / Secretで登録し、EAS CLIの作成成功応答を確認しました。Firebase画面でCloud Messaging API（V1）の有効状態を確認しましたが、EASのAndroid資格情報は未設定で、登録済みGoogle Service Account Keyもありません。資格情報の確認用CLIは変更せず終了しました。Google Cloudのサービスアカウント設定では組織の本人確認を要求されており、所有者によるブラウザー内の認証が必要です。署名済みアプリのビルドと実機での通知受信は未実施です。

所有者の本人確認後、通知専用`scharade-expo-push`の作成済み状態を確認しました。所有者が認証キー発行とExpo登録を承認した後、`roles/firebasecloudmessaging.admin`を付与し、権限画面を再度開いて1件の保存を確認しました。アプリ内ブラウザーから発行した旧キー2本の実ファイルは保存できなかったため、所有者の追加承認後にChromeで新キー`41d4f5415ac0…`を発行・保存しました。キーの対象と形式をローカルで検査し、EASのFCM V1への登録成功とキーIDの一致を確認しています。旧キーの削除は最終クリックを自動承認レビューが一度拒否しましたが、所有者の削除直前の再承認後に2本とも完了しました。Google Cloudの新しい一覧で新キー1本だけがActiveであることを確認済みです。既存の別サービスアカウントは変更していません。実機への通知送信は未実施です。

## 2026-10-19 Androidの署名済みビルド

Keystore生成・Expo保存の明示承認後に、productionのAndroidビルド`0bf438bf-b7cc-4576-829a-3a1e89fa2ea3`が成功しました。バージョン1.0.0、versionCode 2、完了時刻15:15:17 JST。取得したAABは48,948,191バイトで、SHA-256は`7ac4eeddce019454445eda1c213d925e35f9d443fbd0eca5c197680743529eb3`です。ZIP全エントリーのCRC検査、AndroidManifestとBundleConfigの存在、署名証明書のSHA-256がExpoのKeystoreと一致することを確認しました。AABの成功と実機動作・通知受信・Google Play審査は区別します。

Javaランタイムがないため、追加確認にはOpenSSLとPython標準ライブラリを使用しました。[JAR仕様の署名検証手順](https://docs.oracle.com/en/java/javase/25/docs/specs/jar/jar.html#signature-validation)に沿って、PKCS7によるSFファイルの署名、SF内のマニフェスト全体のSHA-256、マニフェスト内の全1,284コンテンツのSHA-256を照合し、すべて成功しました。署名対象外のコンテンツと重複ZIPパスは0件です。[OpenSSLの検証](https://docs.openssl.org/3.6/man1/openssl-smime/)では外部CAチェーンの検証を行わず、実際の署名者証明書のSHA-256をExpoのKeystoreの`64:D5:EB:02:3C:37:42:FC:C8:F0:DC:99:14:7E:D6:14:6B:67:DD:DC:64:A8:1C:8D:7F:68:4A:78:AF:2C:CB:F0`と照合しています。検証結果は`/private/tmp/scharade-aab-verification-20261019.json`に保存しました。

同日のEAS production／iOSの読み取り確認では、Bundle ID `jp.scharade.app`に署名資格情報は未設定でした。Appleログイン・キー発行・ストア提出は行っていません。所有者からApple DeveloperとGoogle Play Consoleは「どちらも未登録・確認中」との回答を受けました。

## 2026-10-19 ストア登録前の検証用ビルド

`mobile/eas.json`に`device-test`と`ios-simulator`を追加しました。どちらもproductionの接続先と環境を継承し、自動のビルド番号増加を無効にしています。前者は既存Keystoreを使うAndroid APK、後者はAppleの署名資格情報を必要としないiOS Simulator用アプリです。変更後のlint・型検査・`release:check`は成功しています。

Android APKは17:37:09 JSTに成功し、70,570,130バイト、SHA-256 `89571a0ddf31cefa90fe33d57a8831752492bce19607d76e58b66f93711c2f69`。ZIPのCRC検査、ManifestとDEXの存在、[APK v2形式](https://source.android.com/docs/security/features/apksigning/v2)のRSA PKCS1 SHA-256署名と保護対象70チャンクのダイジェストをNode cryptoで検証しました。署名者の公開鍵が証明書と一致し、証明書はExpoの既存Keystoreと一致しました。検査用パーサーは[AOSPの署名実装](https://android.googlesource.com/platform/tools/apksig/+/master/src/main/java/com/android/apksig/internal/apk/v2/V2SchemeSigner.java)が加える空の末尾フィールドにも対応しています。Androidの`apksigner`や実端末での検証を行った記録ではありません。結果は`/private/tmp/scharade-apk-verification-20261019.json`です。

iOSシミュレーター版は17:33:02 JSTに成功し、16,926,724バイト、SHA-256 `db3a730de144a50dde374ef64b328bfb1e86b8fa3b82fafbaeb72ca7f9148aca`。gzipの整合性、アプリID `jp.scharade.app`、1.0.0／1、対象`iPhoneSimulator`、Mach-O実行ファイルと最小OS 16.4を確認しました。結果は`/private/tmp/scharade-ios-simulator-verification-20261019.json`です。シミュレーター起動とiPhoneへの配布は未実施です。

端末での手順・期待結果と未実施項目は[アプリの端末確認票](mobile-device-validation.md)へまとめました。両OSの実機受信・ストア提出、本番のプッシュ配信有効化は引き続き未完了です。
