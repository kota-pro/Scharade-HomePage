# 構成・仕様・ファイル案内

担当交代の入口は[引き継ぎ書](handover.md)、機能から画面・API・処理・CSS・保存先を探すには[機能別ファイル対応表](file-guide.md)を参照してください。この資料は処理や制約の詳細です。

## Memberの企画・通知・班分け

`src/lib/activities.ts` は企画・投票・通知・班案とプロフィールの保存、認可、競合検出を担当します。`DATA_DIR/member-activities.json` のversion 1形式にまとめ、公開と通知作成を1回の原子的置換で保存します。ファイルがないときだけ空として読み、破損データは上書きしません。既存usersのroleにstaffを追加し、`isStaff` は承認済みstaff/adminを通します。Adminの権限はadminのままです。

画面はMember内の通知詳細・企画詳細・プロフィール、運営専用のmanage配下に分けます。POST `/api/member/activities` はactionごとに権限を検査し、auth→member-activitiesの順でロックして現在の操作者・対象者を再検査します。actionはnotification.send/read、roster.sync/link（管理者限定）、event.save/publish/cancel、vote、attendance.set/add、groups.rules/generate/save/publishです。GETは本人宛通知の30件ずつの取得、eventId指定時は会員向け企画DTOの取得です。会員DTOには他人の不参加等の回答、性別、班分け条件、編集中の班案を含めません。

保存時のrevisionは古い画面からの上書きを拒否します。投票はユーザー別にロック内更新するため、別人の同時投票を失いません。締切はサーバー時刻で毎回判定し、時刻ちょうどから一般投票を拒否します。締切判定自体に定期ジョブは不要です。日時はUTC保存・Asia/Tokyo表示です。通知はサイト内で保持し、配信設定と端末登録がある場合はプッシュ配信にも対応します。リマインダーと配信キューは専用ワーカーが処理します。

企画の任意の`headerImage`は既存データと互換性のある追加フィールドです。運営以上の`/api/member/event-image/upload`がPortfolioと共通の20MB制限・SharpによるWebP変換・microCMS画像保存を使用します。企画保存時は画像CDNのHTTPS URLだけを受け付けます。`activityPresentation.ts`は入力本文をテキストとHTTP(S)リンクに分け、SSRと確認ダイアログの双方でHTMLとして解釈せずに表示します。

`ActivityEventForm.astro`と`activityEventEditor.ts`は、下書き保存後に最新の保存内容・revisionを再取得し、Contactに合わせたネイティブdialogで確認してからevent.publishを送ります。下書き保存は通知を発生させません。公開済みの変更は確認画面を経てevent.saveし、既存の変更通知を作成します。戻る・項目編集・背景・Escape・フォーカス制御・送信中の二重操作防止・失敗時の再試行に対応します。画像取得失敗時は前の選択を維持し、画像なしの旧企画も引き続き編集できます。

`src/lib/activityRoster.ts` は選択済みのGoogle名簿から性別・学年を取得します。既存の署名付きGASにroster.readを追加し、元シートは読み取りのみ、参照先は固定IDとタブIDに制限します。氏名・LINE表示名・大学・性別・学年・継続状態・ハッシュ化された行識別子を返し、学籍番号・メールアドレス等はWeb側へ渡しません。管理者が氏名一致の候補を確認してアカウントとの対応を確定します。以後の取得は対応を維持し、継続しない・消えた・属性不明の回答を班生成に使用しません。snapshotとbindingsはmember-activities.json内のrosterに保存し、更新revisionと権限を取得前後で検査します。旧profile.saveは一般・運営に403、管理者にも410を返し、旧手入力属性は使用しません。Googleからの取得失敗時は保存済み名簿を保持します。

`src/lib/grouping.ts` はリーダー固定・人数・女性／1年生の単独配置禁止を必須条件として探索します。同班・別班は競合しうる希望で、すべてを満たす探索→別班のみを固定する探索→必須条件のみの探索へと段階的に移行します。約2秒の時間枠を共有し、協調的に実行権を返します。改善の比較は別班違反数→同班違反数→直前同班ペア数→人数差→性別・学年の構成偏差の辞書順です。最適解や重複ゼロを保証する方式ではなく、必須条件の不成立と時間切れを区別します。`validateGroups`は必須条件、`groupPreferenceWarnings`は希望違反と重複をそれぞれ判定します。

`GroupBoard.astro`と`groupBoard.ts`は企画内・単独ツール共通の班カード、リーダー先頭・学年降順表示、2人のクリック交換、色分け、警告を担当します。公開・確定スナップショットには任意フィールドpeople/rules/previousGroupsを保存し、後の条件変更で確定結果の表示を変えません。旧結果は既存名簿情報を参照して表示します。一般会員への企画DTOは従来どおり明示したフィールドのみで、属性スナップショットや同班・別班希望は公開しません。

生成中はファイルロックを解放し、保存直前に権限・企画revisionと入力のSHA-256を再照合します。入力は参加者のID・名前・登録属性、班分け条件、開催済みの直前企画の公開班です。手動保存も同じ入力を照合し、公開時は必須条件を再検査します。公開済み結果は別スナップショットとして版番号・名前を保持し、次の公開で履歴に追記します。新案の生成だけでは過去の公開結果を変えません。

初回導入ではDATA_DIR全体をバックアップしてから更新します。role未設定の旧会員の一括移行は不要です。新ファイルは最初の更新で作成します。バックアップにmember-activities.jsonも含めてください。テストは一時DATA_DIRと模擬サービスで実行し、本番会員への通知は行いません。

## リクエストの流れ

ブラウザ → Nginx（HTTPS）→ PM2 / Astro Nodeサーバー → 共通middleware → ページまたはAPI。
HTMLをサーバーで生成し、操作に必要な小さなスクリプトのみブラウザへ配信します。Reactの実行環境は使用しません。

## ディレクトリ

| 場所                                            | 意味・主な編集対象                                           |
| ----------------------------------------------- | ------------------------------------------------------------ |
| `src/pages/*.astro`                             | URLと対応するページ。Homeはindex、About usはAbout_us         |
| `src/pages/Admin/`                              | 管理者向けサイト情報編集・全Portfolio一覧・登録アカウント一覧／詳細 |
| `src/pages/Portfolio/`                          | 一覧、個別表示、本人／管理者編集                             |
| `src/pages/Gallery/[id].astro`                  | Lightroomアルバム詳細。初回100枚                              |
| `src/pages/posts/[slug].astro`                  | microCMS記事                                                 |
| `src/lib/blog.ts`                               | 公開記事のslugを完全一致で照合し、CMSの記事IDで本文を取得      |
| `src/pages/api/`                                | 認証、問い合わせ、画像、編集のサーバー処理                   |
| `src/layouts/Layout.astro`                      | HTML、元の共通フォント指定、ヘッダー、パンくず、フッター     |
| `src/layouts/AdminLayout.astro` / `src/styles/Admin.css` | sitemapに合わせた管理トップ・情報編集・Portfolio管理の共通デザイン |
| `src/components/`                               | header、footer、Breadcrumbs、loading、SiteImageなど         |
| `src/scripts/`                                  | 管理画面編集、Portfolio編集、問い合わせ確認・送信           |
| `src/pages/Gallery/[id].astro` 内のscript         | 写真の追加取得、元の写真配置と100枚単位のページ送り          |
| `public/vendor/`                                | 元の写真拡大表示用Lightbox2・jQueryとライセンス              |
| `src/styles/`                                   | 共通とページ別CSS                                            |
| `src/data/siteDefaults.ts`                      | サイト情報の初期値と構造。管理画面編集後はJSON側が優先       |
| `src/data/galleryAlbums.ts`                     | Lightroom分類補助と会員限定指定                              |
| `src/data/portfolioVisibility.ts`               | 公開一覧・検索・サイトマップに掲載しないPortfolio IDの指定    |
| `src/lib/auth.ts`                               | 会員・セッション・管理者の判定                               |
| `src/lib/store.ts` / `dataDir.ts`               | 保存先解決、プロセス間ロック、原子的ファイル置換             |
| `src/lib/siteContent.ts`                        | 下書き、公開、前版復元、入力検証、競合判定                   |
| `src/lib/lightroom.ts` / `adobeAuth.ts`         | Adobe接続、ページ取得、トークン更新                          |
| `src/lib/galleryTokens.ts` / `galleryAccess.ts` | 写真の所属証明・会員限定認可                                 |
| `src/lib/microcms.ts` / `cache.ts`              | microCMS取得、型、60秒キャッシュと同時取得の重複抑制         |
| `src/lib/mail.ts` / `contact.ts`                | メール設定・問い合わせ入力検証                               |
| `src/utils/`                                    | 日付、記事、画像URLなどの表示補助                            |
| `src/assets/`                                   | WebP生成元の固定写真と、元のデザインで使うSVG等の装飾          |
| `public/`                                       | URLで直接配信する画像、アイコン等。秘密データを置かない      |
| `scripts/`                                      | 配信用画像生成、VPS管理者作成                                |
| `tests/`                                        | 実サービスと分離した自動テスト・フィクスチャ                 |
| `dist/`                                         | ビルド生成物。直接編集しない                                 |
| `next-app/`                                     | ローカルに残す過去のNext.js案。現行サイトでは未使用、Git管理・ビルド対象外 |
| `docs/`                                         | 仕様、運用、引き継ぎ、企画、検証資料                         |

## microCMS

既存スキーマを使います。フィールド名を変更すると連携が壊れるため、変更前にバックアップとコード調整が必要です。

- `blog`：title / slug / body / excerpt / pictures / tags / 公開日時。
- `portfolio`（環境変数で変更可）：name、self_introduction、instagram、x_url、camera、hashtags、icon（画像）、pictures（複数画像）、grade、generation（数値）、role（文字列）、isExecutive（真偽）、displayOrder（数値）。
- `card_image`：旧カルーセル用。現在のHomeは公開Portfolioの写真からランダム選出するため参照しません。除外設定は `site-content.json` のHome下書き・公開・復元に含めます（[写真設定](home-photos.md)）。

Content APIキーには読み取りとPortfolioの作成・更新・削除を、Management APIキーにはメディアの書き込みと「コンテンツの取得（一覧・詳細）」を設定します。Management APIキー未設定時はContent APIキーを使います。新しい管理用フィールドがまだない環境ではmicroCMSで追加が必要です。学年がセレクト型の場合は文字列配列へ切り替えて再送する既存スキーマ互換処理があります。

## 認証とデータ

usersの `approved` と `role` は独立しています。旧会員データでrole未設定の場合は一般会員です。最初の管理者は専用CLIで作成し、以後は管理画面の登録内容編集から既存アカウントの権限も変更できます。パスワードはscrypt、セッションcookieはHttpOnly / SameSite=Lax / HTTPS時Secure。再設定は期限付きワンタイムトークンで、成功すると既存セッションを無効化します。

変更APIはOrigin一致、権限確認、送信サイズ上限、操作頻度制限を通します。HTMLはログイン挨拶を含むためprivate / no-storeです。リバースプロキシでHTMLを独自にキャッシュしないでください。

site-contentはページごとのrevisionを持ち、同時編集は409で通知します。JSON書き込みは一時ファイルをfsyncしてrenameし、同一VPS上の複数プロセスはディレクトリロックで直列化します。**複数VPS・共有NFS・高頻度更新を想定したデータベースではありません。** 水平分散が必要になったらDB移行を検討します。

## Galleryの認可と速度

一覧メタデータは30秒キャッシュ。API失敗時は公開扱いに倒さず、取得失敗として表示します。アルバムに所属することをLightroom APIで確認した写真IDに、1時間の署名付きURLを発行します。画像APIは署名・写真ID・その時点のアルバム公開範囲・ログインを検査します。署名だけでは会員限定写真を閲覧できません。会員限定へ変更した写真の再利用を防ぐため、画像レスポンスもprivate / no-storeです。

写真のメタデータは初回100枚、残りも30枚ずつ自動取得し、元と同じ100枚単位のページ送りで表示します。追加読み込みボタンへの変更は取り消しました。カーソルは署名付きで、Adobeの同じカタログ・同じアルバムのURLだけを許可します。任意のURLにAdobeの認証トークンを送信できません。閲覧が1時間を超えて署名が切れたらページを再読み込みします。

## 表示・操作

Portfolioの共有は、`src/pages/Portfolio/[id].astro` から `src/components/PortfolioShareButton.astro`（入口）、`PortfolioShareDialog.astro`（共有画面）、`PortfolioShareIcon.astro`（指定SVG）を使います。外観は `src/styles/PortfolioShare.css`、開閉・コピー・保存は `src/scripts/portfolioShare.ts`、QR生成は `src/scripts/portfolioQr.ts` に分離しています。共有URLはAstroのsite設定を基準にした、表示中のPortfolioの正規URLで、追跡クエリやハッシュを含みません。

QRの生成モジュールは共有画面を開いた時だけ動的に読み込みます。`qrcode` 1.5.4で端末内のcanvasへ1024pxのPNGを生成し、誤り訂正H・4セルの余白・中央18%の白地に `/icons/logo.svg` を描きます。外部のQRサービスへ情報を送りません。コピーはClipboard APIでtext/plainまたはimage/pngを書き込み、成功後だけ成功表示を出します。未対応や拒否では手動コピー・ダウンロードを案内します。保存用のblob URLはページ内で再利用し、ページ破棄時に解放します。ダウンロード開始後に指定のチェックSVGへ切り替えますが、OS上の保存完了は検出できません。

QR生成と画像コピーの仕様参照：[node-qrcode](https://github.com/soldair/node-qrcode)、[ClipboardItem](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/ClipboardItem)。

共有ボタンはPC・スマホともプロフィールのSNS欄末尾に常時表示します。詳細ページ内のSNSリンクと共有ボタンで、アイコン寸法・グレーのフィルター・余白・ホバー時の背景色と白いアイコンのCSSを共用しています。768px以下では20px、PCを含む広い画面では同じ欄のSNSと同じ25pxです。SNSが未登録でも共有ボタンは利用できます。以前のプロフィール画像上の共有ボタンと、そのホバー専用CSSは削除しました。

管理者の7つのページ編集画面では、`src/pages/Admin/content/[key].astro` に目次の領域を置き、`src/scripts/contentEditor.ts` が編集フォームと同じ初期スキーマ・現在の下書きからリンクを生成します。編集欄には `editor-section-項目名`、一覧内の項目にはさらに位置番号を付けたIDを割り当て、追加・削除・並べ替え・名称変更・保存後に目次を更新します。個別項目の目次は折りたたみ式で、更新時も開閉状態を保持します。通常のページ内リンクとフォーカス可能な移動先を使い、保存処理は呼び出しません。`src/styles/Admin.css` の `scroll-margin-top` で固定ヘッダー分の余白を取り、管理画面の写真プレビューに高さを確保して遅延読み込みによる移動先のずれを防ぎます。

ヘッダー・フッターの会員リンクは「My Portfolio」「Admin」（管理者のみ）です。ハンバーガーメニューの「Log out」は既存のログアウトAPIを呼び出します。`src/components/header.astro` の `.member-button` で「Log in」「Sign up」を含む全会員用ボタンの書体・枠線・余白・ホバー表示を共通化し、幅不足時には12pxの間隔で折り返します。通常のメニューリンクの下線は会員ボタンに重ねません。

管理画面は `src/layouts/AdminLayout.astro` と `src/styles/Admin.css` に共通の外観をまとめています。公開sitemapに合わせ、Adminの大見出しはlinotype-didot、項目見出しはZen Old Mincho、本文・入力欄はZen Kurenaido、配色は白黒、区切りは細い罫線です。管理トップのページリンクはPCで複数列・768px以下で1列。ページ編集とPortfolio管理も同じレイアウトを使います。入力欄はスマホでも16px以上、操作ボタンは高さ44px以上を確保しています。保存・公開・復元処理は従来の `src/scripts/contentEditor.ts` と管理APIが担当します。

Portfolio個人ページの写真配置は `src/scripts/portfolioGallery.ts` と `src/utils/justifiedGallery.ts` が担当します。写真の登録順と縦横比を保ち、切り抜かずに表示します。画面幅768px以下では縦長・横長・正方形をすべて1行1枚、写真欄の全幅で表示します。769px以上では、画面幅から目安の高さ（100〜300px）を求め、100枚以内の写真全体について行の区切りを比較し、高さのばらつきと左右端を揃えます。PCで1行に収まる少数の写真は過大に拡大せず左揃えにします。間隔はPC12px、768px以下6px。算出した座標・寸法で配置し、コンテナにも全行の高さを確保するため、端数の丸めで末尾だけ折り返すことがありません。CMSの寸法があれば読み込み前から配置し、寸法がない写真は読み込み後に個別に再配置します。ResizeObserverで写真欄の幅の変化を検出し、requestAnimationFrameで更新をまとめます。画像のsizesには実際の表示幅を設定し、240〜1920pxのsrcsetからブラウザが端末の解像度に合わせて選びます。遅延読み込み・100枚単位のページ送り・Lightboxによる写真拡大は継続します。JavaScript無効時にも最初の100枚を表示し、スマホは1列、PCは通常のグリッドになります。

スマホの写真拡大は `src/scripts/portfolioLightbox.ts` と `src/styles/PortfolioLightbox.css` が、既存のLightbox2 2.11.4のstart・sizeContainer・endにPortfolio限定の処理を追加します。768px以下で開いた写真は画面内に固定し、横写真を縦持ち画面で見るときだけCSSで90度回転します。縦写真・正方形は回転せず、端末を横にすると横写真も回転を解除します。VisualViewportの幅・高さを使い、画像の縦横比と閉じるボタン・枚数表示の余白を確保します。ブラウザやOSの画面方向をロックする処理は使いません。前後移動・読み込み表示・閉じる操作は既存Lightboxを使い、終了後にスマホ用クラスとスクロール設定を戻します。Lightboxを更新する場合は、写真拡大・画面回転・PCでの再表示のブラウザテストも実施してください。

パンくずはヘッダー直下、Zen Kurenaido、通常400、#909090、PC12px、モバイル12〜14pxで折り返します。現在地はaria-current、記事の親は常にActivityです。ログイン中の挨拶は登録名を使い、自身のPortfolioへリンクします。

パンくず行は `src/components/Breadcrumbs.astro` が担当し、パンくずを左、ログイン時の挨拶を右に配置します。`src/styles/global.css` の `--site-inline-gutter` をロゴの左余白と行の左右余白に共用します（通常 `max(21px, 5.7vw)`、430px以下は20px）。アカウント名とパンくずを一行に並べた幅を測り、収まらない場合は挨拶を「My pageへ」に変更します。ウィンドウ・行のサイズ変更とフォント読み込み完了時に再判定します。短縮後も長いパンくずは左側で折り返し、リンクは右上に保ちます。JavaScript無効時の挨拶リンクは短縮表示です。

自分のPortfolio詳細には編集リンクとログアウトボタンを表示します。`src/pages/Portfolio/[id].astro` が表示・配置と操作を担当し、既存の `POST /api/auth/logout` でセッションを削除した後トップへ移動します。送信中は無効化して重複送信を防ぎ、失敗時には再操作できます。ログアウトSVGはペンと同じPC20px／スマホ16px、文字との間隔もPC15px／スマホ8pxです。PCではInstagramリンクボタンの右端に合わせ、Instagram未設定時はプロフィール情報欄の右端を基準にします。768px以下では「Log out」を左、編集を右に配置し、戻るリンクは次の行、名前の下のタグは折り返しも含め中央揃えにします。

元の固定ヘッダー・スクロール時のメニュー切り替え、トップの自動フィルム表示、About usの年間予定タブ・設備スライド、問い合わせ確認オーバーレイを保持します。写真拡大は元と同じLightbox2 2.11.4 + jQuery 3.6.0で、配布ファイルは `public/vendor/` に置きます。写真は左右キーとEscapeに対応。問い合わせ確認の内容をクリックすると元の入力欄に戻ります。対応対象は幅320〜1920pxと主要ブラウザの現行・前メジャー。実際の確認済み範囲は検証記録を参照してください。

承認完了メールは `src/lib/accountReview.ts` が担当します。VPSの旧版に追加されていた機能を保持し、送信失敗時の再試行と承認操作の直列化、送信済み日時を記録します。

## 登録アカウントの管理者向け閲覧

`src/pages/Admin/accounts/index.astro` がサーバー上の `readUsers()` から一覧を生成し、名前・メール・登録時Portfolio名・IDの部分一致検索と30件のページ送りを行います。各行に登録内容の詳細リンクと、Portfolio IDがある場合の編集リンクを並べます。`[id].astro` は個別登録内容を表示し、Portfolioへの閲覧・編集リンクは置きません。AdminトップのPortfolio管理セクションも外し、会員の編集導線はアカウント一覧へ集約しています。既存の `/Admin/portfolios` 自体は、アカウントと紐づかないCMSコンテンツの管理用として残します。CMSへの追加アクセスは行いません。`src/lib/adminAccounts.ts` の許可した表示項目だけを取り出す処理を通し、パスワードハッシュ・認証バージョン・Instagram内部IDなどはページへ渡しません。日時はAsia/Tokyo、未記録は代替表示、存在しないIDは404、読取失敗は503です。`src/middleware.ts` の既存Admin配下の権限検査、private/no-store、noindexを適用し、閲覧用の新規APIはありません。

アカウント一覧のページ送りはActivityと同じGrandiflora One、既存の左右・二重矢印SVG、現在ページの下線、ホバー色を使います。先頭2件・末尾2件・現在ページと前後を表示し、間の省略を「...」で示します。サーバーが検索条件付きのリンクを生成するため、JavaScript無効時も移動できます。最初と最後では進めない矢印にリンクを付けず、`aria-disabled`で示します。専用CSSで狭い画面では番号群と操作ボタンを折り返し、Activityや旧Portfolio管理のスタイルには影響させません。

Portfolio編集の管理者用チェック欄は `src/styles/PortfolioEdit.css` の専用flex配置で見出し文字の右に揃え、20px・黒のaccent-colorを指定します。通常入力の幅100%指定からcheckboxを除外しています。`field-executive` の既存保存処理は共通です。

登録内容の編集は個別ページの折りたたみフォームと `src/scripts/accountEditor.ts`、`POST /api/admin/accounts/[id]`、`src/lib/accountManagement.ts` が担当します。name・email・portfolioName・role（member/staff/admin）だけを許可し、承認状態やパスワードなどを追加送信した場合は拒否します。表示時の登録4項目のSHA-256リビジョンを保存時に照合し、authのファイルロック内で管理者権限・対象者・メール重複・競合を再確認して原子的にusers.jsonを書き換えます。保存した項目値を含めず操作者ID・対象ID・操作種別をaudit.jsonlに記録します。

メール変更時はauthロック内で対象者のパスワード再設定トークンを先に失効させ、authVersionを増やして既存セッションを無効化します。再設定トークン発行とメールログインのセッション発行でも、ロック取得後に要求時のメールが現在の登録と一致することを確認し、変更前アドレスで進行中だったリクエストとの競合を防ぎます。アカウント更新はメール・CMS更新を呼び出しません。自己メール変更後のLoginではreason=email-updatedを使い、新しいメールでの再ログインを案内します。

アカウント削除は同じ個別ページの確認ダイアログ、`src/scripts/accountDeletion.ts`、`DELETE /api/admin/accounts/[id]`、`src/lib/accountDeletion.ts` が担当します。対象メール入力・削除用リビジョンを検査し、account-review→authの順でロックを取得して承認処理との競合を防ぎます。ロック内で操作者の現在の管理者権限・自己削除禁止・他ユーザーとのPortfolio共有を再確認します。CMSのPortfolioを先に削除し、再設定トークン、セッション、ユーザー情報の順に削除します。CMS削除後のローカル保存失敗は部分完了として通知し、再試行で完了できます。画像のメディア原本は削除しません。

CMSのDELETEは6秒でタイムアウトし、400・404の場合はManagement APIの詳細404と一覧成功を各2秒以内に確認できた場合だけ削除済みと扱います。不明・非公開・権限不足ではアカウントを保持します。タイムアウトでも上流側が削除を完了している可能性があるため、CMSキャッシュは成功・失敗とも無効化します。削除後の監査ログには操作種別`account.delete.with-portfolio`と操作者・対象IDだけを保存します。`tests/account-deletion.test.ts` と `tests/browser/account-delete.spec.ts` は一時保存先・模擬CMSを使い、実会員を削除せずに権限、失敗、再試行、セッション無効化を検証します。


権限変更ではauthロック内で操作者の現在の権限を再確認し、最後の承認済み管理者の降格を拒否します。権限の変更もリビジョンに含むため、古い編集画面から以前の権限へ戻す保存は競合となります。メールまたは権限の変更時はauthVersionを増やし、既存セッションと再設定リンクを失効させます。権限変更を含む監査記録の操作種別は`account.role.update`です。自己降格の戻り先は権限を失ったAdmin詳細ではなくHomeとし、Loginの`role-updated`案内を経て再ログインします。承認状態・CMS・Portfolioの役職は変更しません。

枠のないテキストリンクの操作表示は`src/styles/textLinks.css`にまとめ、Layoutから読み込みます。管理画面の会員名・戻るリンク・目次、パンくず、挨拶、認証画面の補助リンク、本文リンク、Portfolioのテキスト操作、ページ番号などはホバーとキーボードフォーカスで下線を表示します。クリック中とクリック後のフォーカス中はheaderと同じ`#0db49b`にします。Adminトップ・sitemap・About us・footerの既存の下線アニメーションは位置を維持してフォーカス色を揃えます。枠付きボタン、写真・SNSアイコン、無効な矢印はこの共通指定の対象に含めません。


## 単独班分けツールと企画削除（2026-10-06）

`src/lib/groupingTools.ts`は企画とは別の`DATA_DIR/grouping-tools.json`（version 1）に作業・条件・編集中と確定済みの班を保存します。参加者IDはGoogle名簿の安定した行キーで、アカウントとの連携を必要としません。データの読み取りは運営専用ページ、更新は`POST /api/member/grouping`のrun.save / run.delete / groups.rules / groups.generate / groups.save / groups.publishです。すべて承認済みの運営以上が対象で、一般会員へは結果も属性も公開しません。このgroups.publishは運営内の確定操作であり、企画や通知を作りません。

生成アルゴリズムと班編集UIは企画と共有します。`GroupEditor.astro`に対象のデータ・参照履歴・保存先を渡し、旧`ActivityGrouping.astro`は企画用のラッパーとしています。単独ツールは確定済み作業の参照先IDを保存し、新規作業では直近の確定を既定にします。参加者・名簿属性・条件・参照する確定結果のハッシュで古い班案を検出します。auth→member-activities→grouping-toolsの順にロックし、時間のかかる生成はロック外で行ってから権限・revision・入力ハッシュを再検査します。保存データ破損時は初期化しません。

`event.delete`は運営以上、revision一致、削除確認値を要求し、企画とそのeventIdを参照する通知を同じ原子的置換で除去します。開催済みの公開企画に確定班がある場合だけ、内容・投票を除いた日付と班履歴をmember-activities.jsonのeventGroupingHistoryに保持します。previousEventはこの履歴も参照し、削除によって次回の同班回避が失われないようにします。中止・未開催・班未確定の企画は履歴に残しません。画像CDNのファイルは他コンテンツから参照される可能性があるため削除しません。


`run.delete`は運営以上・revision一致・confirmation=deleteを要求します。名簿の未取得や属性不足があっても削除できます。削除対象を既に参照している作業だけにpreviousSnapshotとして確定履歴を保存し、既存の入力ハッシュ・重複判定を維持します。削除した作業は一覧・詳細・新規の履歴候補から除外します。参照先変更時は古いsnapshotを除去します。

LINE表示名は名簿の任意フィールドlineNameです。班用Participantへ伝達し、displayNameで氏名（LINE名）に整形します。表示名だけの変更は入力ハッシュから除外し、既存の確定結果にLINE名が未保存の場合は現在の名簿から補完します。一般会員の企画DTOには閲覧可能な確定班の整形済み氏名のみ含め、性別・学年・条件等は引き続き含めません。同班・別班指定はGroupPersonPickerと共通スクリプトで絞り込み、選択済みのIDを維持します。
