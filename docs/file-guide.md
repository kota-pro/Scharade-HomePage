# 機能別ファイル対応表

2026-10-19のソース構成に基づく修正先ガイドです。パスはリポジトリ直下を基準にしています。全体運用は[引き継ぎ書](handover.md)、処理の詳細は[構成・仕様](architecture.md)を参照してください。

## ファイルとディレクトリの読み方

| 場所・拡張子 | 役割 |
| --- | --- |
| `src/pages/*.astro` | URLに対応する画面。`index.astro` はその階層のトップ |
| `src/pages/**/[id].astro`・`[slug].astro` | ID・記事slugごとの動的画面 |
| `src/pages/api/**/*.ts` | サーバーAPI。画面とは別に権限・入力を検査する |
| `src/layouts/`・`src/components/` | 共通の画面枠／再利用する表示部品 |
| `src/lib/` | 認証、外部連携、保存、検証、業務ロジック |
| `src/scripts/`・`src/styles/` | ブラウザ操作／共通・機能別CSS。`.astro`内にもstyleがある |
| `src/data/`・`src/types/`・`src/utils/` | 初期値・公開設定／型／表示・URL・画像の補助 |
| `src/assets/` | ビルド時に処理する固定写真の原本・装飾素材 |
| `public/` | URLで直接配信する素材。秘密データは置かない |
| `scripts/` | Nodeによる生成・管理・移行・ワーカー・サーバー運用処理 |
| `gas/` | Google Apps Script。Webとは別にGoogle側へ配置する |
| `deploy/`・`ecosystem.config.cjs` | Nginx／SSHの設定例・導入処理／PM2定義 |
| `tests/`・`tests/browser/`・`docs/` | Nodeテスト／Playwright画面検証／操作・設計・公開履歴・引き継ぎ |
| `dist/`・`.astro/`・`node_modules/` | 生成物・依存。直接編集・コミットしない |

## 1. 公開サイト・記事・検索・SEO

| 機能・URL | 主なファイル | データ・表示・注意 |
| --- | --- | --- |
| Home `/` | `src/pages/index.astro`、`src/lib/homePhotos.ts`、`src/scripts/homeCarousel.js`、`src/styles/index.css` | 管理画面のhome設定・写真除外、microCMS記事・公開Portfolio写真。除外ポップアップは `HomePhotoPicker.astro`／`homePhotoPicker.ts`／`HomePhotoPicker.css` |
| 活動紹介 `/About_us` | `src/pages/About_us.astro`、`src/assets/equipments/`・`annual_schedule/` | 管理画面about・common、地図・固定写真 |
| 記事一覧 `/Activity` | `src/pages/Activity.astro`、`src/lib/blog.ts`、`src/scripts/activityPagination.js`、`src/styles/Activity.css` | microCMS `blog` |
| 記事 `/posts/…` | `src/pages/posts/[slug].astro`、`src/lib/blog.ts`、`src/utils/linkToPost.ts`、`src/scripts/postBody.js` | slugの正確なエンコード・照合、本文HTMLのサニタイズ |
| 検索 `/SearchResult` | `src/pages/SearchResult.astro`、`src/lib/search.ts` | 記事・公開Portfolio等。内部検索URLはXMLに載せない |
| 問い合わせ `/Contact` | `src/pages/Contact.astro`、`src/scripts/contact.ts`、`src/pages/api/contact.ts`、`src/lib/contact.ts`・`mail.ts` | 管理画面contactとGmail。確認画面後に送信。実メール試験は宛先と内容を事前確認 |
| ポリシー・公開案内 | `src/pages/Disclaimer.astro`・`AppPrivacy.astro`・`AccountDeletion.astro`、`public/exhibition-*.html`・`exhibition-info.css` | Disclaimerは管理画面設定、他はソース。削除申請の処理は後述 |
| サイトマップ・robots | `src/data/publicPages.ts`、`src/pages/sitemap.astro`・`sitemap.xml.ts`・`robots.txt.ts`、`src/lib/sitemap.ts` | 固定ページは共通一覧、詳細はmicroCMS／Lightroomから収集 |
| エラー | `src/pages/404.astro`・`503.astro` | 不存在／一時利用不可。公開一覧に追加しない |

## 2. Gallery・Portfolio・写真

| 機能 | 主なファイル | 保存先・表示・注意 |
| --- | --- | --- |
| Gallery一覧・詳細 | `src/pages/Gallery.astro`・`Gallery/[id].astro`、`src/pages/api/gallery/[id].ts`、`src/styles/Gallery.css`・`PhotoGallery.css`、`src/utils/justifiedGallery.ts` | Lightroom、写真配置・追加取得 |
| Adobe認証・公開範囲 | `src/lib/adobeAuth.ts`・`lightroom.ts`、`src/data/galleryAlbums.ts` | `.env`・DATA_DIRのAdobeトークン、ID／名前／Lightroom分類による公開範囲 |
| 写真配信・認可 | `src/pages/api/images/[id].ts`・`full/[id].ts`、`src/lib/galleryImage.ts`・`galleryTokens.ts`・`galleryAccess.ts` | 所属・署名・現在の公開範囲・ログインを検査。会員写真を共有キャッシュに保存しない |
| Portfolio一覧・詳細 | `src/pages/Portfolio/index.astro`・`[id].astro`、`src/lib/microcms.ts`、`src/styles/Portfolio.css` | microCMS `portfolio`。`src/data/portfolioVisibility.ts` は専用IDを一覧・検索・XMLから除外 |
| Portfolio編集・投稿 | `src/pages/Portfolio/edit.astro`、`src/pages/api/portfolio/update.ts`・`upload.ts`、`src/scripts/portfolioEditor.ts`、`src/styles/PortfolioEdit.css` | 本人／管理者の認可、CMS更新・メディア保存 |
| 配置・拡大・共有・QR | `src/scripts/portfolioGallery.ts`・`portfolioLightbox.ts`・`portfolioShare.ts`・`portfolioQr.ts`、`src/components/PortfolioShare*.astro`、`src/lib/qrBrand.ts` | `PortfolioLightbox.css`・`PortfolioShare.css`。vendorのライセンス保持、QRはブラウザ内で生成 |
| 固定写真の軽量化 | `scripts/prepare-images.mjs`、`src/components/SiteImage.astro`、`src/utils/siteImage.ts`・`microcmsImage.ts` | 原本 `src/assets/` → `public/media/site/`・`decorations/`。生成キャッシュはGit対象外 |

## 3. 認証・会員・アカウント削除

| 機能 | 主なファイル | 保存先・注意 |
| --- | --- | --- |
| 共通認可・セッション | `src/middleware.ts`、`src/lib/auth.ts`・`security.ts`・`sessionCookies.ts` | DATA_DIRの `users.json`・`sessions.json`。権限を画面表示だけで判定しない |
| 登録・メール確認・承認 | `src/pages/Signup.astro`、`src/pages/api/auth/signup.ts`・`review.ts`、`src/lib/signupVerification.ts`・`signupReview.ts`・`accountReview.ts` | `signup-verifications.json` とusers。一般申請で管理者を作らない |
| ログイン・ログアウト | `src/pages/Login.astro`、`src/pages/api/auth/login.ts`・`logout.ts`、`src/lib/passwords.ts`・`passwordPolicy.ts` | パスワードハッシュとセッション。固定パスワードを追加しない |
| メール二段階認証 | `src/pages/Mfa.astro`、`src/pages/api/auth/mfa.ts`、`src/lib/mfa.ts`・`mfaState.ts`、`scripts/mfa-reset.mjs` | `auth-security.json`。対象は運営・管理者。CLI復旧は本人確認後 |
| パスワード再設定 | `src/pages/ForgotPassword.astro`・`ResetPassword.astro`、`src/pages/api/auth/password-reset/`、`src/lib/passwordReset.ts` | `password-reset-tokens.json`。期限付きリンク・旧セッション失効 |
| 登録情報・権限管理 | `src/pages/Admin/accounts/`、`src/pages/api/admin/accounts/[id].ts`、`src/lib/adminAccounts.ts`・`accountManagement.ts`、`src/scripts/accountEditor.ts` | usersと名簿対応。最後の管理者の降格を防止。アカウント名とPortfolio名は別 |
| 本人の削除申請 | `src/components/AccountDeletionForm.astro`、`src/pages/Member/account-deletion.astro`、`src/pages/api/account-deletion.ts`・`member/account-deletion-requests.ts`、`src/lib/accountDeletionRequests.ts` | メール所有確認・`account-deletion-requests.json`。公開申請／ログイン後申請 |
| 削除管理・実処理 | `src/pages/Admin/account-deletion-requests/`、`src/lib/accountDeletion.ts`・`accountDeletionProcessing.ts`・`deletionPrivacy.ts`、`src/scripts/accountDeletionAdmin.ts` | CMS・提出写真・外部サービス・バックアップの確認も含む |
| 初期管理者・移行 | `scripts/admin.mjs`・`security-env.mjs`・`security-migrate.mjs`・`email-mfa-migrate.mjs`・`security-preflight.mjs` | 管理CLI。事前検査・バックアップを行い、移行を通常デプロイで無条件に繰り返さない |

## 4. 会員画面・企画・通知・名簿・班分け

| 機能 | 画面・処理・部品 | 保存先・注意 |
| --- | --- | --- |
| トップ・カレンダー | `src/pages/Member/index.astro`、`src/components/ActivityDashboard.astro`、`src/lib/activityCalendar.ts`・`exhibitionCalendar.ts`、`src/scripts/activityCalendarNavigation.ts` | 活動・写真展情報。`src/styles/Member.css`・`Activities.css` |
| 企画・参加回答 | `src/pages/Member/events/`・`manage/events/`、`src/pages/api/member/activities.ts`、`src/lib/activities.ts`・`activityTypes.ts`、`src/scripts/activityEventEditor.ts`・`activities.ts` | `member-activities.json`。下書き・公開・期日・revision・回答。`ActivityEventForm.astro`・`ActivityEventEditor.css` |
| 画像・本文・共有 | `src/components/ActivityHeaderImage.astro`・`ActivityText.astro`・`ActivityShare*.astro`、`src/scripts/activityShare.ts`、`src/lib/activityPresentation.ts`、`src/pages/api/member/event-image/upload.ts` | 本文は任意HTMLとして解釈しない。`src/styles/ActivityShare.css` |
| 通知・宛先 | `src/pages/Member/notifications/`・`manage/notifications.astro`、`src/components/ActivityRecipients.astro`、`src/lib/notificationRecipients.ts`、`src/scripts/recipientPicker.ts` | 本人宛だけ閲覧。通知対象と企画の公開部分は別 |
| 名簿同期・紐付け | `src/lib/activityRoster.ts`・`rosterChanges.ts`・`rosterReconciliation.ts`・`rosterPortfolioUpdates.ts`、`src/pages/Admin/grouping-roster/`、`gas/intake/Code.gs` | 元名簿は読み取りのみ。管理者が対応を確認。年度変更・退会反映は操作資料を参照 |
| 春秋の名簿・フォーム | `src/lib/termRoster.ts`・`clubForms.ts`・`rosterExports.ts`、`src/pages/Admin/club-forms.astro`、`scripts/club-forms-worker.mjs`、`gas/club-forms/` | 幹部以上。入会＋継続の確認適用、Portfolioの変更、4種類のフォーム生成・期限管理。[導入資料](club-forms.md) |
| 企画内／単独班分け | `src/pages/Member/manage/grouping/`、`src/pages/api/member/grouping.ts`、`src/lib/grouping.ts`・`groupingTools.ts`・`groupingParticipants.ts`・`groupingGrade.ts` | 必須条件と希望条件、入力競合、公開スナップショットを区別 |
| 班表示・編集・画像出力 | `src/components/GroupBoard.astro`・`GroupEditor.astro`・`GroupPersonPicker.astro`、`src/scripts/groupBoard.ts`・`groupPersonPicker.ts`・`groupExport.ts`・`groupPng.ts`、`src/lib/groupPresentation.ts`・`groupExport.ts` | `src/styles/GroupBoard.css`。氏名・LINE名の出力先を確認 |
| プッシュ・リマインダー | `src/lib/pushDevices.ts`・`pushDeviceState.ts`・`pushQueue.ts`・`pushDelivery.ts`・`notificationReminders.ts`・`reminderRules.ts`・`noticeTiming.ts`、`scripts/push-worker.mjs` | `push-devices.json` と活動キュー。配信フラグ・Expo設定・実機検証が必要 |

## 5. 写真展・フォーム・タイトルボード・配置図

`src/lib/` はサーバー処理とモデル、`src/scripts/` は画面操作です。名前の系統から担当領域を探せます。

| 領域 | 主なファイル・系統 | 役割 |
| --- | --- | --- |
| 参加・提出・管理 | `src/pages/Exhibition/[id].astro`、`src/pages/Member/exhibitions/`・`manage/exhibitions/`、`src/components/ExhibitionAdmin.astro` | 参加・提出・配置の入口。出展フォームも承認済み会員の認証が必要 |
| API・保存・検証 | `src/pages/api/exhibitions/`・`api/member/exhibitions/`・`api/member/exhibitions.ts`、`src/lib/exhibitions.ts`・`exhibitionTypes.ts`・`exhibitionValidation.ts`・`exhibitionParticipation.ts`・`exhibitionSubmissionLimits.ts` | `exhibitions.json`、添付、入力上限、参加・編集期間・権限 |
| フォーム操作 | `src/scripts/exhibitionAdmin.ts`・`exhibitionFormPreview.ts`・`exhibitionSubmission.ts`・`exhibitionSeriesEditor.ts` | 運営設定・設問プレビュー・会員の作品／組写真提出 |
| Google連携・転送・削除 | `src/lib/exhibitionIntegrations.ts`・`exhibitionGoogleGateway.ts`・`exhibitionDrive.ts`・`exhibitionSheetImport.ts`・`exhibitionDeletion.ts`、`gas/exhibition/Code.gs` | Forms・Sheets・Drive、署名・転送再試行。Google側の共有設定も別途管理 |
| ワーカー・導入 | `scripts/exhibition-worker.mjs`・`exhibition-google.mjs`・`exhibition-migrate.mjs` | キュー処理、接続・移行。導入コマンドの無条件再実行を避ける |
| タイトルボード・出力 | `src/lib/exhibitionBoards.ts`・`exhibitionLabels.ts`・`exhibitionLabelPositions.ts`・`exhibitionTitleBoardLayout.ts`・`exhibitionTitleBoardPreview.ts`・`exhibitionOutputs.ts`・`exhibitionQr.ts` | 作品・作者・Portfolio QR、PDF等の生成・配布 |
| 配置の正本・共同編集 | `src/lib/exhibitionLayoutModel.ts`・`exhibitionLayoutScene.ts`・`exhibitionLayoutChanges.ts`・`exhibitionLayoutHistory.ts`・`exhibitionCollaboration.ts`・`exhibitionLayoutAssets.ts` | 配置モデル・履歴・差分・ロック・presence。UIだけでモデルと食い違わせない |
| 展示室・図形・寸法 | `src/lib/exhibitionRoom*.ts`・`exhibitionOpeningPath.ts`・`exhibitionAnnotationPath.ts`・`exhibitionGeometry.ts`・`exhibitionDimensions.ts`・`exhibitionDimensionEditing.ts`・`exhibitionTransforms.ts`・`exhibitionRulerSnap.ts`・`exhibitionWallEquipment.ts` | 展示室保存・再利用、開口・注記・寸法・スナップ・設備 |
| 文字・ベクター | `src/lib/exhibitionRichText.ts`・`exhibitionText*.ts`・`exhibitionSvgText.ts`・`exhibitionVector*.ts`、`src/scripts/exhibitionTextEditor.ts`・`exhibitionVectorTools.ts` | リッチテキスト・計測・SVG・文字アウトライン |
| 配置画面の操作 | `src/scripts/exhibitionLayout*.ts`・`exhibitionRoomEditor.ts`・`exhibitionSurfaceEditor.ts`、`src/styles/Exhibitions.css` | 選択・追加・同期・履歴・書き出し・展示室編集 |

細かな運用は[写真展資料](exhibition-tool.md)を参照してください。

## 6. 会計・立替申請

| 領域 | 主なファイル | 保存先・役割 |
| --- | --- | --- |
| 会員の申請 | `src/pages/Member/advance.astro`、`src/scripts/advanceForm.ts`、`src/styles/AdvanceForm.css` | 確認画面・申請・返金方法・添付 |
| 受付・添付・署名 | `src/pages/api/member/advances.ts`・`receipts/upload.ts`、`src/lib/advanceRequests.ts`・`advanceReceipts.ts`・`signedEnvelope.ts` | `advance-requests.json`・`REC-*`。受付IDを維持して二重登録を防ぐ |
| 再送 | `scripts/advance-worker.mjs` | Google転送。失敗時に新番号で二重申請しない |
| Google受付 | `gas/intake/Code.gs`・`appsscript.json` | 署名検証・申請行追加・領収書連携・名簿読取 |
| 会計担当者画面・計算 | `gas/accounting/Core.gs`・`Main.gs`・`Index.html`・`appsscript.json` | 非公開の画面・承認・返金・集計。一般会員へ台帳の閲覧権限を与えない |

Googleへの配置・トリガー・名簿参照・年度更新は[会計資料](accounting.md)を参照してください。

## 7. 共通デザイン・基盤・公開設定

| 領域 | 主なファイル | 確認事項 |
| --- | --- | --- |
| 共通枠・権限別枠 | `src/layouts/Layout.astro`・`Mypost_Layout.astro`・`Gallery_Layout.astro`・`AdminLayout.astro`・`MemberLayout.astro`・`StaffLayout.astro` | フォント・head・本文枠・メニュー。一般／運営／管理画面を確認 |
| ナビゲーション | `src/components/header.astro`・`footer.astro`・`Breadcrumbs.astro`・`PageTopNav.astro`、`src/lib/breadcrumbs.ts` | メニュー・挨拶・パンくず・先頭リンク。ログイン有無を確認 |
| 共通CSS・案内 | `src/styles/global.css`・`UA+reset.css`・`textLinks.css`・`SiteNotice.css`・`footer.css`、`src/scripts/siteNotice.ts` | リセット・共通リンク・キーボード操作・案内 |
| サイト情報の管理 | `src/pages/Admin/content/[key].astro`、`src/pages/api/admin/content/[key].ts`・`media.ts`、`src/scripts/contentEditor.ts`、`src/lib/siteContent.ts`・`contentSecurity.ts`、`src/data/siteDefaults.ts` | 7編集区分、下書き・公開・復元・revision。`src/styles/Admin.css` |
| アプリ向けWeb連携 | `src/scripts/mobileBridge.ts`、`src/styles/MobileApp.css`、`src/pages/api/member/app-context.ts`・`push-devices.ts`、`src/pages/.well-known/` | WebView向け表示・端末登録・Universal Links／App Links |
| 設定・取得・保存 | `src/lib/config.ts`・`microcms.ts`・`cache.ts`・`http.ts`・`store.ts`・`dataDir.ts` | 環境変数、キャッシュ、送信上限・Origin、保存先・ロック・原子的保存 |
| 防御・監査 | `src/lib/security.ts`・`rateLimit.ts`・`imageSecurity.ts`・`audit.ts`・`signedEnvelope.ts`、`src/middleware.ts` | ヘッダー・頻度制限・画像再生成・監査・GAS署名 |
| ビルド・依存 | `astro.config.mjs`・`package.json`・`yarn.lock`・`tsconfig.json`・`.env.example` | site・SSR・CSP、Node制約・依存・型検査・設定項目 |
| 配置・画面検証 | `ecosystem.config.cjs`、`deploy/`、`scripts/server-*.sh`、`playwright.config.ts`・`tests/serve-fixtures.mjs` | PM2・Nginx・SSH、3ブラウザ。隔離データで実会員への送信を避ける |

`mobile/`・`video-guide/`・旧 `next-app/` はローカルにあってもGit管理外です。これらを前提にWebのビルド・テストを追加しません。
