import { adminViewPath, adminViewReturnLabel, previewRoles } from './adminViewPolicy.ts';
import { isStaff, isExecutive, readUsers, canManageAccount, type User } from './auth.ts';
import { roleLabels, hasRole, type Role } from './roles.ts';
import { readActivities } from './activities.ts';
import { readExhibitions } from './exhibitions.ts';
import { participationState } from './exhibitionParticipation.ts';
import { readShiftStore } from './exhibitionShiftStore.ts';
import { memberShiftState } from './exhibitionShifts.ts';
import { listTools, viewQuestion, manageResults } from './memberTools.ts';
import { readDeletionRequests } from './accountDeletionRequests.ts';
import { readGroupingTools } from './groupingTools.ts';
import { canApproveRegistration } from './accountReview.ts';
import { isMemberAccount } from './accountVisibility.ts';
import type { HelpGuide, HelpStep, HelpChoice } from './helpTypes.ts';

type Blueprint = { id: string; title: string; description: string; aliases: string[]; category: string; minimum?: Role; entry: string; match: RegExp; steps: (path: string) => HelpStep[]; detail?: boolean };
const step = (path: string, id: string, title: string, text: string, target?: string, extra: Partial<HelpStep> = {}): HelpStep => ({ path, id, title, text, target, ...extra });
const fields = (selector: string): HelpStep['complete'] => ({ kind: 'fields', selector });
const otherRefundMethod = (method: 'paypay' | 'bank'): HelpStep['complete'] => ({ kind: 'present', selector: `#refund-method option:not([value="${method}"]):checked` });
const overview = (p: string, text: string) => step(p, 'overview', 'このページでできること', text, 'main h2, main .section-title h1, main h1');
const b = (id: string, title: string, description: string, aliases: string[], entry: string, match: RegExp, steps: Blueprint['steps'], minimum?: Role, detail = false): Blueprint => ({ id, title, description, aliases, entry, match, steps, minimum, detail, category: minimum === 'admin' ? 'サイト管理' : minimum === 'executive' ? '幹部・管理者' : minimum === 'staff' ? '運営' : minimum === 'member' ? '会員' : '公開ページ' });

const blueprints: Blueprint[] = [
  b('home', 'ホームの見方', '活動紹介と写真から各ページへ移動します。', ['ホーム', '写真を見る', 'トップページ'], '/', /^\/$/, p => [
    step(p, 'overview', 'このページでできること', 'トップページから活動紹介を読み、掲載作品や最新の記事を開けます。', 'main .main-visual h1, main h1'),
    step(p, 'main-photo', 'メイン写真を拡大する', 'ページ上部の写真を押すと、作品を大きく表示できます。', '[data-photo-group="home-main"] .photo-open, .photo-open[data-photo-group="home-main"]', { details: ['photo-details'] }),
    step(p, 'film', 'フィルムの写真を選ぶ', 'フィルムを横に動かして見たい写真を探し、押して開きます。', '[data-photo-group="home-film"] .photo-open, .photo-open[data-photo-group="home-film"]', { details: ['photo-details'] }),
    step(p, 'activity', '活動の記事一覧へ移動する', '「Activity」へのリンクから、サークルの活動を記事ごとに確認できます。', 'main a[href="/Activity"]'),
    step(p, 'navigation', 'サイトのメニューを開く', '右上のメニューからGallery、Portfolio、サークル紹介などへ進めます。', '#hamburger-menu, #header-nav'),
  ]),
  b('about', 'サークル情報を調べる', '活動場所、年間予定、機材、よくある質問を確認します。', ['サークル', '会費', '場所', '年間予定', '機材', '入会'], '/About_us', /^\/About_us\/?$/, p => [
    step(p, 'overview', 'このページでできること', '入会前に知りたい所在地・会費・年間予定をこのページで確認できます。', '#about-us-title'),
    step(p, 'information', '所在地と会費を確認する', '基本情報で活動場所、会費、所属について確認してください。', '#information-title'),
    step(p, 'map', '地図で場所を確認する', '所在地の地図で活動場所の周辺を確認できます。', '#map'),
    step(p, 'schedule', '年間予定の時期を選ぶ', '見たい時期のタブを押し、表示する予定を切り替えます。', '.tab > label[for="tab1"]'),
    step(p, 'schedule-card', '予定の内容を見る', '表示中のカードで活動の内容と時期を確認します。', '.tab-content .card-cover'),
    step(p, 'equipment', '機材・設備を見る', '利用できる機材や暗室などの設備を確認してください。', '#equipments-title'),
    step(p, 'faq', 'よくある質問を見る', '見学や入会について知りたい項目をFAQから探してください。', '#faqs-title'),
    step(p, 'contact', '見学や入会について問い合わせる', '個別の相談があるときはお問い合わせへ進んでください。', 'main a[href="/Contact"]'),
  ]),
  b('activity', '活動記事を探す', '活動内容を絞り込み、記事を読みます。', ['活動', '記事', 'ブログ', '撮影会の様子'], '/Activity', /^\/(?:Activity|posts\/[^/]+)\/?$/, p => p === '/Activity' ? [
    overview(p, '記事をテーマ別に絞り込み、活動や撮影会の様子を確認できます。'),
    step(p, 'category', '記事のテーマを選ぶ', 'タブを押すと、選んだテーマに該当する記事が表示されます。', '.tab-header-scroll .tab-label'),
    step(p, 'select', '読みたい記事を開く', '見出しや写真を手がかりに記事を選びます。', 'main a[href^="/posts/"]'),
    step(p, 'more', '次の一覧ページへ進む', '同じテーマの記事が複数ページある場合は、一覧の矢印やページ番号を押します。', '.is-active .next-btn, .is-active .next-btn-top'),
  ] : [
    step(p, 'overview', 'このページでできること', '記事の本文と掲載写真を読むことができます。', 'main h1, main h2'),
    step(p, 'photo', '記事の写真を拡大する', '本文に写真がある場合は、押して拡大画面を開きます。', '.photo-open', { details: ['photo-details'] }),
    step(p, 'more', '活動の記事一覧に戻る', 'ページ下部の戻るリンクで、ほかの記事を探せます。', '#post-back-link'),
  ]),
  b('gallery', 'Galleryの写真を見る', 'アルバムを選び、写真を拡大して確認します。', ['ギャラリー', 'アルバム', '写真を見る'], '/Gallery', /^\/Gallery(?:\/[^/]+)?\/?$/, p => [overview(p, '公開されている写真やアルバムを閲覧できます。'), step(p, 'album', 'アルバム・写真を選ぶ', '一覧のアルバムや写真を押して開きます。', 'main a[href^="/Gallery/"], .photo-open, main img'), step(p, 'photo', '写真の情報を見る', '拡大画面では撮影情報やいいねを確認できます。閲覧できる範囲はログイン状態に応じて変わります。', '.photo-open', { details: ['photo-details'] })]),
  b('portfolio', 'Portfolioを見る', 'メンバーを探し、作品とプロフィールを見ます。', ['ポートフォリオ', 'メンバーを探す', '作品を見る'], '/Portfolio', /^\/Portfolio(?:\/(?!edit(?:\/|$))[^/]+)?\/?$/, p => [overview(p, 'メンバーのプロフィールと作品を閲覧できます。'), step(p, 'find', 'メンバー・作品を選ぶ', '検索や絞り込み、一覧のカードから気になるメンバーを選んでください。', 'main input[type="search"], main a[href^="/Portfolio/"], main img'), step(p, 'share', '作品やリンクを共有する', '写真は押して拡大できます。共有ボタンからリンクやQRコードを確認できます。', '[data-portfolio-share-open], .photo-open, main img', { details: ['photo-details'] })]),
  b('contact', 'お問い合わせを送る', '必要事項を入力して内容を確認し、送信します。', ['問い合わせ', '連絡', '相談したい', '見学したい'], '/Contact', /^\/Contact\/?$/, p => [overview(p, 'お問い合わせの内容を入力し、確認画面から送信できます。'), step(p, 'name', 'お名前を入力する', 'お名前とフリガナを入力してください。', '#contact-form [name="name"]', { complete: fields('#contact-form [name="name"], #contact-form [name="furigana"]') }), step(p, 'contact', '連絡先・所属を入力する', '所属・学年・メールアドレスなどの必須項目を入力してください。', '#contact-form [name="email"]'), step(p, 'message', '内容を記入する', '相談したいことを具体的に記入してください。', '#contact-form textarea', { complete: fields('#contact-form textarea') }), step(p, 'send', '確認して送信する', '確認画面で内容を読み、送信ボタンを押してください。案内の「次へ」では送信されません。', '#contact-form button[type="submit"], #contact-form button')]),
  b('login', 'ログインする', 'メールアドレスとパスワードでログインします。', ['ログイン', '会員ページに入りたい'], '/Login', /^\/Login\/?$/, p => [
    overview(p, '登録が承認されたアカウントのメールアドレスとパスワードでログインします。'),
    step(p, 'email', 'メールアドレスを入力する', '登録時に使ったメールアドレスを入力します。前後に空白がないか確認してください。', '#login-email', { complete: fields('#login-email') }),
    step(p, 'password', 'パスワードを入力する', '大文字・小文字を区別して入力します。パスワードが分からない場合は、この下の再設定リンクを利用できます。', '#login-password', { complete: fields('#login-password') }),
    step(p, 'remember', 'ログイン状態を保持するか選ぶ', '自分の端末で次回もログイン状態を使いたい場合はチェックします。共用端末では空欄のまま進みます。', '#login-form label:has([name="remember"]), #login-form [name="remember"]'),
    step(p, 'submit', 'ログインする', '入力内容を確認してログインボタンを押します。メールの確認を求められた場合は届いたコードを入力してください。', '#login-form button[type="submit"]'),
    step(p, 'reset', 'パスワードを再設定する場合', '登録メールを受信できる場合は、こちらから再設定リンクを送れます。', 'main a[href="/ForgotPassword"]'),
  ]),
  b('signup', 'アカウントを登録する', '登録内容とメールを確認し、承認を申請します。', ['登録', '新規会員', 'アカウントを作りたい'], '/Signup', /^\/Signup\/?$/, p => [
    overview(p, 'アカウント情報を入力し、メールの確認後に登録を申請します。'),
    step(p, 'name', 'アカウント名を入力する', '運営が登録内容と照合できる名前を入力してください。', '#signup-name', { complete: fields('#signup-name') }),
    step(p, 'portfolio-name', 'Portfolioの表示名を入力する', 'Portfolioに表示したい名前を入力してください。', '#signup-portfolio-name', { complete: fields('#signup-portfolio-name') }),
    step(p, 'credentials', 'メールアドレスを入力する', '確認コードと開設メールを受信できるアドレスを入力してください。', '#signup-email', { complete: fields('#signup-email') }),
    step(p, 'password', 'パスワードを設定する', '入力欄の下に表示される条件を確認して、パスワードを決めてください。', '#signup-password'),
    step(p, 'password-confirm', '同じパスワードをもう一度入力する', '確認欄に同じパスワードを入力し、打ち間違いがないか確認します。', '#signup-password-confirm'),
    step(p, 'verify', '確認コードを送信する', '入力内容を確認してコードを送るボタンを押してください。', '#signup-form button[type="submit"]'),
    step(p, 'code', '届いた確認コードを入力する', '登録したアドレス宛のメールを開き、届いたコードを入力します。', '#signup-code', { complete: fields('#signup-code') }),
    step(p, 'request', '登録を申請する', '確認コードを入力した画面の確定ボタンを押します。開設完了メールが届くとログインできます。', '#signup-form:has(#signup-verification:not([hidden])) button[type="submit"]'),
  ]),
  b('member-home', '通知・企画・マイページを使う', '自分宛の通知や参加する企画を確認します。', ['通知', '企画一覧', 'マイページ', 'カレンダー'], '/Member', /^\/Member\/?$/, p => [
    overview(p, '会員向けのお知らせ、参加できる企画、自分の登録情報への入口を確認できます。'),
    step(p, 'notices', '自分宛の通知を開く', 'タイトルを押して本文を読みます。開催が終わった企画・写真展の通知は一覧から外れます。', 'main a[href^="/Member/notifications/"], #notification-heading'),
    step(p, 'events', 'リストで開催前・開催中の企画を見る', '「リスト」には開催前・開催中の企画が並びます。過去の企画はカレンダーで確認できます。', 'main a[href^="?view=list"]'),
    step(p, 'calendar', 'カレンダーで過去の企画も見る', '「カレンダー」には開催済みの企画・写真展も表示されます。目的の月に切り替えて確認してください。', 'main a[href^="?view=calendar"]', { details: ['member-calendar'] }),
    step(p, 'event-link', '参加したい企画の詳細を開く', '企画名を押し、日時・場所と、回答が必要かを確認します。', 'main a[href^="/Member/events/"], main a[href^="/Member/exhibitions/"]'),
    step(p, 'shifts', '展示シフトを確認する', '展示シフト欄で、希望の提出状況や確定シフトを確認できます。開催が終わると一覧から外れます。', 'main a[href^="/Member/exhibitions/"][href$="/shifts"]'),
    step(p, 'account', '登録内容を確認する', '「班分け用プロフィール」へのリンクで、名簿から取得した自分の学年などを確認できます。', '#my-page a[href="/Member/profile"]'),
    step(p, 'security', 'アカウントの保護を開く', 'パスワードの再設定やアカウント削除の申請はこちらから確認できます。', '#my-page a[href="/Member/security"]'),
    step(p, 'advance', '立替申請へ進む', 'サークルのために支払った費用を精算するときに、立替申請を開きます。', '#my-page a[href="/Member/advance"]'),
  ], 'member'),
  b('portfolio-edit', '自分のPortfolioを編集する', 'プロフィールや単写真・組写真・ブックを編集して保存します。', ['作品を載せたい', 'プロフィール編集', 'ポートフォリオ編集', '写真を追加'], '/Portfolio/edit', /^\/Portfolio\/edit\/?$/, p => [
    overview(p, 'プロフィールを編集し、単写真・組写真・ブックを作品として掲載できます。'),
    step(p, 'name', 'プロフィールを入力する', 'Portfolioに表示する名前を変更できます。', '#field-name', { details: ['portfolio-introduction'] }),
    step(p, 'intro', '自己紹介を書く', '自己紹介欄に活動内容や得意な撮影分野などを記入します。装飾やリンクは詳しい案内から確認できます。', '#field-self-intro', { details: ['portfolio-introduction'] }),
    step(p, 'camera', '使用機材を書く', '紹介したいカメラやレンズがある場合は機材欄に入力します。', '#field-camera'),
    step(p, 'tags', 'タグを編集する', '作品や活動の特徴を示すキーワードを登録できます。', '#field-hashtags'),
    step(p, 'icon', 'プロフィール写真を選ぶ', 'アイコン用の画像を選び、プレビューで表示を確認します。', 'label[for="field-icon-file"], #field-icon-file'),
    step(p, 'photos', '単写真を追加する', '単写真の欄から画像を選びます。複数選んだ場合は、それぞれが別の作品になります。', 'label[for="picture-files"], #picture-files', { details: ['portfolio-photo'] }),
    step(p, 'series', '複数の写真を組写真として追加する', '画像を2枚以上選ぶと、配置と組全体の作品情報を編集できます。登録済みの写真から組を作る方法もあります。', 'label[for="series-files"]', { details: ['portfolio-series-edit'] }),
    step(p, 'book', 'PDFのブックを追加する', '「ブックを追加」を押して、閲覧用PDFと一覧に表示する表紙を選びます。', '[data-portfolio-book-create]', { details: ['portfolio-book-edit'] }),
    step(p, 'series-edit', '掲載済みの組写真を編集する', '組写真一覧から対象の「組写真を編集」を押すと、写真の組み合わせや配置を変えられます。', '[data-edit-portfolio-series]', { details: ['portfolio-series-edit'], complete: { kind: 'present', selector: 'body:not(:has([data-edit-portfolio-series]))' } }),
    step(p, 'book-edit', '掲載済みのブックを編集する', 'ブック一覧の「ブックを編集」から、表紙や紹介文などを更新できます。', '[data-edit-portfolio-book]', { details: ['portfolio-book-edit'], complete: { kind: 'present', selector: 'body:not(:has([data-edit-portfolio-book]))' } }),
    step(p, 'photo-edit', '作品の説明や撮影情報を編集する', '追加した作品の編集ボタンで、タイトル・説明・撮影情報を確認できます。', '#picture-list [data-photo-edit]', { details: ['portfolio-photo'] }),
    step(p, 'save', 'Portfolioを保存する', '単写真・組写真・ブックの内容を確認して「Save changes」を押し、公開ページに反映します。', '#submit-button'),
  ], 'member'),
  b('advance', '立替費用を申請する', '費用・領収書・返金先を確認して申請します。', ['立て替え', '立替', '精算', '領収書', '返金してほしい'], '/Member/advance', /^\/Member\/advance\/?$/, p => [
    step(p, 'overview', 'このページでできること', '立て替えた内容と返金先を記入し、確認画面から申請を送信します。', '#advance-heading'),
    step(p, 'expense', '立替日を入力する', '領収書などを見ながら、支払った日を指定します。', '#expense-date', { complete: fields('#expense-date') }),
    step(p, 'amount', '金額を入力する', '立て替えた金額を円で入力してください。', '#advance-amount', { complete: fields('#advance-amount') }),
    step(p, 'item', '費用の用途を入力する', '何に使った費用か分かる名前を入力します。', '#advance-item', { complete: fields('#advance-item') }),
    step(p, 'receipt', '領収書を添付する', 'JPEG・PNG・WebP・PDFのうち、10MB以下のファイルを1つ選びます。', '#receipt-file'),
    step(p, 'refund', '希望の返金方法を選ぶ', '口座振込、PayPay、現金手渡しから選びます。選んだ方法に必要な記入欄が表示されます。', '#refund-method'),
    step(p, 'paypay', 'PayPay連絡用のLINE名を入力する', '会計担当者が連絡できるLINEの表示名を入力します。', '#refund-line-name:not(:disabled)', { complete: otherRefundMethod('paypay') }),
    step(p, 'bank', '銀行名を入力する', '振込先の銀行名を入力します。', '#refund-bank-name:not(:disabled)', { complete: otherRefundMethod('bank') }),
    step(p, 'bank-name', '口座名義を入力する', '振込先の口座名義を、銀行に登録している表記で入力します。', '#refund-bank-account-name:not(:disabled)', { complete: otherRefundMethod('bank') }),
    step(p, 'branch', '支店名を入力する', '振込先の支店名を入力します。', '#refund-bank-branch-name:not(:disabled)', { complete: otherRefundMethod('bank') }),
    step(p, 'branch-code', '店番号を入力する', '先頭の0を含め、3桁の店番号を入力します。', '#refund-bank-branch-code:not(:disabled)', { complete: otherRefundMethod('bank') }),
    step(p, 'account-number', '口座番号を入力する', '先頭の0を含め、振込先の口座番号を入力します。', '#refund-bank-account-number:not(:disabled)', { complete: otherRefundMethod('bank') }),
    step(p, 'applicant', '名簿上の氏名を入力する', '会計担当者が照合できるよう、名簿上の氏名を入力します。', '#roster-name', { complete: fields('#roster-name') }),
    step(p, 'confirm', '入力内容の確認画面を開く', '「Confirm」で領収書・金額・返金先を確認できる画面を開きます。', '#advance-form button[type="submit"]'),
    step(p, 'send', '立替申請を送信する', '確認画面で内容が合っていれば送信ボタンを押し、送信結果を確認してください。', '#advance-send'),
  ], 'member'),
  b('security', 'アカウントの保護を確認する', '二段階認証とパスワードの管理方法を確認します。', ['パスワード変更', '二段階認証', '安全設定'], '/Member/security', /^\/Member\/security\/?$/, p => [
    overview(p, 'アカウントの安全設定を確認できる画面です。'),
    step(p, 'mfa', '二段階認証の条件を確認する', '運営以上は、ログイン時に登録メールへ届く確認コードが必要です。画面の説明で利用条件を確認できます。', 'main h3'),
    step(p, 'password', 'パスワード再設定の画面を開く', '登録メールへ再設定リンクを送るには、こちらを押してください。', 'main a[href="/ForgotPassword"]'),
    step(p, 'deletion', 'アカウント削除申請の案内を読む', '退会でアカウントを削除する場合は、本人確認と削除対象の説明を確認してください。', 'main a[href="/Member/account-deletion"]'),
  ], 'member'),
  b('management', '管理・運営の機能を選ぶ', '企画・通知・写真展・班分けを管理します。', ['運営', '管理運営', 'ツール一覧'], '/Management', /^\/(?:Management|Dashboard)\/?$/, p => [
    overview(p, '運営向けの入口です。目的のカードを押すと各画面を開けます。'),
    step(p, 'events', '新しい企画を作る', '撮影会などの日時や参加回答の期限を設定するには企画作成を開きます。', 'main a[href="/Member/manage/events/new"]'),
    step(p, 'notifications', '通常のお知らせを送る', '会員に連絡を送る場合は通知作成を開きます。', 'main a[href="/Member/manage/notifications"]'),
    step(p, 'tools', '投票・日程調整・目安箱を使う', '回答を集めるときはツール一覧を開き、質問の種類を選びます。', 'main a[href="/Member/manage/tools"]'),
    step(p, 'exhibition', '写真展の受付・展示を管理する', '写真展を選んで参加受付、作品提出、シフト、展示レイアウトを管理します。', 'main a[href="/Member/manage/exhibitions"]'),
    step(p, 'grouping', '班分けの案を作る', '名簿から参加者を選んで新しい班分けを作るか、保存済みの班案を開きます。', 'main a[href="/Member/manage/grouping"]'),
    step(p, 'preview', 'ロール別の見え方を確認する', '各ロールの表示は閲覧専用の確認画面から切り替えられます。', 'main a[href="/Management/view"]'),
  ], 'staff'),
  b('event-create', '企画を作成・公開する', '企画の内容、参加期限、通知先を設定します。', ['イベント作成', '撮影会を作りたい', '企画作成'], '/Member/manage/events/new', /^\/Member\/manage\/events\/new\/?$/, p => [
    overview(p, '企画の基本情報と参加受付を設定し、確認画面で公開します。'),
    step(p, 'category', '企画の種類を選ぶ', '企画の内容に合う種類を選びます。カレンダーで予定の区別に使われます。', '#activity-event-form [name="category"]'),
    step(p, 'title', '企画名を入力する', '会員に表示される企画名を入力してください。', '#activity-event-form [name="title"]'),
    step(p, 'description', '企画内容を書く', '参加する人が内容と持ち物を把握できるよう、必要な説明を書きます。', '#activity-event-form [name="description"]'),
    step(p, 'dates', '開始日時を指定する', '日本時間の開催日と開始時刻を設定します。', '#activity-event-form [name="startsAt"]'),
    step(p, 'end', '終了日時を指定する', '予定の終了日時を入力します。複数日にわたる場合も実際の終了日時を指定してください。', '#activity-event-form [name="endsAt"]'),
    step(p, 'deadline', '参加回答の提出期限を指定する', '回答を集めたい日時を設定します。期限後は会員に警告が表示され、開催日からは投票を変更できなくなります。', '#activity-event-form [name="deadline"]'),
    step(p, 'owner', '企画担当者を選ぶ', '担当者を確認し、表示する会員を選んでください。', '#activity-event-form [name="ownerId"]'),
    step(p, 'meeting', '集合場所を書く', '集合場所や目印があれば記入してください。', '#activity-event-form [name="meeting"]'),
    step(p, 'recipients', '通知先の会員を選ぶ', '検索や学年の絞り込みを使い、通知する会員にチェックを付けます。', '#activity-event-form [data-recipient-search], #activity-event-form [data-recipient-id]'),
    step(p, 'save', '下書きを保存して確認する', '入力を終えたら「下書きを保存して確認」を押し、内容の確認画面へ進みます。', '#activity-event-form button[type="submit"]'),
    step('/Member/manage/events/*', 'publish', '企画を公開する', '開催日時と通知先を確認して「公開する」を押すと、参加受付と通知が始まります。確認画面を閉じた場合は「下書きを保存して確認」から開き直せます。', '[data-activity-action="event.publish"] button[type="submit"], #activity-event-form button[type="submit"]'),
  ], 'staff'),
  b('notification-send', '通常のお知らせを送信する', '通知先と本文を確認してお知らせを送ります。', ['お知らせ送信', '通知を送りたい', '連絡したい'], '/Member/manage/notifications', /^\/Member\/manage\/notifications\/?$/, p => [
    overview(p, '会員を選び、通常のお知らせを送信できます。'),
    step(p, 'title', 'お知らせのタイトルを入力する', '通知一覧で内容が分かる短いタイトルを記入します。', '[data-activity-action="notification.send"] [name="title"]', { complete: fields('[data-activity-action="notification.send"] [name="title"]') }),
    step(p, 'body', 'お知らせの本文を入力する', '伝えたい内容と、会員に確認してほしいことを本文に書きます。', '[data-activity-action="notification.send"] [name="body"]', { complete: fields('[data-activity-action="notification.send"] [name="body"]') }),
    step(p, 'recipient', '宛先を検索する', '名前を入力して宛先候補を絞り込みます。', '[data-activity-action="notification.send"] [data-recipient-search]'),
    step(p, 'check-recipient', '通知する会員を選ぶ', '対象のチェックを確認します。学年別にまとめて選択することもできます。', '[data-activity-action="notification.send"] [data-recipient-id]'),
    step(p, 'send', 'お知らせを送信する', '本文と宛先の人数を確認してから送信ボタンを押してください。', '[data-activity-action="notification.send"] button[type="submit"]'),
  ], 'staff'),
  b('tools-manage', '投票・日程調整・目安箱を作成する', '質問を作り、受付と結果公開を設定します。', ['アンケート作成', '投票を作りたい', '日程調整', '目安箱'], '/Member/manage/tools', /^\/Member\/manage\/tools(?:\/[^/]+)?\/?$/, p => p === '/Member/manage/tools' ? [
    overview(p, '投票、日程調整、目安箱の下書きを作るか、作成済みの質問を編集できます。'),
    step(p, 'create', '投票を作る', '選択肢の中から回答を集めるときは「投票」を押します。', '[data-create-tool="poll"]'),
    step(p, 'schedule', '日程調整を作る', '候補日ごとの都合を聞きたいときは「日程調整」を押します。', '[data-create-tool="schedule"]'),
    step(p, 'box', '目安箱を作る', '自由記述の意見を集めたいときは「目安箱」を押します。', '[data-create-tool="box"]'),
    step(p, 'find', '作成済みの質問を検索する', '質問名などを入力して一覧を絞り込みます。', '[data-tool-search]'),
    step(p, 'existing', '作成済みの質問を開く', '対象のカードから受付や結果の管理を開きます。', '[data-tool-list-item] a, [data-tool-list-item]'),
  ] : [
    overview(p, '質問の設定、回答受付、結果公開をこの画面から管理します。'),
    step(p, 'question', '質問文を編集する', '回答する人に表示する質問を入力します。', '[data-tool-editor] [name="question"]'),
    step(p, 'options', '選択肢または候補日を設定する', '投票では選択肢を、日程調整では候補日を設定します。目安箱では質問文を確認してください。', '[data-add-option], [data-tool-calendar], [data-tool-editor] [name="question"]'),
    step(p, 'recipients', '回答してほしい会員を選ぶ', '通知先の一覧から、質問に回答してほしい会員を指定します。', '[data-tool-editor] [data-recipient-id]'),
    step(p, 'settings', '受付日時と回答の設定を確認する', '設定を開くと、受付日時や匿名回答などの項目が確認できます。', '[data-tool-editor] details.tool-settings > summary', { details: ['tool-settings'] }),
    step(p, 'preview', '保存して確認画面を開く', '編集した質問と通知先を保存し、確認画面に進みます。', '[data-tool-editor] button[type="submit"]'),
    step(p, 'publish', '下書きを公開する', '確認画面で質問と通知先を確認して「公開する」を押します。', '[data-publish-tool]'),
    step(p, 'results', '受付を終了・再開する', '受付を手動で切り替えるには、このボタンを使います。', '[data-toggle-reception]'),
    step(p, 'publication', '結果公開の設定を確認する', '結果の公開先や時期は公開設定で確認できます。', '[data-publication-settings] > summary', { details: ['tool-publication', 'tool-permissions'] }),
  ], 'staff'),
  b('exhibition-manage', '写真展を管理する', '参加投票、出展フォーム、提出状況とレイアウトを管理します。', ['写真展管理', '写真展を作りたい', '参加者確認', '提出状況'], '/Member/manage/exhibitions', /^\/Member\/manage\/exhibitions(?:\/[^/]+(?:\/(?:form|participants|submissions|layout|shifts))?)?\/?$/, p => [overview(p, '写真展の参加受付、作品提出、展示準備を管理します。'), step(p, 'settings', '写真展・受付を設定する', '写真展を選び、参加投票と出展フォームの期間・対象者を設定します。', '#exhibition-admin h2, #exhibition-admin input, main h2'), step(p, 'work', '提出や展示を管理する', 'フォーム設定、参加者、提出状況、展示レイアウトの各画面から作業します。', '#exhibition-admin nav, #exhibition-admin', { details: ['exhibition-form', 'exhibition-submissions', 'layout-basic', 'layout-draw', 'layout-align', 'layout-dimensions', 'layout-history'] })], 'staff'),
  b('grouping', '班分けを作成する', '参加者と条件を選び、班案を生成・調整・確定します。', ['グループ分け', '班分け', '自動生成', '班を作りたい'], '/Member/manage/grouping', /^\/Member\/manage\/grouping(?:\/[^/]+)?\/?$/, p => [overview(p, '参加者と条件を確認し、班案を生成・調整できます。'), step(p, 'participants', '参加者を選ぶ', '名簿から参加者を選び、人数や前回の班分けを確認します。', '[data-grouping-participants], main [name="title"]'), step(p, 'rules', '条件を設定する', 'リーダー、人数、同班・別班の希望などを確認して生成します。', '[data-activity-action="groups.generate"], [data-activity-action="run.generate"], main form'), step(p, 'confirm', '班案を調整して確定する', '警告を確認し、必要ならメンバーを交換して保存・公開します。', '[data-group-board], .group-board, main h2', { details: ['group-export'] })], 'staff'),
  b('admin', '管理機能を使う', '権限に応じてアカウント・会計・名簿などを管理します。', ['管理画面', 'Admin'], '/Admin', /^\/Admin\/?$/, p => [
    overview(p, '幹部・管理者が担当する業務を選ぶ画面です。'),
    step(p, 'accounts', 'アカウント管理を開く', '登録内容を検索し、承認待ちの申請や会員の詳細を確認できます。', 'main a[href="/Admin/accounts"]'),
    step(p, 'deletions', '削除申請を確認する', '申請が届いた場合は、一覧から処理期限と本人確認の状態を確認できます。', 'main a[href="/Admin/account-deletion-requests"]'),
    step(p, 'accounting', '会計を開く', '会計では収支、立替申請の確認、未返金の明細を扱います。', 'main a[href="/Admin/accounting"]'),
    step(p, 'roster', '名簿の管理を開く', 'Googleフォームから取得する名簿の内容や、アカウントとの連携を確認します。', 'main a[href="/Admin/grouping-roster"]'),
    step(p, 'forms', '入会・継続・新歓フォームを開く', 'フォームの作成や回答受付の開始・終了を設定できます。', 'main a[href="/Admin/club-forms"]'),
    step(p, 'photos', '写真のランキングを開く', 'いいねの集計と掲載先ごとのランキングを見られます。', 'main a[href="/Admin/photos"]'),
    step(p, 'view', 'ロール別表示を確認する', '権限ごとに表示される画面を確認できます。', 'main a[href="/Admin/view"]'),
  ], 'executive'),
  b('accounts', 'アカウントを探す・編集する', '登録内容を検索し、承認や編集へ進みます。', ['会員管理', '登録内容', '権限変更', 'アカウント検索'], '/Admin/accounts', /^\/Admin\/accounts(?:\/[^/]+)?\/?$/, p => [overview(p, '登録内容を確認し、権限の範囲でアカウントを管理できます。'), step(p, 'find', 'アカウントを選ぶ', '名前などで検索できます。「承認待ち」から新規申請を絞り込めます。', '#account-query, main .admin-intro h2'), step(p, 'edit', '登録内容を確認する', '対象者の詳細で氏名・メール・権限を確認し、必要な操作を選びます。', '#account-editor, main [aria-label="登録内容"], main .admin-account-list')], 'executive'),
  b('accounting', '会計を管理する', '収支・申請・立替返金・残高を確認します。', ['会計', '通帳', '収支', 'お金', '返金管理'], '/Admin/accounting', /^\/Admin\/accounting\/?$/, p => [
    overview(p, '作業に合わせてタブを選ぶと、対応する会計画面を表示します。'),
    step(p, 'summary', '概要で残高と月ごとの収支を見る', '概要では銀行と現金の残高、未返金額、月ごとの入出金を確認できます。', '#accounting-nav [data-tab="summary"]'),
    step(p, 'ledger', '口座別の通帳を表示する', '表示する口座を銀行または現金に切り替えると、その取引の一覧を見られます。', '[name="ledger-account"]', { activate: '#accounting-nav [data-tab="summary"]' }),
    step(p, 'transaction', '取引の記録を開く', '収入、支出、資金移動などの取引を記録するときは、取引記録を開きます。', '#accounting-nav [data-tab="transaction"]'),
    step(p, 'request-tab', '立替申請を確認する', '申請者、費用、領収書を確認し、承認または却下に進みます。', '#accounting-nav [data-tab="requests"]', { details: ['accounting-requests'] }),
    step(p, 'advance-tab', '未返金の立替を確認する', '立替・返金タブで対象者と未返金額を見られます。', '#accounting-nav [data-tab="advances"]', { details: ['accounting-refunds'] }),
    step(p, 'checks', '実残高の照合を開く', 'その日の取引を記録したあと、銀行や現金の実残高を入力し、差額を確認できます。', '#accounting-nav [data-tab="checks"]'),
    step(p, 'roster', '会計の人物対応を開く', '会計の人物と共通名簿の対応を確認するときは、名簿タブを開きます。', '#accounting-nav [data-tab="roster"]', { details: ['accounting-roster'] }),
    step(p, 'settings', '会計の設定を開く', '記録を開始した日、開始時の残高、表示年度を確認できます。', '#accounting-nav [data-tab="settings"]'),
    step(p, 'recover', '中断した保存の確認方法', '中断した操作がある場合は、画面に出る再確認の案内に従います。', '#accounting-retry-button, #accounting-issues .accounting-notice', { details: ['accounting-recover'] }),
  ], 'executive'),
  b('roster', '名簿を管理する', 'Google名簿を確認し、アカウントとの対応を保存します。', ['名簿更新', '名簿連携', '会員対応'], '/Admin/grouping-roster', /^\/Admin\/grouping-roster(?:\/preview)?\/?$/, p => [overview(p, '名簿の取得内容とアカウントとの対応を確認します。'), step(p, 'load', '参照先と名簿を確認する', '参照先と更新内容を確認してから反映してください。', 'main form, main h2'), step(p, 'link', '本人との対応を確認する', '候補の一致だけで確定せず、本人の回答を確認して連携を保存します。', 'main select, main form')], 'executive'),
  b('club-forms', '入会・継続・新歓フォームを管理する', 'フォームを作成し、受付と回答を管理します。', ['入会フォーム', '継続フォーム', '新歓フォーム', 'フォーム期限'], '/Admin/club-forms', /^\/Admin\/club-forms\/?$/, p => [
    overview(p, '年度ごとの入会・継続フォームや、新歓企画のフォームを管理します。'),
    step(p, 'kind', '作成するフォームの種類を選ぶ', '入会、継続、新歓から作成するフォームを選んでください。', '[data-club-action="create"] [name="kind"]'),
    step(p, 'year', '対象年度を指定する', '名簿に反映する年度や、新歓を行う年を指定します。', '[data-club-action="create"] [name="year"]'),
    step(p, 'season', '季節を指定する', '表示される季節の選択欄で、対象の時期を選んでください。', '[data-club-action="create"] [name="season"]'),
    step(p, 'create', 'フォームを作成する', '指定内容を確認して作成ボタンを押します。作成したフォームは一覧から確認できます。', '[data-club-action="create"] button[type="submit"]'),
    step(p, 'capacity', '定員を設定する', '対象のフォームを開き、定員がある場合は人数を入力します。', '[data-club-card] [name="capacity"]'),
    step(p, 'deadline', '受付期限を指定する', '受付を終了したい日時を設定します。', '[data-club-card] [name="deadline"]'),
    step(p, 'open', '回答の受付を開始する', 'フォームの内容を確認し、対象フォームの受付を開始します。', 'button[data-club-action="open"], [data-club-action="open"] button'),
    step(p, 'answers', 'フォームと回答先を確認する', 'カード内のリンクからフォームや回答を確認できます。', '[data-club-card] a'),
    step(p, 'close', '回答の受付を終了する', '手動で終了する場合は、対象のフォームを確かめて受付終了を押します。', 'button[data-club-action="close"], [data-club-action="close"] button'),
  ], 'executive'),
  b('photos-admin', '写真のいいねランキングを見る', 'ランキングを絞り込み、写真といいねを確認します。', ['写真ランキング', 'いいねランキング', '人気の写真'], '/Admin/photos', /^\/Admin\/photos\/?$/, p => [
    overview(p, '写真についたいいねを、掲載先や順位で確認できます。'),
    step(p, 'total', '合計いいねを確認する', '選択中の掲載先についたいいねの合計です。', '[data-photo-summary="totalLikes"]'),
    step(p, 'count', 'いいねのある写真数を確認する', 'いいねが一件以上付いている写真の枚数です。', '[data-photo-summary="likedPhotos"]'),
    step(p, 'filter', '掲載先を切り替える', '全体や、特定の掲載先だけに絞り込めます。', '#photo-container'),
    step(p, 'open', 'ランキングの写真を開く', '順位といいね数を確認し、写真を押して詳細表示を開きます。', '[data-photo-manager-list] .photo-open'),
    step(p, 'next', '次の順位を見る', '写真が複数ページに分かれる場合は、「次へ」で次の順位を見られます。', '[data-photo-manager-next]'),
  ], 'executive'),
  b('content-edit', 'サイトの文章・写真を編集する', '下書きを保存し、プレビューを確認して公開します。', ['ホーム編集', '文章変更', 'サイト編集', 'ページ編集'], '/Admin/content/home', /^\/Admin\/content\/[^/]+\/?$/, p => [
    overview(p, 'ページの掲載内容は下書きに保存し、表示を確認してから公開します。'),
    step(p, 'toc', '編集したい項目へ移動する', '目次の項目を選ぶと、対応する編集欄へ移動します。', '#editor-toc-list a'),
    step(p, 'edit', '文章や項目を編集する', '該当する項目の入力欄で掲載内容を編集します。', '#editor-fields input:not([type="hidden"]), #editor-fields textarea'),
    step(p, 'photos', 'ホームに出す作品写真を選ぶ', 'ホームの写真を変更する場合は、写真の除外設定から対象の作品を選びます。', '[aria-controls="home-photo-picker"]', { details: ['home-photo-settings'] }),
    step(p, 'save', '下書きを保存する', '入力を終えたら下書きを保存します。公開前にプレビューで確認できます。', '#content-editor button[type="submit"]'),
    step(p, 'preview', 'プレビューを開く', '公開時の表示を見て、文章や写真の位置を確認してください。', '#preview-content'),
    step(p, 'publish', '公開の確認画面を開く', 'プレビューに問題がなければ公開ボタンを押します。', '#publish-content'),
    step(p, 'confirm', '公開を確定する', '確認画面で対象ページを確認し、「公開する」を押します。', '#publish-confirm button.admin-button'),
  ], 'admin'),
  b('push-status', 'プッシュ通知の配信状況を見る', '送信待ち・配信結果・失敗を確認します。', ['配信状況', 'プッシュ通知', '通知失敗'], '/Admin/notifications', /^\/Admin\/notifications\/?$/, p => [
    overview(p, '端末向けのアプリ通知が、どこまで配信処理されたかを確認します。'),
    step(p, 'configuration', '配信の設定状態を確認する', '配信の有効・停止とExpo認証の設定状態を確認できます。', 'main h2 + p'),
    step(p, 'queue', '送信待ちと配信結果待ちを確認する', '集計から処理待ちの件数と失敗した件数を確認します。', 'main h2 + p + p'),
    step(p, 'failure', '失敗の内訳を読む', '失敗がある場合は、エラー番号ごとの件数が表示されます。', 'main section:has(h3) h3'),
    step(p, 'compose', 'お知らせの作成画面へ移動する', '会員に新しいお知らせを送りたい場合は、ここから送信画面を開きます。', 'main a[href="/Member/manage/notifications"]'),
  ], 'admin'),
];

for (const [kind, label, aliases] of [
  ['poll', '投票', ['投票を作りたい', 'アンケートを作る']],
  ['schedule', '日程調整', ['日程調整を作りたい', '予定を合わせたい']],
  ['box', '目安箱', ['目安箱を作りたい', '意見を集めたい']],
] as const) blueprints.push(b(`tool-create-${kind}`, `${label}を作成して公開する`, `${label}の下書き作成から質問・通知先の設定、確認、公開まで案内します。`, [...aliases], '/Member/manage/tools', /^$/, p => [
  step(p, 'create', `${label}を作成する`, `「${label}」を押すと下書きが作成され、編集画面へ移動します。`, `[data-create-tool="${kind}"]`),
  step('/Member/manage/tools/*', 'question', '質問文を入力する', '回答する会員に聞きたいことを質問欄に書きます。', '[name="question"]'),
  ...(kind === 'box' ? [] : [step('/Member/manage/tools/*', 'options', kind === 'poll' ? '選択肢を追加する' : '候補日を選ぶ', kind === 'poll' ? '選択肢を追加して回答の候補を入力します。' : 'カレンダーで都合を聞きたい日を選びます。', kind === 'poll' ? '[data-add-option]' : '[data-tool-calendar]')]),
  step('/Member/manage/tools/*', 'recipients', '通知先を選ぶ', '回答を依頼する会員を選びます。', '[data-tool-editor] [data-recipient-id]'),
  step('/Member/manage/tools/*', 'settings', '回答設定を開く', '受付日時や匿名回答を設定する場合は、回答の設定を開きます。', '[data-tool-editor] details.tool-settings > summary', { details: ['tool-settings'] }),
  step('/Member/manage/tools/*', 'save', '保存して内容を確認する', '保存して確認画面を開きます。質問と通知先を確認してください。', '[data-tool-editor] button[type="submit"]'),
  step('/Member/manage/tools/*', 'publish', '公開して回答受付を開始する', '確認画面の「公開する」を押すと、通知先に案内が届き回答受付が始まります。', '[data-publish-tool]'),
  step('/Member/manage/tools/*', 'reception', '受付を終了・再開する', '回答受付を手動で切り替える場合はこのボタンを使います。', '[data-toggle-reception]'),
  step('/Member/manage/tools/*', 'result', '結果公開の設定を開く', '結果の公開先と公開時期を設定する場合は、公開設定を開きます。', '[data-publication-settings] > summary', { details: ['tool-publication', 'tool-permissions'] }),
], 'staff'));
blueprints.push(b('exhibition-create', '写真展を作成して受付を準備する', '写真展の作成、受付設定、出展フォームの準備を案内します。', ['写真展を作りたい', '写真展の受付を始める'], '/Member/manage/exhibitions', /^$/, p => [
  step(p, 'title', '写真展名を入力する', '新しく作成する写真展の名前を入力してください。', '#create-exhibition [name="title"]', { complete: fields('#create-exhibition [name="title"]') }),
  step(p, 'create', '写真展を作成する', '「作成して設定を開く」を押して設定画面へ移動してください。', '#create-exhibition button'),
  step('/Member/manage/exhibitions/*', 'settings', '参加投票の受付開始を設定する', '会員が参加投票に回答できるようになる日時を設定します。', '[data-setting="voteOpensAt"]'),
  step('/Member/manage/exhibitions/*', 'form-date', '作品の提出期限を設定する', '参加投票とは別に、作品を提出する期限を指定します。', '[data-setting="closesAt"]'),
  step('/Member/manage/exhibitions/*', 'recipients', '参加投票の通知先を選ぶ', '案内を受け取る会員を選んでください。', '[data-exhibition-recipient], [data-recipient-search]'),
  step('/Member/manage/exhibitions/*', 'save', '受付設定を保存する', '受付日時と通知先を確認し、設定を保存します。', '[data-save-settings]'),
  step('/Member/manage/exhibitions/*', 'form', '出展フォームを準備する', '質問と展示区分を作る場合は「フォーム作成」を開きます。', '.exhibition-admin-nav a[href$="/form"]', { details: ['exhibition-form'] }),
  step('/Member/manage/exhibitions/*', 'layout', '展示レイアウトを準備する', '展示室と作品の配置はレイアウト画面で設定します。', '.exhibition-admin-nav a[href$="/layout"]', { details: ['layout-basic'] }),
], 'staff'));
blueprints.push(
  b('password-request', 'パスワードを忘れたとき', '登録メールへ再設定リンクを送ります。', ['パスワードを忘れた', 'パスワード再設定'], '/ForgotPassword', /^\/ForgotPassword\/?$/, p => [
    overview(p, '登録メールへ、新しいパスワードを設定するための専用リンクを送ります。'),
    step(p, 'email', '登録メールを入力する', 'アカウントの登録に使ったメールアドレスを入力してください。', '#reset-email', { complete: fields('#reset-email') }),
    step(p, 'request', '再設定リンクを送信する', '送信ボタンを押します。画面に案内が表示されたら、受信メールを確認してください。', '#forgot-password-form button[type="submit"]'),
    step(p, 'status', '送信の案内を確認する', 'メールが見つからない場合は迷惑メールフォルダも確認し、届いた専用リンクを開きます。', '#reset-request-message'),
  ]),
  b('password-reset', '新しいパスワードを設定する', '再設定メールの専用リンクからパスワードを変更します。', ['新しいパスワード', '再設定リンク'], '/ForgotPassword', /^\/ResetPassword\/?$/, p => p === '/ForgotPassword' ? blueprints.find(x => x.id === 'password-request')!.steps(p) : [
    overview(p, '登録メールの専用リンクから、新しいパスワードを設定します。'),
    step(p, 'password', '新しいパスワードを入力する', '欄の下にある条件を確認し、新しいパスワードを入力します。', '#new-password'),
    step(p, 'confirm', 'パスワードをもう一度入力する', '確認欄に同じパスワードを入力してください。', '#new-password-confirm'),
    step(p, 'save', 'パスワードの変更を確定する', '確定ボタンを押し、更新結果を確認します。', '#reset-password-form button[type="submit"]'),
    step(p, 'login', '新しいパスワードでログインする', 'ログイン画面へ戻り、先ほど設定したパスワードを使ってログインしてください。', 'main a[href="/Login"]'),
  ]),
  b('mfa', 'メールの確認コードを入力する', '二段階認証の確認を完了します。', ['認証コード', '確認コードが届かない', '二段階認証ログイン'], '/Login', /^\/Mfa\/?$/, p => p === '/Login' ? blueprints.find(x => x.id === 'login')!.steps(p) : [
    overview(p, '登録メールに届く6桁のコードで、ログイン時の本人確認を行います。'),
    step(p, 'code', '確認コードを入力する', 'メールに書かれている6桁のコードを入力します。複数届いた場合は最新のメールを確認します。', '#mfa-code', { complete: fields('#mfa-code') }),
    step(p, 'verify', '確認してログインする', '確認ボタンを押すと本人確認を実行します。', '#mfa-form button[type="submit"]'),
    step(p, 'resend', '確認コードを再送する場合', 'メールが届かない場合は、画面に表示された待ち時間が過ぎてから再送を押します。', '#mfa-resend'),
  ]),
  b('member-profile', '班分け用プロフィールを確認する', '名簿から取得した自分の情報を確認します。', ['学年の確認', '性別の確認', '班分けプロフィール'], '/Member/profile', /^\/Member\/profile\/?$/, p => [
    overview(p, '班分け用に取得した自分の名簿情報を確認できます。'),
    step(p, 'check', '名簿上の性別を確認する', '表示内容に相違がある場合は運営へ連絡してください。', 'main dl dt:first-of-type'),
    step(p, 'grade', '名簿上の学年を確認する', '自分の学年が最新か確認してください。名簿との対応が未設定の場合は、画面の案内に従います。', 'main dl dt:last-of-type'),
    step(p, 'back', '会員ページに戻る', '確認が済んだら、リンクでメンバーページへ戻れます。', 'main a[href="/Member"]'),
  ], 'member'),
  b('member-notification', 'お知らせの内容を確認する', '通知の詳細を読み、関連する操作へ進みます。', ['通知を見る', 'お知らせを読む'], '/Member', /^\/Member\/notifications\/[^/]+\/?$/, p => [
    overview(p, '選択したお知らせの本文を読みます。通知一覧から別のお知らせも開けます。'),
    step(p, 'body', '通知の本文を読む', '通知の内容と、回答や確認が必要な日時があるかを確認します。', 'main .activity-prose, main article'),
    step(p, 'related', '関連する企画や質問を開く', '本文に関連するリンクがある場合は、企画詳細や質問の回答ページへ移動できます。', 'main a[href^="/Member/events/"], main a[href^="/Member/exhibitions/"], main a[href^="/Member/tools/"]'),
    step(p, 'back', '通知一覧に戻る', '会員ページの「通知」で他のお知らせを確認できます。', 'main a[href="/Member"]'),
  ], 'member'),
  b('deletion-management', '削除申請を確認する', '本人確認済みの削除申請と対応期限を確認します。', ['退会申請一覧', '削除対応期限'], '/Admin/account-deletion-requests', /^\/Admin\/account-deletion-requests\/?$/, p => [
    overview(p, '本人確認済みの削除申請と対応期限の一覧です。'),
    step(p, 'select', '申請の詳細を開く', '氏名と対応期限を照合して、確認したい申請を開きます。', 'main a[href^="/Admin/account-deletion-requests/"]'),
    step('/Admin/account-deletion-requests/*', 'review', '対応期限を確認する', '詳細画面で処理の状態と期限を確認し、Helpの「このページの使い方」から処理を案内できます。', '[data-deletion-admin] dl, [data-deletion-admin] h2'),
  ], 'executive'),
  b('admin-portfolios', 'メンバーのPortfolioを管理する', 'Portfolioを検索し、公開内容を確認・編集します。', ['他の会員の作品編集', 'Portfolio管理'], '/Admin/portfolios', /^\/Admin\/portfolios\/?$/, p => [
    overview(p, '対象者のPortfolioを探し、公開内容と編集先を確認できます。'),
    step(p, 'search', 'Portfolioを検索する', '名前やキーワードを入力して検索します。', '#portfolio-query'),
    step(p, 'public', '公開中のPortfolioを開く', '名前を照合し、対象者の公開ページを開いて作品やプロフィールを確認します。', 'main a[href^="/Portfolio/"]:not([href^="/Portfolio/edit"])'),
    step(p, 'edit', '対象者の編集画面へ進む', '内容を変更する場合は、対象者の編集リンクを押します。', 'main a[href^="/Portfolio/edit"]'),
  ], 'admin'),
  b('error-guide', 'エラー番号から対処方法を探す', '画面に表示されたエラー番号を検索します。', ['エラー', '不具合', '失敗した', 'エラー番号'], '/Errors', /^\/Errors\/?$/, p => [
    overview(p, '表示されたエラー番号から、その意味と確認することを調べられます。'),
    step(p, 'search', 'エラー番号を入力する', '画面に出た番号を、SITEやEXHなどの先頭の文字も含めて入力します。', '#error-code-query'),
    step(p, 'result', '一致する説明を読む', '検索結果から番号が一致する項目を確認します。操作できなかったときは、表示された対処を順に確認してください。', '#error-code-results'),
    step(p, 'contact', '解消しない場合は問い合わせる', '問い合わせ時はエラー番号と直前に行った操作を伝えてください。', 'main a[href="/Contact"]'),
  ]),
);

const detailBlueprints: Blueprint[] = [
  b('photo-details', '写真の拡大・撮影情報・いいね', '写真を開いて撮影情報やいいねを確認します。', ['Exif', '撮影情報', 'いいね'], '/Gallery', /./, p => [step(p, 'open', '写真を開く', '写真を押して拡大画面を開いてください。', '.photo-open'), step(p, 'information', '撮影情報を見る', '拡大画面の情報表示で、撮影場所や使用機材を確認できます。いいねはハートのボタンから操作します。', '#photo-dialog [data-photo-toggle]')], undefined, true),
  b('portfolio-introduction', '自己紹介の装飾', '自己紹介の文字を選んで装飾やリンクを設定します。', ['自己紹介', 'リンク', '装飾'], '/Portfolio/edit', /./, p => [
    step(p, 'intro', '自己紹介を編集する', '自己紹介欄に入力します。入力した文字を選択してから、上の装飾ボタンを使います。', '#field-self-intro'),
    step(p, 'bold', '文字を太字にする', '強調したい文字を選択して、Bのボタンを押します。', '[data-intro-command="bold"]'),
    step(p, 'italic', '文字を斜体にする', '選んだ文字に斜体を設定するには、Iのボタンを押します。', '[data-intro-command="italic"]'),
    step(p, 'underline', '文字に下線を付ける', '選んだ文字の下に線を引くには、Uのボタンを押します。', '[data-intro-command="underline"]'),
    step(p, 'color', '文字色を選ぶ', '文字を選び、色の欄を押して表示する色を指定します。', '[data-intro-color]'),
    step(p, 'list', '箇条書きを作る', '複数の項目を並べる場合は、箇条書きボタンでリストにします。', '[data-intro-command="insertUnorderedList"]'),
    step(p, 'numbered', '番号付きのリストを作る', '順番を示したい項目は「番号付き」でリストにします。', '[data-intro-command="insertOrderedList"]'),
    step(p, 'link', 'リンクの設定を開く', '文字を選択するか、リンクを入れたい位置を選んで「リンク」を押します。', '[data-intro-link]'),
    step(p, 'url', 'リンク先を指定する', '開いた画面でリンク先のURLを入力します。', '[data-intro-link-url]'),
    step(p, 'apply', 'リンクを反映する', 'リンクの表示文字とURLを確認し、「設定する」を押します。', '[data-intro-link-apply]'),
    step(p, 'save', 'Portfolioを保存する', '公開内容を確認し、Portfolioの保存ボタンを押してください。', '#submit-button'),
  ], 'member', true),
  b('portfolio-photo', '写真の説明・撮影情報を編集する', '各写真の編集画面から説明と撮影情報を変更します。', ['写真編集', 'Exif編集', 'キャプション'], '/Portfolio/edit', /./, p => [step(p, 'photo', '編集したい写真を選ぶ', '写真の編集ボタンを押してください。', '#picture-list [data-photo-edit]'), step(p, 'metadata', '説明・撮影情報を入力する', '撮影場所や使用機材などを入力して反映します。空欄の項目は公開画面に表示されません。', '#portfolio-photo-editor input, #portfolio-photo-editor textarea'), step(p, 'save', '変更を保存する', '写真の編集画面を閉じ、Portfolio全体も保存してください。', '#submit-button')], 'member', true),
  b('tool-settings', '回答の追加設定', '匿名回答や選択肢追加、締切などを設定します。', ['匿名', '回答設定', '締切'], '/Member/manage/tools', /./, p => [
    step(p, 'starts', '受付を開始する日時を指定する', '日時を指定すると、日本時間のその時刻から回答を受け付けます。', '[data-tool-editor] [name="startsAt"]'),
    step(p, 'settings', '回答の提出期限を指定する', '日程を入力すると、期限後は会員に警告が表示されます。手動で受付を止めることもできます。', '[data-tool-editor] [name="endsAt"]'),
    step(p, 'anonymous', '匿名回答にするか決める', '回答者名を匿名にする場合はチェックします。', '[data-tool-editor] [name="anonymous"]'),
    step(p, 'multiple', '複数回答を許可するか決める', '投票や目安箱で該当する項目が表示される場合は、複数選択・複数投稿を許可できます。', '[data-tool-editor] [name="multiple"]'),
    step(p, 'options', '回答者による候補追加を許可する', '投票や日程調整で、回答者も候補を追加できるようにする場合はチェックします。', '[data-tool-editor] [name="allowOptions"]'),
    step(p, 'public', '質問の公開範囲を設定する', '質問・選択肢をログインしていない人にも公開する場合はチェックします。', '[data-tool-editor] [name="publicQuestion"]'),
    step(p, 'save', '設定を保存して確認する', '設定が意図したものか確認して、編集フォームを保存します。', '[data-tool-editor] button[type="submit"]'),
  ], 'staff', true),
  b('tool-publication', '結果の公開条件', '誰がいつまで結果を見られるかを設定します。', ['結果公開', '公開先', '公開期間'], '/Member/manage/tools', /./, p => [
    step(p, 'audience', '結果の公開先を選ぶ', '誰が結果を見られるかを選択します。設定できる公開先はツールの種類で変わります。', '[data-tool-publication] [name="audience"]', { reveal: '[data-publication-settings]' }),
    step(p, 'period', '結果を公開するタイミングを選ぶ', '回答後、受付終了後、日時指定などから開始条件を選びます。', '[data-tool-publication] [name="start"]'),
    step(p, 'date', '公開開始日時を入力する', '日時指定を選んだ場合は、日本時間の公開開始日時を入力します。', '[data-publication-date] [name="startsAt"]'),
    step(p, 'pause', '公開を一時停止するか確認する', '結果を一時的に見せない場合は、公開を停止する設定に切り替えます。', '[data-tool-publication] [name="paused"]'),
    step(p, 'save', '公開設定を保存する', '公開先・公開タイミングを確認して設定を保存してください。', '[data-tool-publication] button[type="submit"]'),
  ], 'staff', true),
  b('tool-permissions', '結果・匿名確認の権限', '運営に許可する結果管理と匿名確認の範囲を設定します。', ['匿名確認権限', '管理権限'], '/Member/manage/tools', /./, p => [
    step(p, 'access', '運営に結果管理を許可するか決める', '幹部や管理者が作成した質問を運営にも管理させる場合にチェックします。', '[data-tool-permissions] [name="staffResults"]'),
    step(p, 'identity', '匿名の名前確認を許可するか決める', '名前の確認が業務に必要な場合のみ許可してください。名前を確認すると監査記録に残ります。', '[data-tool-permissions] [name="staffIdentity"]'),
    step(p, 'save', '権限設定を保存する', '結果の管理と匿名の名前確認の両方を確認し、設定を保存してください。', '[data-tool-permissions] button[type="submit"]'),
  ], 'executive', true),
  b('group-export', '班分けのコピー・書き出し', '班の画像やLINE用の名前一覧を書き出します。', ['班の画像', '班をコピー', 'TXT', 'PNG'], '/Member/manage/grouping', /./, p => [
    step(p, 'groups', '班のメンバーを確認する', '確定した班とメンバーを確認してください。', '[data-group-board] [data-group-members]'),
    step(p, 'copy', '選んだ班の画像をコピーする', 'コピーしたい班を選び、共有先に貼り付けて使います。', '[data-copy-group]'),
    step(p, 'png', 'PNG画像を書き出す', '「PNGで出力」で、班の一覧を画像として保存できます。', '[data-group-png]'),
    step(p, 'txt', 'LINE用の名前一覧をコピーする', '「TXTでコピー」でテキストを取得します。LINE名が未登録の場合は氏名が使われます。', '[data-group-txt]'),
  ], 'staff', true),
];

blueprints.push(
  b('admin-view', 'ログイン・ロールの表示を確認する', '実在の会員を変更せず、各ロールの閲覧専用表示を確認します。', ['ロール確認', '未ログインとして表示', '表示確認', '閲覧専用'], '/Admin/view', /^\/(?:Admin|Management)\/view\/?$/, p => [
    overview(p, '代理ログインと、実在の会員を使わないロール別の閲覧専用表示を選べます。'),
    step(p, 'role', '確認するロールを選ぶ', '幹部・運営・一般会員・未ログインから選びます。ロール表示は閲覧専用で、保存・送信はできません。', '[data-admin-view-role="member"]'),
    step(p, 'return', '切り替え後の確認と終了', '画面上部のロール表示を確認してください。「表示の切り替え」で再選択、画面上部の復帰ボタンで終了できます。切り替え後は、その権限のヘルプを利用できます。', '.admin-view-options'),
  ], 'staff'),
  b('roster-link', '名簿とアカウントの未連携を解消する', '本人の名簿の回答を確認し、アカウントとの対応を保存します。', ['名簿の未連携', '名簿とアカウント', '氏名一致の候補'], '/Admin/grouping-roster', /^$/, p => [
    step(p, 'search', '未連携のアカウントを検索する', '名前やメールなどで対象を絞り込みます。候補だけで本人を確定せず、回答を照合してください。', '[data-roster-account-search]'),
    step(p, 'match', '本人の名簿回答を選択する', '行にある選択欄から、本人と確認できた名簿の回答を選びます。', '[data-roster-user]'),
    step(p, 'save', '名簿との対応を保存する', '選んだ回答とアカウント名を再度確認し、該当行の保存を押します。', '[data-activity-action="roster.link"] button[type="submit"]'),
  ], 'executive', true),
  b('roster-retry', '名簿・Portfolioの反映エラーを再確認する', '統合名簿の保存やPortfolioの更新状況を確認して再試行します。', ['名簿の保存に失敗', 'Portfolioの学年反映', '名簿を再試行'], '/Admin/grouping-roster', /^$/, p => [
    step(p, 'portfolio', 'Portfolioへの反映状況を確認する', 'エラーになった学年などの更新があれば、対象と原因を確認します。', '[data-activity-action="roster.retry"] [data-status], [data-activity-action="roster.retry"]'),
    step(p, 'sync', '統合名簿を同期する', '名簿保存のエラーを確認し、必要な場合は統合名簿の同期を行います。', '[data-activity-action="roster.sync"] button[type="submit"]'),
    step(p, 'retry', '反映を再試行する', 'エラーの対象が意図した項目か確かめ、再試行ボタンを押して結果を確認します。', '[data-activity-action="roster.retry"] button[type="submit"]'),
  ], 'executive', true),
);

const galleryGuidePath = /^\/Gallery(?:\/[^/]+)?$/;
const portfolioGuidePath = /^\/Portfolio(?:\/(?!edit$)[^/]+)?$/;
const accountGuidePath = /^\/Admin\/accounts(?:\/[^/]+)?$/;
const contextualCollectionGuides = new Set(['portfolio-office', 'portfolio-book-view', 'photo-series-view', 'gallery-settings', 'gallery-exclusions', 'gallery-film']);

function galleryAlbumSteps(p: string, steps: (albumPath: string) => HelpStep[]) {
  if (p !== '/Gallery') return steps(p);
  return [
    step(p, 'album', '対象のアルバムを開く', '操作したい写真が入っているアルバムを一覧から選びます。', 'main a[href^="/Gallery/"]'),
    ...steps('/Gallery/*'),
  ];
}

function portfolioSeriesLayoutSteps(p: string) {
  return [
    step(p, 'arrange', '配置画面で写真を並べる', '図面上の写真をドラッグすると位置を調整できます。組写真を構成する写真の選択は、前の画面で行います。', '[data-series-editor]'),
    step(p, 'dimensions', '写真ごとのサイズ・位置を開く', '調整したい写真の行を押すと、寸法や位置の欄が表示されます。', '[data-series-dimensions] > summary'),
    step(p, 'paper', '用紙サイズに合わせる', '定型の写真サイズを選ぶと幅と高さが設定されます。任意の寸法にする場合は「自由入力」を選びます。', '[data-series-paper]'),
    step(p, 'orientation', '用紙の向きを選ぶ', '用紙に合わせて縦・横を選びます。', '[data-series-orientation]'),
    step(p, 'width', '写真の横幅を指定する', '横幅をmmで指定します。', '[data-series-photo-key="width"]'),
    step(p, 'height', '写真の高さを指定する', '高さをmmで指定します。', '[data-series-photo-key="height"]'),
    step(p, 'position-x', '写真の横位置を調整する', 'Xの値を変えると、写真が横方向に移動します。', '[data-series-photo-key="x"]'),
    step(p, 'position-y', '写真の縦位置を調整する', 'Yの値を変えると、写真が縦方向に移動します。', '[data-series-photo-key="y"]'),
    step(p, 'rotation', '写真の傾きを調整する', '回転角を指定し、写真の傾きを確認します。', '[data-series-photo-key="rotation"]'),
    step(p, 'close-layout', '配置を反映して閉じる', '配置を確認したら「配置を反映して閉じる」を押し、組写真の編集に戻ります。', '.series-dialog-footer [data-series-dialog-close]'),
  ];
}

detailBlueprints.push(
  b('member-calendar', 'カレンダーで過去の企画を探す', '前月以前の企画・写真展を日付から探して詳細を確認します。', ['過去の企画', '終了したイベント', '前の月の写真展'], '/Member', /./, p => [
    step(p, 'calendar', '企画をカレンダー表示にする', '「カレンダー」を押します。開催が終わった企画・写真展もカレンダーから見られます。', 'main a[href^="?view=calendar"]'),
    step(p, 'previous', '前の月へ移動する', '左の矢印で前月へ移動します。スマホではカレンダーを左右にスワイプして月を切り替えられます。', '[data-calendar-previous]'),
    step(p, 'next-month', '次の月へ移動する', '右の矢印で翌月へ移動します。', '[data-calendar-next]'),
    step(p, 'event', '確認する企画の詳細を開く', 'カレンダーに表示された企画名を押すと、開催情報を確認できます。', 'a[data-calendar-kind], [data-calendar-swipe]'),
  ], 'member', true),
  b('portfolio-office', 'Portfolioに掲載する役職を決める', '管理者がアカウントの登録内容から、幹部欄に掲載する役職を設定します。', ['役職を決定', '役職の決定', '役職を設定', '幹事長を決める', '幹部欄から外す'], '/Admin/accounts', accountGuidePath, p => {
    const detail = p === '/Admin/accounts' ? '/Admin/accounts/*' : p;
    return [
      ...(detail === p ? [] : [
        step(p, 'search', '役職を設定する会員を検索する', '名前やメールアドレスで対象者を検索します。', '#account-query'),
        step(p, 'account', '対象者の登録内容を開く', '対象者の行で「登録内容を見る」を押します。Portfolioが連携済みのアカウントに掲載役職を設定できます。', '.admin-account-links a[href^="/Admin/accounts/"]'),
      ]),
      step(detail, 'office-section', '「Portfolioの役職」欄を確認する', '連携済みのアカウントの登録内容に、管理者向けの役職欄が表示されます。ログイン権限は「登録内容を編集」で別に設定します。', '#portfolio-office-title, main section[aria-label="登録内容"] > h3'),
      step(detail, 'office', '掲載する役職を選ぶ', '幹事長・副幹事長・会計から選びます。幹部欄から外す場合は「設定なし」を選びます。', '#portfolio-office-select'),
      step(detail, 'save', '役職を保存する', '対象者と役職を確認して「役職を保存」を押します。対象のPortfolioは幹部欄に役職順で表示されます。', '#portfolio-office-form button[type="submit"]'),
    ];
  }, 'admin', true),
  b('portfolio-series-edit', 'Portfolioに組写真を載せる', '写真を2枚以上選び、配置と組全体の作品情報を設定します。', ['組写真を追加', 'Portfolioで組写真を作りたい', '組写真を掲載', '登録済みの写真をまとめる'], '/Portfolio/edit', /./, p => [
    step(p, 'upload', '新しい画像から組写真を作る', '「組写真を追加」で画像を2枚以上選ぶと、組写真の編集画面が開きます。すでに登録済みの画像を使う方法は次の手順です。', 'label[for="series-files"], #portfolio-series-heading'),
    step(p, 'existing', '登録済みの画像から組写真を作る', 'すでに追加した写真を使う場合は「登録済みの写真から組写真を作る」を押します。掲載済みの組写真は一覧の編集ボタンから開けます。', '[data-portfolio-series-create], [data-edit-portfolio-series]', { complete: { kind: 'present', selector: '#portfolio-series-editor[open]' } }),
    step(p, 'choose', '組に含める写真を選ぶ', '同じ作品として並べる写真を2〜100枚選びます。他の組で使っている写真は選択できません。', '[data-portfolio-series-picks] label:has(input:enabled)', { heading: '#portfolio-series-heading' }),
    step(p, 'title', '組全体のタイトルを入力する', '作品一覧や組写真の全体表示で使うタイトルを入力します。', '#portfolio-series-editor [name="title"]'),
    step(p, 'caption', '組全体のキャプションを書く', '組の構成や、まとめて見てほしい内容を説明できます。個々の写真情報は各作品の編集から設定します。', '#portfolio-series-editor [name="caption"]'),
    step(p, 'film', '組全体のフィルム名を入力する', '同じフィルムで撮った組写真などでは、組全体に表示するフィルム名を入力できます。', '#portfolio-series-editor [name="film"]'),
    step(p, 'layout', '配置の編集画面を開く', '写真の位置・サイズ・角度を調整する場合は「配置を編集」を押します。', '[data-portfolio-series-layout]', { details: ['portfolio-series-layout'] }),
    ...portfolioSeriesLayoutSteps(p),
    step(p, 'apply', '組写真を編集ページに反映する', '組に含める写真と情報を確認して「組写真を反映」を押します。', '#portfolio-series-editor button[type="submit"]'),
    step(p, 'save', 'Portfolioに組写真を掲載する', '組写真が追加されたことを確認して「Save changes」を押します。', '#submit-button'),
  ], 'member', true),
  b('portfolio-series-layout', 'Portfolioの組写真の配置を調整する', '図面で写真を並べ、サイズ・位置・回転を調整します。', ['Portfolioの組写真の配置', '組写真の余白やサイズを調整'], '/Portfolio/edit', /./, p => [
    step(p, 'layout', '組写真の配置画面を開く', '組写真の編集で写真を2枚以上選び、「配置を編集」を押してください。配置画面が開いている場合は次へ進みます。', '[data-portfolio-series-layout], .series-editor-dialog h2, [data-edit-portfolio-series], [data-portfolio-series-create]'),
    ...portfolioSeriesLayoutSteps(p),
  ], 'member', true),
  b('portfolio-book-edit', 'PortfolioにPDFのブックを載せる', '閲覧用PDF、表紙、ページの開き方を選んでブックを掲載します。', ['本をPortfolioに載せたい', 'ブックを追加', 'フォトブック', 'PDFを載せたい', '冊子を掲載'], '/Portfolio/edit', /./, p => [
    step(p, 'open', '「ブックを追加」を押す', 'Portfolioの作品欄からブックの編集画面を開きます。すでに開いている場合は次へ進みます。', '[data-portfolio-book-create], #portfolio-book-editor-title'),
    step(p, 'edit', '掲載済みのブックを編集する場合', '変更したいブックの「ブックを編集」から、登録済みのPDFや表紙を確認できます。', '[data-edit-portfolio-book]', { complete: { kind: 'present', selector: '#portfolio-book-editor[open], body:not(:has([data-edit-portfolio-book]))' } }),
    step(p, 'pdf', '閲覧用PDFを選ぶ', '20MBを超えるPDFは自動で圧縮します。元のファイルは200MBまでです。InDesignの原稿は、ページ単位でPDFに書き出してから指定します。', '#portfolio-book-editor [name="pdf"]'),
    step(p, 'cover', '表紙の作り方を選ぶ', 'PDFのページを使うか、別の表紙画像を使うか選びます。', '#portfolio-book-editor [name="coverMode"]'),
    step(p, 'page', '表紙に使うページ番号を指定する', 'PDFから表紙を作る場合はページ番号を入力します。', '#portfolio-book-editor [name="coverPage"]', { complete: { kind: 'present', selector: '#portfolio-book-editor [name="coverMode"] option[value="image"]:checked' } }),
    step(p, 'preview', '指定したページをプレビューする', '「選んだページをプレビュー」を押し、表紙にするページを確認します。', '[data-book-preview-page]', { complete: { kind: 'present', selector: '#portfolio-book-editor [name="coverMode"] option[value="image"]:checked' } }),
    step(p, 'cover-file', '表紙画像を選ぶ', '別の画像を表紙に使う場合はJPEG・PNG・WebPを選びます。', '#portfolio-book-editor [name="coverFile"]', { complete: { kind: 'present', selector: '#portfolio-book-editor [name="coverMode"] option[value="page"]:checked' } }),
    step(p, 'direction', 'ページの開き方を選ぶ', '元の冊子に合わせて左開き・右開きを選びます。', '#portfolio-book-editor [name="direction"]'),
    step(p, 'title', 'ブックのタイトルを入力する', '一覧や詳細で表示するタイトルを入力します。', '#portfolio-book-editor [name="title"]'),
    step(p, 'caption', 'ブックの紹介文を書く', '冊子のテーマや見どころをキャプションに記入できます。', '#portfolio-book-editor [name="caption"]'),
    step(p, 'film', '冊子の撮影に使ったフィルム名を入力する', '作品情報にフィルム名を表示する場合は入力します。', '#portfolio-book-editor [name="film"]'),
    step(p, 'apply', 'ブックを編集ページに反映する', 'PDF・表紙・開き方・タイトルを確認して「ブックを反映」を押します。', '#portfolio-book-editor button[type="submit"]'),
    step(p, 'save', 'Portfolioにブックを掲載する', 'ブック一覧を確認して「Save changes」を押し、閲覧ページへ反映します。', '#submit-button'),
  ], 'member', true),
  b('portfolio-book-view', 'Portfolioのブックを読む', 'ブックの作品情報を見て、表紙からリーダーを開きます。', ['本を読みたい', 'ブックを読む', 'ページをめくる', '掲載された冊子'], '/Portfolio', portfolioGuidePath, p => {
    const work = p === '/Portfolio' ? '/Portfolio/*' : p;
    return [
      ...(work === p ? [] : [step(p, 'portfolio', 'ブックが載っているPortfolioを開く', '作者のカードを押して、作品一覧に移動してください。', 'main a[href^="/Portfolio/"]')]),
      step(work, 'book', 'ブックの詳細を開く', '作品一覧の表紙を押します。拡大した表紙をもう一度押すと、作品情報を表示できます。', '[data-portfolio-book-open], #photo-dialog[data-photo-book] [data-photo-toggle], #portfolio-book-reader-title'),
      step(work, 'reader', 'ブックを読む', '「ブックを読む」を押すと、リーダーが開きます。', '#photo-dialog [data-open-book-reader], #portfolio-book-reader [data-book-stage]'),
      step(work, 'turn-left', '左側の矢印でページをめくる', '本の開き方と現在のページに応じて、使える矢印が有効になります。', '[data-book-turn="left"]'),
      step(work, 'turn-right', '右側の矢印でページをめくる', '反対側へ進むには右の矢印を押します。スマホでは横にスワイプする操作も使えます。', '[data-book-turn="right"]'),
      step(work, 'close', 'リーダーを閉じて詳細へ戻る', '右上の閉じるボタンで、表紙と作品情報の画面へ戻ります。', '#portfolio-book-reader .book-close'),
    ];
  }, undefined, true),
  b('photo-series-view', '組写真の全体と一枚ずつの写真を見る', 'Gallery・Portfolioで組写真の配置と各写真の撮影情報を確認します。', ['組写真を見る', '組写真を拡大', '組写真の全体へ'], '/Gallery', /^(?:\/Gallery(?:\/[^/]+)?|\/Portfolio(?:\/(?!edit$)[^/]+)?)$/, p => {
    const album = p === '/Gallery' || p === '/Portfolio' ? `${p}/*` : p;
    return [
      ...(album === p ? [] : [step(p, 'collection', p === '/Gallery' ? '対象のアルバムを選ぶ' : '対象のPortfolioを選ぶ', '見たい組写真が掲載されている一覧を開きます。', `main a[href^="${p}/"]`)]),
      step(album, 'series', '「組写真」のカードを開く', '複数枚を一つの作品として並べたカードを押すと、全体の配置が開きます。', '[data-photo-series="true"] .photo-open, [data-photo-series-frame], [data-photo-series-back]'),
      step(album, 'frame', '全体から一枚の写真を選ぶ', '配置の中で詳しく見たい写真を押すと、一枚ずつ大きく表示できます。', '[data-photo-series-frame]'),
      step(album, 'info', '選んだ写真の情報を表示する', '一枚の表示で写真をもう一度押すと、キャプションや撮影情報が開きます。', '#photo-dialog [data-photo-toggle]'),
      step(album, 'back', '組写真の全体へ戻る', '「組写真の全体へ」を押して、作品全体の配置へ戻ります。', '[data-photo-series-back]'),
    ];
  }, undefined, true),
  b('gallery-settings', 'Galleryの公開範囲とカバーを変える', 'アルバム設定で、閲覧できる人と一覧に載せる写真を選びます。', ['アルバムを公開', 'ギャラリーの公開範囲', 'カバー写真を変える', '会員限定にしたい'], '/Gallery', galleryGuidePath, p => galleryAlbumSteps(p, album => [
    step(album, 'settings', 'アルバム設定を開く', '対象のアルバムで歯車の「アルバム設定」を押します。', '[data-open-gallery-settings], #gallery-settings-heading'),
    step(album, 'mode', '「公開範囲・カバー」を開く', '公開範囲やカバーを変更するタブを選びます。', '[data-gallery-settings-mode="album"]'),
    step(album, 'visibility', '閲覧できる人を選ぶ', '一般公開は未ログインでも閲覧できます。会員限定は承認済みの会員が閲覧できます。', '#gallery-album-fields [name="visibility"]'),
    step(album, 'cover', '一覧に表示するカバーを選ぶ', '掲載できる写真からカバーを選びます。自動で先頭の写真を使う場合は次の手順です。', '[data-gallery-cover-photos] [data-cover-id]'),
    step(album, 'default-cover', '先頭の写真を使う場合', 'カバーの指定を外して先頭の写真に戻す場合は、このボタンを押します。', 'button[data-cover-id=""]'),
    step(album, 'save', '公開範囲とカバーを保存する', '選択内容を確認して「設定を保存」を押します。', '.gallery-settings-dialog button[type="submit"]'),
  ]), 'staff', true),
  b('gallery-exclusions', 'Galleryで公開しない写真を選ぶ', 'アルバムの写真を個別に非公開にしたり、掲載に戻したりします。', ['Galleryの写真を非公開', 'アルバムから写真を除外', '公開しない写真'], '/Gallery', galleryGuidePath, p => galleryAlbumSteps(p, album => [
    step(album, 'settings', 'アルバム設定を開く', '対象のアルバムで歯車の「アルバム設定」を押します。', '[data-open-gallery-settings], #gallery-settings-heading'),
    step(album, 'mode', '「公開しない写真」を開く', '写真ごとにGalleryへの掲載を切り替える画面を開きます。', '[data-gallery-settings-mode="exclusions"]'),
    step(album, 'photo', '非公開にする写真を選ぶ', '写真を押すと「非公開」と表示され、もう一度押すと掲載対象に戻せます。必要なら「写真をさらに表示」で続きを探します。', '[data-gallery-exclusion-photos] [data-exclusion-id], [data-gallery-exclusion-more]'),
    step(album, 'count', '非公開にする枚数を確認する', '表示された件数と選択した写真を確認してください。', '[data-gallery-exclusion-count]'),
    step(album, 'save', '写真の公開設定を保存する', '「設定を保存」を押すと、非公開にした写真がGalleryから外れます。元の写真は残ります。', '.gallery-settings-dialog button[type="submit"]'),
  ]), 'staff', true),
  b('gallery-film', 'Galleryの写真にフィルム名を登録する', '管理者が写真の撮影情報欄からフィルム名を設定します。', ['Galleryのフィルムを編集', '撮影フィルムを登録', 'フィルム名を変更'], '/Gallery', galleryGuidePath, p => galleryAlbumSteps(p, album => [
    step(album, 'photo', '編集したい写真を開く', '対象の写真を開きます。組写真の場合は全体から編集したい一枚を選びます。', '.photo-open, [data-photo-series-frame], #photo-dialog [data-photo-toggle]'),
    step(album, 'information', '写真の情報欄を表示する', '一枚ずつの表示で写真を押すと、作品情報が開きます。', '#photo-dialog [data-photo-toggle]'),
    step(album, 'open', '「フィルムを編集」を開く', '写真情報欄の「フィルムを編集」を押して入力欄を開きます。', '[data-gallery-film-editor] > summary'),
    step(album, 'film', 'フィルム名を入力する', '撮影に使ったフィルム名を入力します。空欄で保存すると表示を消せます。', '[data-gallery-film-editor] [name="film"]'),
    step(album, 'save', 'フィルム名を保存する', '入力内容を確認して写真情報の「保存」を押します。', '[data-gallery-film-editor] button[type="submit"]'),
  ]), 'admin', true),
);

const exhibitionGuideViews: Record<string, string> = {
  'exhibition-shift-manage': 'shifts', 'exhibition-shift-copy': 'shifts', 'exhibition-shift-replace': 'shifts',
  'exhibition-boards': 'submissions', 'exhibition-lightroom': '',
};
const shiftBoard = { activate: '#exhibition-shifts [data-tab="board"]' };
const alumniSteps = (p: string) => [
  step(p, 'alumni', 'OB/OG欄を開く', '卒業生のPortfolioは「OB/OG」にまとまっています。見出しを押して開いてください。', 'details[data-portfolio-grade="OB/OG"] > summary'),
  step(p, 'alumni-card', '卒業生のPortfolioを開く', '名前を確認してカードを押し、卒業生のプロフィールを開きます。', 'details[data-portfolio-grade="OB/OG"] .member-card, details[data-portfolio-grade="OB/OG"] > summary', { reveal: 'details[data-portfolio-grade="OB/OG"]' }),
  step('/Portfolio/*', 'alumni-photo', '卒業生の作品写真を開く', '開いたPortfolioで作品写真を押すと、写真を拡大して閲覧できます。', '.photo-open', { details: ['photo-details'] }),
];
detailBlueprints.push(
  b('portfolio-alumni', '卒業生のPortfolioを見る', 'Portfolio一覧のOB/OG欄から卒業生の作品を探します。', ['OB/OG', '卒業生の作品', 'OBのポートフォリオ'], '/Portfolio', /^\/Portfolio$/, alumniSteps, undefined, true),
  b('exhibition-photography', '展示作品の撮影可否を設定する', '作品ごとに撮影OK・撮影NGを選び、タイトルボードの表示を設定します。', ['撮影禁止', '撮影NG', '撮影OK', '写真を撮られたくない'], '/Member', /./, p => [
    step(p, 'photography', '作品の撮影可否を確認する', '展示区分と作品数を設定すると、作品ごとに撮影可否の欄が表示されます。', '[data-photography-choice][value="ng"], [data-section-toggle], [data-begin]', { heading: '.titleboard-photography legend' }),
    step(p, 'allow', '撮影を許可する場合', '撮影を許可する作品は「撮影OK」を選びます。', '[data-photography-choice][value="ok"]'),
    step(p, 'prohibit', '撮影を禁止する場合', '「撮影NG」を選ぶと、その作品のタイトルボード右上に撮影禁止マークが付きます。', '[data-photography-choice][value="ng"]'),
    step(p, 'submit', '撮影可否を確認して提出する', '作品ごとの設定を確認して提出します。提出後に変更した場合は再提出してください。', '[data-submit]'),
  ], 'member', true),
  b('exhibition-title-fields', '作品タイトルの「」・ふりがな', '出展フォームでタイトルの囲みと、漢字・語句の読みを設定します。', ['タイトルのふりがな', 'タイトルを括弧で囲む', 'タイトルボードの表示'], '/Member', /./, p => [
    step(p, 'title', '作品のタイトルを入力する', '作品の名前を入力します。タイトルボードにもこの名前が表示されます。', '[data-work-key="title"]'),
    step(p, 'quoted', 'タイトルを「」で囲むか選ぶ', 'タイトルボードで括弧付きにしたい場合はチェックします。', '[data-titleboard-quoted]'),
    step(p, 'enable', 'ふりがなの入力欄を開く', '「タイトルにふりがなを付ける」にチェックします。', '[data-titleboard-enabled]'),
    step(p, 'ruby', '漢字1文字の読みを入力する', '読みを表示したい漢字に対応する欄に入力します。', '[data-title-ruby-reading]'),
    step(p, 'ruby-phrase', '熟語や特別な読みの対象を指定する', '続けて読ませたい文字を、タイトルと同じ表記で入力してください。', '[data-title-ruby-target]'),
    step(p, 'ruby-occurrence', '同じ語句が複数あるときは位置を選ぶ', '対象箇所の欄が表示された場合は、タイトルの何文字目に付けるか選びます。', '[data-title-ruby-occurrence]'),
    step(p, 'ruby-add', '語句のふりがなを追加する', '「語句を追加」を押し、追加した行に読みを入力します。読みは語句全体の中央に表示されます。', '[data-title-ruby-add]'),
    step(p, 'preview', 'タイトルボードの表示を確認する', 'プレビューでタイトルとふりがなを確認し、重なりやはみ出しの警告があれば調整します。', '[data-preview-boards]'),
    step(p, 'submit', '作品を提出する', '読みやタイトルを確認し、出展フォームの提出ボタンを押してください。', '[data-submit]'),
  ], 'member', true),
  b('exhibition-shift-manage', '展示シフトの受付・割り当て・公開', '開催日時、希望の受付、提出状況、担当者の配置と公開を案内します。', ['シフトを管理', 'シフトの自動生成', '担当者を追加', 'シフトを公開'], '/Member/manage/exhibitions', /./, p => [
    step(p, 'schedule', '開催期間の初日を指定する', '日本時間で展示の初日を選びます。開催日時の変更後は、提出済みの回答を確認してください。', '[data-schedule] [name="startDate"]', { activate: '#exhibition-shifts [data-tab="summary"]' }),
    step(p, 'end', '開催期間の最終日を指定する', '複数日開催の場合は最終日を選びます。', '[data-schedule] [name="endDate"]'),
    step(p, 'save-schedule', '開催日時を保存する', '日付と開場時刻を確認し、開催日時の保存を押します。', '[data-schedule] button:not([type="button"])'),
    step(p, 'config', 'シフトの受付状態を選ぶ', '会員から回答を集める場合は「受付中」を選びます。「受付終了」で回答を止めます。', '[data-config] [name="state"]'),
    step(p, 'intake-start', 'シフトの受付開始日時を指定する', '参加投票や作品提出とは別に、シフトの受付開始を指定します。', '[data-config] [name="opensAt"]'),
    step(p, 'intake-deadline', 'シフト希望の提出期限を指定する', '期限後も受付中は警告を表示して受け付けます。', '[data-config] [name="closesAt"]'),
    step(p, 'limit', '1人の担当枠数の上限を指定する', '必要に応じて、1人に割り当てる総枠数の上限を指定してください。', '[data-config] [name="maxTotal"]'),
    step(p, 'together', '同じ枠にする希望を追加する', '一度は同じ枠にしたい2名を選び、指定に追加します。', '[data-add-pair="together"]'),
    step(p, 'apart', '同じ枠にしない組み合わせを追加する', '同じ枠に入れられない2名を選び、必須条件に追加します。', '[data-add-pair="apart"]'),
    step(p, 'save-config', '受付と割り当ての設定を保存する', '受付期間と割り当て条件を確認し、設定の保存を押します。', '[data-config] button:not([type="button"])'),
    step(p, 'responses', '会員を名前で検索する', '提出状況で氏名・LINE名・登録名から対象の会員を探します。', '[data-response-search]', { activate: '#exhibition-shifts [data-tab="responses"]' }),
    step(p, 'response-filter', '提出状況で絞り込む', '未提出、下書き、提出済み、要再確認などの条件を選べます。', '[data-response-filter]'),
    step(p, 'response-detail', '提出内容を確認する', '対象者の「詳細を確認」を押すと、提出した希望と保存中の下書きを確認できます。', '[data-response]'),
    step(p, 'generate', 'シフト案を自動生成する', '現在の希望と条件から案を作ります。手動で固定した配置は残り、自動で配置した担当者には雷マークが付きます。', '[data-action="generate"]', shiftBoard),
    step(p, 'assign', '空き枠に担当者を追加する', '空き枠の「＋ 担当者を追加」で会員を選びます。配置済みの担当者を希望者へ変更する手順も確認できます。', '[data-seat=""], [data-seat]', { details: ['exhibition-shift-replace'] }),
    step(p, 'search', '担当者を名前で検索する', '氏名や登録名などを入力すると、一致した枠を強調します。', '[data-board-search]'),
    step(p, 'jump', '一致した枠の日付へ移動する', '「一致した枠へ移動」を押すと、該当する日程が表示されます。', '[data-board-jump]'),
    step(p, 'review', '変更後の案を確認して保存する', '不足や条件の警告を確認し、配置を維持する場合は「案を確認して保存」を押します。', '[data-action="review"]', { details: ['exhibition-shift-copy'] }),
    step(p, 'publish', '確定シフトを公開する', '案の内容を確認し、「確定シフトを公開」または「更新版を公開」を押します。会員に確定シフトが通知されます。', '[data-action="publish"]'),
  ], 'staff', true),
  b('exhibition-shift-copy', 'シフト表の画像をコピーする', '確認済みのシフト案を画像でコピーし、必要に応じてPNGで保存します。', ['シフトを画像で共有', 'シフト表をPNGで保存', 'シフト表をコピー'], '/Member/manage/exhibitions', /./, p => [
    step(p, 'review', '画像にする案を確認して保存する', '先に配置や警告を確認し、「案を確認して保存」を押します。確認済みの案はコピーできます。', '[data-action="review"]', shiftBoard),
    step(p, 'dates', '画像に含める日程を表示する', '表示中の日程が1枚の画像になります。必要に応じて、前・次の7日間で日付を切り替えます。', '[data-shift-matrix="draft"] [data-matrix-page]:enabled, [data-shift-matrix="draft"] table'),
    step(p, 'copy', 'シフト表の画像をコピーする', 'コピーを押し、共有先で貼り付けます。端末でコピーできない場合は保存の案内が表示されます。', '[data-shift-copy]'),
    step(p, 'png', 'PNGとして保存する場合', '「PNGで保存」が表示された場合は、押すと画像ファイルをダウンロードできます。', '[data-shift-png]'),
  ], 'staff', true),
  b('exhibition-shift-replace', 'シフトの担当者を希望者から変更する', '担当枠を選び、その時間の希望を提出した人に変更します。', ['シフトを差し替え', '担当者を変更', 'シフトの長押し'], '/Member/manage/exhibitions', /./, p => [
    step(p, 'open', '対象の担当枠の変更画面を開く', 'シフト表の担当者名の横にある変更アイコンを押します。スマホでは名前を長押ししても開けます。', '[data-replace]', shiftBoard),
    step(p, 'candidate', '同じ時間に入れる人を検索する', '氏名・LINE名・登録名から、その時間に正式な希望を提出した人を探します。', '[data-replacement-search]'),
    step(p, 'choose', '新しい担当者を選ぶ', '学年と担当枠数を確認し、候補を選びます。警告が出た場合は内容を確認してください。', '[data-replacement-person]:enabled'),
    step(p, 'publish', '必要なら更新版を公開する', '変更が案に反映されたあと、会員に知らせる場合は「更新版を公開」を押します。', '[data-action="publish"]'),
  ], 'staff', true),
  b('exhibition-boards', 'タイトルボードの配置・印刷', '作品ごとの配置、印刷対象、警告とPDF生成を案内します。', ['タイトルボード', 'ボードの配置', 'タイトルボードを印刷', '文字がはみ出す'], '/Member/manage/exhibitions', /./, p => [
    step(p, 'open', 'タイトルボードの一覧を開く', '提出結果の概要から「タイトルボードの配置を調整」を押します。', '.board-manager [data-bm-search], [data-manage-boards]', { activate: '#submission-tab-summary' }),
    step(p, 'search', '作品名や作者名で検索する', '作品一覧が開いたら、探したい名前を入力して絞り込みます。', '[data-bm-search]'),
    step(p, 'issues-only', '警告のある作品に絞り込む', '警告がある作品だけ表示したい場合は、一覧の絞り込みにチェックを付けます。', '[data-bm-issues-only]'),
    step(p, 'work', '編集する作品を選ぶ', '対象の作品カードで「配置を調整」を押すと編集画面を開きます。', '[data-bm-edit]'),
    step(p, 'canvas', '項目を移動する', 'タイトルなどをドラッグして位置を調整します。四隅のハンドルをドラッグすると枠の大きさを変更できます。', '[data-bm-canvas]'),
    step(p, 'element', '調整する項目を指定する', 'タイトル、作者名、キャプション、QRなど、数値を変更したい項目を選びます。', '[data-bm-element]'),
    step(p, 'position', '位置を数値で調整する', '右側の位置欄で、選んだ項目の座標をmmで指定できます。', '[data-bm-number="x"]'),
    step(p, 'font', '文字サイズを調整する', '文字項目を選んだ場合は、文字サイズをptで指定できます。', '[data-bm-number="fontSize"]'),
    step(p, 'values', '配置の警告を確認する', '撮影禁止マークとの重なりや、文字のはみ出しの警告があれば配置を調整してください。', '[data-bm-warnings], [data-bm-inspector]'),
    step(p, 'save', '配置を保存する', 'タイトルボードの配置変更を保存してください。', '[data-bm-save]'),
    step(p, 'back', '印刷対象の一覧へ戻る', '「作品一覧・印刷へ」を押すと作品一覧に戻ります。', '[data-bm-back]'),
    step(p, 'exclude', '印刷しない作品を指定する', '印刷対象から外す作品の「印刷しない」にチェックします。', '[data-bm-exclude]'),
    step(p, 'print', '印刷用PDFを生成する', '選択した作品でPDFを生成します。A4に最大8枚のタイトルボードが配置されます。', '[data-bm-print]'),
  ], 'staff', true),
  b('exhibition-lightroom', 'Lightroom・展示アルバムの写真除外', '提出済みの写真からアルバムに表示しない写真を選びます。', ['Lightroomの除外', 'アルバムの写真除外', 'Lightroomアルバム'], '/Member/manage/exhibitions', /./, p => [
    step(p, 'open', '写真の除外設定を開く', '「Lightroomアルバムを作成」または「設定を反映」を押して、写真を選ぶ画面を開きます。', '.exhibition-album-picker [data-album-search], [data-lightroom-create]'),
    step(p, 'search', '作品名・作者名で検索する', '探したい作品名、作者名、氏名を入力します。', '[data-album-search]'),
    step(p, 'filter', '表示候補・除外中を切り替える', '除外中の写真だけ確認したい場合は絞り込みを使います。', '[data-album-filter]'),
    step(p, 'exclude', '除外する写真を選ぶ', '写真を押すたびに除外と解除を切り替えます。提出内容と原本は別に保存されています。', '[data-album-photo]'),
    step(p, 'apply', '選択内容を反映する', '反映ボタンを押すと、展示アルバムと未送信の追加対象に選択が反映されます。', '[data-album-apply]'),
  ], 'staff', true),
);

const layoutDetails = [
  ['layout-basic', '展示レイアウトの基本', '展示室を開き、作品を配置して保存します。', '[data-layout-canvas]', '作品や設備を選んで移動します。床面と壁面を切り替え、配置やサイズを確認してください。'],
  ['layout-draw', '図形・線・文字を描く', '描画ツールから図形や文字を追加します。', '[data-layout-shape], [data-vector-tool], [data-layout-tool]', '描画ツールや図形を選び、キャンバス上で追加します。選択後はプロパティで線・塗り・文字を調整できます。'],
  ['layout-align', '配置・整列・スナップ', '複数選択と整列、スナップで配置を整えます。', '[data-layout-align], [data-layout-canvas]', '対象を選択し、整列や間隔調整を使います。スナップ設定でグリッドや周囲の形状への吸着を調整できます。'],
  ['layout-dimensions', '寸法・サイズを確認する', 'サイズや距離を計測し、寸法表示を調整します。', '[data-layout-tool="ruler"], [data-layout-canvas]', '計測ツールで基準点を選んで距離を確認します。サイズ・寸法の表示設定も利用できます。'],
  ['layout-history', '履歴・元に戻す・復元', '編集履歴と保存状態を確認します。', '[data-layout-undo], [data-layout-history], [data-layout-canvas]', '元に戻す・やり直しで編集を調整できます。保存済み履歴からの復元は対象の日時と内容を確認して行ってください。'],
  ['exhibition-form', '出展フォームの項目を設定する', '展示区分、入力項目、作品数やサイズの上限を設定します。', '#exhibition-admin', 'フォーム設定画面で項目や上限を設定し、プレビューを確認してください。'],
  ['exhibition-submissions', '提出状況・作品を確認する', '未提出・下書き・提出済みの状況と作品を確認します。', '[data-submission-tab], #exhibition-admin', '提出状況の各タブで対象者と作品を確認します。対象者を押すと詳しい提出内容を開けます。'],
  ['exhibition-series', '組写真の配置・サイズ編集', '組写真の編集画面から写真を配置します。', '[data-add-series-photo], [data-count="series"]', '組写真の枚数を設定し、写真をアップロードします。各写真の幅・高さ・X・Y・回転を入力してください。入力内容は下書きとして保存されます。正式提出は「提出する」から行います。'],
  ['home-photo-settings', 'ホームに表示する写真の設定', 'ホームの写真から除外する作品を選びます。', '[aria-controls="home-photo-picker"]', '写真の除外設定を開き、公開Portfolioの写真から除外対象を選びます。変更後は画面の保存操作を行ってください。'],
];
for (const [id, title, description, target, text] of layoutDetails) detailBlueprints.push(b(id, title, description, id === 'layout-align' ? [title, '両端の余白も含めて均等配置', '壁面の作品を等間隔に並べる'] : [title], id === 'home-photo-settings' ? '/Admin/content/home' : '/Member/manage/exhibitions', /./, p => [step(p, 'locate', title, text, target, id.startsWith('layout-') ? { activate: '[data-open-room-editor="wall"]' } : {}), step(p, 'finish', '変更を確認する', '変更を画面で確認し、保存状態を確かめてください。案内を終了すると元の基本説明に戻ります。', target)], id === 'exhibition-series' ? 'member' : id === 'home-photo-settings' ? 'admin' : 'staff', true));
detailBlueprints.push(b('layout-locate', '配置済みの作品を図面で探す', '作品を検索して、配置された展示室・壁面などを表示します。', ['作品の配置場所', '配置済みの作品を検索', '展示レイアウトの作品検索'], '/Member/manage/exhibitions', /./, p => [
    step(p, 'editor', '図面の編集画面を開く', '編集画面の「作品」タブに、展示する作品が表示されます。', '[data-layout-tab="works"]', { activate: '[data-open-room-editor="wall"]' }),
    step(p, 'search', '作品を検索する', '作品名や作者名を入力すると、一覧を絞り込めます。', '[data-layout-work-search]', { activate: '[data-layout-tab="works"]' }),
    step(p, 'filter', '配置済みの作品に絞り込む', '配置状況で「配置済み」を選ぶと、すでに配置した作品だけを表示できます。', '[data-layout-work-filter]'),
    step(p, 'locate', '作品の場所を表示する', '検索結果の作品を押すと、配置した展示室や壁面の位置へ移動します。', '[data-layout-work-locate]'),
  ], 'staff', true));

detailBlueprints.push(
  b('accounting-requests', '立替申請の確認', '立替申請の内容を照合し、承認または却下します。', ['立替申請の確認'], '/Admin/accounting', /./, p => [
    step(p, 'tab', '未承認の申請を表示する', '申請者と費用が分かる対象のカードを確認します。', '#accounting-content section:first-child h3', { activate: '#accounting-nav [data-tab="requests"]' }),
    step(p, 'receipt', '添付の領収書を確認する', '領収書がある場合はリンクを開き、申請された金額と内容を照合します。', 'a[href^="/api/admin/accounting/receipts/"]'),
    step(p, 'member', '名簿で申請者を確認する', '申請した人に対応する会計の人物を選びます。', '[data-form="review"] [name="memberId"]'),
    step(p, 'note', '確認メモや却下理由を書く', '確認したことや、却下する場合の理由を記入します。', '[data-form="review"] [name="note"]'),
    step(p, 'approve', '承認する場合は確認画面を開く', '内容に問題がなければ「承認内容を確認する」を押します。', '[data-form="review"] [value="approve"]'),
    step(p, 'reject', '却下する場合は確認画面を開く', '却下する場合は理由を確認して「却下内容を確認する」を押します。', '[data-form="review"] [value="reject"]', { complete: { kind: 'present', selector: '#accounting-confirm[open]' } }),
    step(p, 'confirm', '申請の処理を確定する', '確認画面で対象者・金額・処理内容を確認して確定します。', '#accounting-confirm-send'),
  ], 'executive', true),
  b('accounting-refunds', '立替の返金を記録する', '未返金の立替を選び、実際の返金を記録します。', ['立替の返金を記録する'], '/Admin/accounting', /./, p => [
    step(p, 'tab', '未返金の明細を確認する', '立替・返金の画面で、対象者と未返金額を確認します。', '#accounting-content section:nth-of-type(2) h3', { activate: '#accounting-nav [data-tab="advances"]' }),
    step(p, 'refund', '対象の立替の返金を開く', '対象の明細で「返金を記録する」を押すと、取引記録が開きます。', '[data-refund]'),
    step(p, 'date', '返金日を入力する', '実際に返金した日を指定します。', '[data-form="transaction"] [name="date"]'),
    step(p, 'amount', '返金した金額を入力する', '未返金額を確認し、実際に支払った金額を入力します。', '[data-form="transaction"] [name="amount"]'),
    step(p, 'preview', '返金の内容を確認する', '取引内容の確認画面を開き、返金先・金額を照合します。', '[data-form="transaction"] button[type="submit"]'),
    step(p, 'confirm', '返金の記録を確定する', '確認画面から記録を確定します。', '#accounting-confirm-send'),
  ], 'executive', true),
  b('accounting-roster', '会計の人物対応を確認する', '共通名簿の回答と会計に登録された人物の対応を確認します。', ['会計の人物対応を確認する'], '/Admin/accounting', /./, p => [
    step(p, 'tab', '未確認の人物を表示する', '名簿タブで会計との対応を確認する人物を探します。', '#accounting-pending-list', { activate: '#accounting-nav [data-tab="roster"]' }),
    step(p, 'search', '候補を氏名・大学・LINE名で検索する', '同一人物と判断できるか、登録済みの情報を照合します。', '[data-roster-key] input[type="search"]'),
    step(p, 'member', '紐付け先の人物を選ぶ', '同一人物なら既存人物を選び、別人なら新しい人物として登録する選択肢を使います。', '[data-form="resolveRoster"] select'),
    step(p, 'preview', '確認画面を開く', '対応内容を確かめ、確認画面へ進みます。', '[data-form="resolveRoster"] button[type="submit"]'),
    step(p, 'confirm', '人物の対応を保存する', '確認画面の内容を読んで確定してください。', '#accounting-confirm-send'),
  ], 'executive', true),
  b('accounting-recover', '会計の中断した保存を再確認する', '保存の結果が未確認の場合、前回の操作を再確認します。', ['会計の中断した保存を再確認する'], '/Admin/accounting', /./, p => [
    step(p, 'tab', '中断した保存の案内を確認する', '前回の操作結果が未確認であることを画面で確認します。', '#accounting-retry:not([hidden]), #accounting-issues .accounting-notice', { activate: '#accounting-nav [data-tab="summary"]' }),
    step(p, 'retry', '前回の操作を再確認する', '再確認ボタンを押して、前回と同じ内容で処理結果を確認します。', '#accounting-retry-button, #accounting-issues [data-action="recover"]'),
    step(p, 'confirm', '再確認する内容を確定する', '確認画面で前回の内容を照合して確定します。', '#accounting-confirm-send'),
  ], 'executive', true),
);

function contextualSteps(id: string, p: string, fallback: HelpStep[], user?: User | null): HelpStep[] {
  const intro = (text: string, target = 'main h2, main .section-title h1, main h1') => step(p, 'overview', 'このページでできること', text, target);
  if (id === 'roster') return p.endsWith('/preview') ? [
    overview(p, '取得した名簿と現在の名簿を比較します。'),
    step(p, 'review', '取得した変更を確認する', '新規・退会・学年の変更を確認してください。本人が不明な回答は、元の回答と照合します。', 'main table, main section'),
    step(p, 'confirm', '変更内容を確認したことを示す', '反映する内容を確認したら確認欄にチェックします。', '[data-activity-action="roster.apply"] [name="confirm"]'),
    step(p, 'apply', '確認した内容を適用する', '適用すると確認した変更が名簿へ反映されます。', '[data-activity-action="roster.apply"] button[type="submit"]'),
  ] : [
    overview(p, '入会・継続の参照先と、名簿からアカウントへの反映を管理します。'),
    step(p, 'source', '入会フォームの参照先を指定する', '入会フォームの回答を取得するURLを入力します。回答シートならgid付きのURLを指定します。', '[data-activity-action="roster.preview"] [name="admissionUrl"], [data-activity-action="roster.preview"] input[type="url"]'),
    step(p, 'continuation', '継続フォームの参照先を指定する', '継続フォームの回答を取得する場合は、対応するURLを入力してください。', '[data-activity-action="roster.preview"] [name="continuationUrl"]'),
    step(p, 'preview', '取得内容の確認画面を開く', '取得した名簿と現在の名簿の違いをプレビューで確認します。', '[data-activity-action="roster.preview"] button[type="submit"]'),
    step(p, 'link', '未連携のアカウントを確認する', '氏名一致の候補を本人の回答と照合し、該当するアカウントに連携します。', '[data-roster-account-search]', { details: ['roster-link'] }),
    step(p, 'retry', '名簿反映のエラーを確認する', '統合名簿やPortfolioの反映状況は、エラーが表示された項目を確認してください。', '[data-activity-action="roster.retry"], [data-activity-action="roster.sync"]', { details: ['roster-retry'] }),
  ];
  if (id === 'contact') return [
    overview(p, '必要事項を入力して、Confirmで送信前の確認画面を開きます。'),
    step(p, 'name', 'お名前を入力する', '返信先のお名前を入力してください。', '#contact-form [name="name"]', { complete: fields('#contact-form [name="name"]') }),
    step(p, 'furigana', 'フリガナを入力する', 'お名前の読みをカタカナで入力します。', '#contact-form [name="furigana"]', { complete: fields('#contact-form [name="furigana"]') }),
    step(p, 'contact', '所属を入力する', '学校名を入力します。学生でない場合は所属企業名を入力してください。', '#contact-form [name="institution"]', { complete: fields('#contact-form [name="institution"]') }),
    step(p, 'faculty', '学部を入力する場合', '学部がある場合は記入できます。', '#contact-form [name="faculty"]', { complete: fields('#contact-form [name="faculty"]') }),
    step(p, 'grade', '学年を選ぶ', 'ご自身に当てはまる選択肢を選んでください。', '#contact-form td.input-td:has([name="grade"])', { heading: '#grade', complete: fields('#contact-form [name="grade"]') }),
    step(p, 'email', 'メールアドレスを入力する', '返信を受け取れるメールアドレスを入力します。', '#contact-form [name="email"]', { complete: fields('#contact-form [name="email"]') }),
    step(p, 'inquiry', 'お問い合わせの種類を選ぶ', '入会希望、見学・体験希望、撮影依頼、その他から選びます。', '#contact-form td.input-td:has([name="inquiry"])', { heading: '#inquiry', complete: fields('#contact-form [name="inquiry"]') }),
    step(p, 'message', 'お問い合わせの内容を書く', '相談したいことや希望の日程など、伝えたい内容を詳しく記入します。', '#contact-form textarea', { complete: fields('#contact-form textarea') }),
    step(p, 'send', 'Confirmで確認画面を開く', '入力が済んだらConfirmを押し、送信前の確認画面を開きます。', '#contact-form .confirm-button'),
    step(p, 'submit', 'Submitで送信する', '確認画面で内容を読み、Submitを押して送信します。', '#contact-send'),
  ];
  if (id === 'exhibition-series') return [
    step(p, 'count', '組写真の作品数を指定する', '展示区分を選び、組写真の作品数を指定します。', '[data-count="series"]'),
    step(p, 'open', '組写真の編集画面を開く', '対象の組写真で、配置・サイズを編集するボタンを押します。', '[data-series-open]'),
    step(p, 'add', '組写真に写真枠を追加する', '構成する写真の枚数に合わせて枠を追加します。', '[data-series-add-photo]'),
    step(p, 'canvas', '図面上で写真を並べる', '配置画面で写真を選択し、位置や間隔を調整します。', '[data-series-editor]'),
    step(p, 'width', '写真の横幅を調整する', '写真ごとのサイズ・位置を開き、横幅をmmで入力します。', '[data-series-photo-key="width"]'),
    step(p, 'height', '写真の高さを調整する', '高さをmmで入力し、作品全体の寸法を確認します。', '[data-series-photo-key="height"]'),
    step(p, 'rotation', '写真を回転させる', '必要な場合は回転角を指定し、図面上で見え方を確認します。', '[data-series-photo-key="rotation"]'),
    step(p, 'close', '組写真の編集画面を閉じる', '作品全体の配置を確認したら出展フォームへ戻ります。', '[data-series-dialog-close]'),
    step(p, 'submit', '組写真を含めて作品を提出する', '出展フォームで写真と作品情報を確認し、正式に提出します。', '[data-submit]'),
  ];
  if (id === 'photo-details') {
    const photoPath = p === '/Gallery' ? '/Gallery/*' : p;
    const photos = [step(photoPath, 'open', '写真を開く', '一覧の写真を押して拡大画面を開いてください。すでに開いている場合は「次へ」で情報表示の説明へ進みます。', '.photo-open'), step(photoPath, 'information', '撮影情報を表示する', '拡大した写真をもう一度押すと、作品の説明や撮影情報を表示・非表示にできます。', '#photo-dialog [data-photo-toggle]'), step(photoPath, 'like', 'いいねを付ける', 'ハートのボタンでいいねを付けたり解除したりできます。利用には承認済みアカウントでのログインが必要です。', '#photo-dialog [data-photo-like]')];
    photos.push(
      step(photoPath, 'likers', 'いいねした会員を確認する場合', 'いいねの件数がボタンで表示されている場合は、押して一覧を開けます。', '#photo-dialog [data-photo-count]'),
      step(photoPath, 'previous', '前の写真へ移動する', '複数の写真を表示できる場合は、前の写真の矢印で切り替えます。', '#photo-dialog [data-photo-prev]'),
      step(photoPath, 'next', '次の写真へ移動する', '次の写真の矢印で、同じ一覧の次の写真を開きます。', '#photo-dialog [data-photo-next]'),
    );
    return p === '/Gallery' ? [step(p, 'album', 'アルバムを選ぶ', '写真を見るアルバムのカードを押してください。移動した先で写真の操作を案内します。', 'main a[href^="/Gallery/"]'), ...photos] : photos;
  }
  if (id === 'portfolio-photo') return [
    step(p, 'photo', '編集する写真を選ぶ', '対象の写真の「写真情報を編集」を押すと、入力画面が開きます。', '#picture-list [data-photo-edit]'),
    step(p, 'title', '写真のタイトルを入力する', '公開する写真のタイトルを入力できます。', '#portfolio-photo-title'),
    step(p, 'caption', '写真の説明を書く', '撮影時の意図や作品の説明をキャプションに記入します。空欄にした項目は公開画面に出ません。', '#portfolio-photo-caption'),
    step(p, 'camera', 'カメラ名を入力する', '機材・撮影設定に使用したカメラを記入できます。', '#portfolio-photo-camera'),
    step(p, 'lens', 'レンズ名を入力する', '使用したレンズを公開する場合はレンズ欄に入力します。', '#portfolio-photo-lens'),
    step(p, 'film', '使用したフィルム名を入力する', 'フィルムで撮影した作品は、銘柄を入力すると作品情報に表示できます。', '#portfolio-photo-film'),
    step(p, 'aperture', '絞り値を入力する', '作品に表示したい場合は撮影時の絞り値を入力します。', '#portfolio-photo-fNumber'),
    step(p, 'shutter', 'シャッター速度を入力する', '撮影時に使ったシャッター速度を入力できます。', '#portfolio-photo-shutterSpeed'),
    step(p, 'iso', 'ISO感度を入力する', '使用したISO感度を入力できます。', '#portfolio-photo-iso'),
    step(p, 'apply', '写真の編集を反映する', '編集内容を確認し、「編集内容を反映」を押して編集画面へ戻ります。', '#portfolio-photo-editor .photo-editor-apply'),
    step(p, 'save', 'Portfolio全体を保存する', '「Save changes」を押して公開内容を更新します。', '#submit-button'),
  ];
  if (id === 'home-photo-settings') return [
    step(p, 'open', '写真の除外設定を開く', 'ホームの編集画面で「写真の除外設定を開く」を押します。', '[aria-controls="home-photo-picker"]'),
    step(p, 'select', 'ホームに出さない写真を選ぶ', '対象写真を押すと「除外中」になります。もう一度押すと選択を解除できます。', '#home-photo-picker-grid [data-photo-id]'),
    step(p, 'apply', '選択を編集画面へ反映する', '除外する作品を確認して「選択を反映」を押します。', '#home-photo-apply'),
    step(p, 'save', 'ホームの下書きを保存する', '反映した選択を含めて下書きを保存します。', '#content-editor button[type="submit"]'),
    step(p, 'preview', 'プレビューでホームの表示を確認する', '公開前にプレビューを開いて、選択した作品が除外された状態を確認します。', '#preview-content'),
    step(p, 'publish', '変更を公開する', 'プレビューを確認してから公開ボタンへ進みます。', '#publish-content'),
  ];
  if (id === 'grouping') return p === '/Member/manage/grouping' ? [
    overview(p, '参加者を先に保存し、続いて班数や条件を設定します。'),
    step(p, 'title', '班分け名を入力する', '企画や開催日が分かる名前を入力します。', '[data-activity-action="run.save"] [name="title"]', { complete: fields('[data-activity-action="run.save"] [name="title"]') }),
    step(p, 'participants', '班分けの参加者を選ぶ', '名前検索などで参加者を探し、班分けに入れる会員にチェックを付けます。', '[data-grouping-participants] [data-recipient-id], [data-grouping-participants] [data-recipient-search]'),
    step(p, 'previous', '前回の班分けを参照する場合', '前回と同じ組合せを減らしたいときは、参照する班分けを選びます。', '[name="previousRunId"]'),
    step(p, 'save', '参加者を保存して班分けへ進む', '参加者を確かめ、「参加者を保存して班分けへ」を押します。', '[data-activity-action="run.save"] button[type="submit"]'),
  ] : [
    overview(p, '班数と条件を指定し、生成した班案を確認して公開します。'),
    step(p, 'count', '班の数を指定する', '参加者の人数に合わせて必要な班の数を指定します。', '[data-activity-action="groups.rules"] [name="count"]'),
    step(p, 'min', '1班あたりの最少人数を指定する', '班ごとの人数の下限を決めます。', '[data-activity-action="groups.rules"] [name="min"]'),
    step(p, 'max', '1班あたりの最多人数を指定する', '班ごとの人数の上限を決めます。', '[data-activity-action="groups.rules"] [name="max"]'),
    step(p, 'leaders', '班のリーダーを選ぶ', '班ごとのリーダーを選んでください。', '[data-leaders] [name="leader"]'),
    step(p, 'pairs', '同じ班・別の班にする条件を指定する', '必要があれば、該当する条件の「ペアを追加」で2人を指定します。', '[data-pairs] [data-add-pair]'),
    step(p, 'rules', '条件を保存する', '班数・人数・リーダーと条件を確認して保存します。', '[data-activity-action="groups.rules"] button[type="submit"]'),
    step(p, 'generate', '班案を自動生成する', '設定を確認して「班を自動生成」を押すと、条件に沿った班案が表示されます。', '[data-activity-action="groups.generate"] button[type="submit"]'),
    step(p, 'review', '生成された班案を確認する', '各班の人数と希望条件に関する警告を確認します。', '[data-group-summary], [data-group-board]', { details: ['group-export'] }),
    step(p, 'adjust', '必要に応じてメンバーを入れ替える', '班案で対象者を選び、別の班へ移動するか、別のメンバーと交換します。', '[data-group-board] [data-person-id]'),
    step(p, 'save-groups', '班案の変更を保存する', '手動で変更した場合は班案を保存し、人数や条件を再度確認します。', '[data-activity-action="groups.save"] button[type="submit"]'),
    step(p, 'publish', '班分けを公開する', '内容を確認したら、公開ボタンで参加者が確認できる状態にします。', '[data-activity-action="groups.publish"] button[type="submit"]'),
  ];
  if (id === 'home') return [intro('サークルの活動やメンバーの写真を紹介しています。', 'main .main-visual h1, main h1'), ...fallback.slice(1)];
  if (id === 'gallery') return p === '/Gallery' ? [
    overview(p, '公開されている活動や写真展のアルバムを探せます。'),
    step(p, 'album', '見たいアルバムを選ぶ', 'アルバムのタイトルを確認し、カードを押すと写真一覧へ移動します。', 'main a[href^="/Gallery/"]'),
    step('/Gallery/*', 'photo', 'アルバムの写真を拡大する', '一覧から写真を押して拡大画面を開きます。', '[data-photo-ref].photo-open', { details: ['photo-details'] }),
    step('/Gallery/*', 'information', '拡大画面で撮影情報を表示する', '拡大した写真をもう一度押すと、作品の情報が開きます。', '#photo-dialog [data-photo-toggle]'),
  ] : [
    overview(p, '選択したアルバムの写真を閲覧できます。'),
    step(p, 'photo', '写真を拡大する', '写真を押して拡大画面を開きます。「組写真」の表示が付いた作品は、まず全体の配置が開きます。', '.photo-open', { details: ['photo-details', 'photo-series-view'] }),
    step(p, 'information', '写真の撮影情報を表示する', '拡大した写真をもう一度押すと、撮影情報やキャプションを確認できます。フィルム名は登録されている場合に表示されます。', '#photo-dialog [data-photo-toggle]', { details: ['gallery-film'] }),
    step(p, 'next-photo', '次の写真に移動する', '拡大画面の矢印を押すと、アルバム内の次の写真に切り替わります。', '#photo-dialog [data-photo-next]'),
    ...(isStaff(user) ? [step(p, 'album-settings', 'アルバムの設定を開く', '歯車のボタンから公開範囲やカバー写真を設定したり、写真ごとの公開を切り替えたりできます。', '[data-open-gallery-settings]', { details: ['gallery-settings', 'gallery-exclusions'] })] : []),
  ];
  if (id === 'portfolio') return p === '/Portfolio' ? [
    overview(p, '学年別のカードから、メンバーのプロフィールと作品を開けます。'),
    step(p, 'find', 'メンバーを選ぶ', '見たいメンバーのカードを押すと、その人のPortfolioへ移動します。', 'main a[href^="/Portfolio/"]'),
    step(p, 'grade', '学年ごとの一覧を開く', '見たい学年の見出しを押すと、その学年のメンバーを表示します。', '[data-portfolio-grade]:not([data-portfolio-grade="All"]):not([data-portfolio-grade="OB/OG"]) > summary'),
    step(p, 'executives', '役職が設定されたメンバーを確認する', '「Executives / 幹部」では、幹事長・副幹事長・会計の順に掲載されます。', '.executive-section > summary', { details: ['portfolio-office'], complete: { kind: 'present', selector: 'main:not(:has(.executive-section))' } }),
    ...alumniSteps(p),
  ] : [
    overview(p, 'このメンバーのプロフィールと作品を閲覧できます。'),
    step(p, 'photo', '単写真を開く', '作品写真を押して拡大します。撮影情報やいいねの操作は詳しい案内でも確認できます。', '.photo-wrapper:not([data-photo-series]) .photo-open', { details: ['photo-details'], complete: { kind: 'present', selector: 'main:not(:has(.photo-wrapper:not([data-photo-series]) .photo-open))' } }),
    step(p, 'series', '組写真を開く', '「組写真」のカードを押し、作品全体の配置から気になる写真を選べます。', '[data-photo-series="true"] .photo-open', { details: ['photo-series-view'], complete: { kind: 'present', selector: 'main:not(:has([data-photo-series="true"]))' } }),
    step(p, 'book', 'ブックを開く', '「ブック」の表紙を押して開き、「ブックを読む」からリーダーへ進めます。', '[data-portfolio-book-open]', { details: ['portfolio-book-view'], complete: { kind: 'present', selector: 'main:not(:has([data-portfolio-book-open]))' } }),
    step(p, 'share', 'Portfolioの共有画面を開く', 'プロフィール横の共有ボタンを押します。', '[data-portfolio-share-open]'),
    step(p, 'copy', '共有用のリンクをコピーする', '共有画面でリンクのコピーボタンを押し、共有先に貼り付けます。', '#portfolio-share-copy-link'),
    step(p, 'qr', '共有用のQR画像をコピーする', 'QR画像を押すとコピーできます。画像ファイルとして保存するときはダウンロードを使います。', '.portfolio-share-qr'),
    step(p, 'download', '共有用QRをダウンロードする', '画像ファイルとして使う場合はダウンロードを押します。', '#portfolio-share-download'),
  ];
  if (id === 'accounts') return p === '/Admin/accounts' ? [
    overview(p, '検索条件でアカウントを絞り込み、登録内容を確認できます。'),
    step(p, 'find', '名前やメールアドレスで検索する', '検索欄に名前やメールアドレスの一部を入力し、対象を探します。', '#account-query'),
    step(p, 'pending', '承認待ちだけを表示する', '新規登録を確認する場合は「承認待ち」の絞り込みを使います。', 'main a[href="/Admin/accounts?status=pending"], select[name="status"]'),
    step(p, 'edit', '対象者の詳細を開く', '名前とメールを確かめ、対象者の「登録内容を見る」を押します。', '.admin-account-links a[href^="/Admin/accounts/"]', { details: ['portfolio-office'] }),
  ] : [
    overview(p, '選択した会員の登録内容を確認します。編集可能な項目は会員と権限によって異なります。'),
    step(p, 'review', '登録内容を確認する', '対象者の氏名、承認状態、現在の権限を確認してください。', 'main [aria-label="登録内容"]'),
    ...(hasRole(user, 'admin') ? [step(p, 'office', 'Portfolioに掲載する役職を設定する', 'Portfolioが連携済みの会員は、ここで掲載役職を選んで保存できます。サイト内のログイン権限は、後の「登録内容を編集」で設定します。', '#portfolio-office-select', { details: ['portfolio-office'], complete: { kind: 'present', selector: 'main:not(:has(#portfolio-office-select))' } })] : []),
    step(p, 'edit', 'アカウント名を編集する', 'アカウント名を訂正する場合は、対象者の名前を確認して入力します。', '#account-name'),
    step(p, 'email', 'メールアドレスを編集する', 'アドレスの変更が必要な場合は、入力内容を確認してください。', '#account-email'),
    step(p, 'role', 'アカウントの権限を選ぶ', '担当する業務に必要な権限を選びます。変更できる範囲は管理者の権限に応じて変わります。', '#account-role'),
    step(p, 'save', '変更内容を保存する', '入力内容と対象者を確認し、保存ボタンを押します。', '#account-editor button[type="submit"]'),
    step(p, 'approve', '承認待ちの登録を確認する', '承認待ちの場合は、登録内容を確認して承認画面を開けます。', '[data-approval-open]'),
  ];
  if (id === 'exhibition-manage') {
    if (p === '/Member/manage/exhibitions') return [
    overview(p, '写真展を新しく作成するか、作成済みの写真展を開きます。'),
    step(p, 'create', '新しい写真展の名前を入力する', '新規作成欄に写真展の名前を入力します。', '#create-exhibition [name="title"]'),
    step(p, 'create-open', '写真展の設定画面を開く', '入力した名前を確認して「作成して設定を開く」を押します。', '#create-exhibition button'),
    step(p, 'existing', '作成済みの写真展を選ぶ', '一覧で対象の写真展を確認し、受付設定へのリンクを開きます。', '.exhibition-card a[href]:not([href$="/form"]):not([href$="/layout"]):not([href$="/shifts"])'),
  ];
    if (p.endsWith('/form')) return contextualSteps('exhibition-form', p, fallback);
    if (p.endsWith('/submissions')) return contextualSteps('exhibition-submissions', p, fallback);
    if (p.endsWith('/layout')) return [
    step(p, 'overview', 'このページでできること', '編集する展示室を選び、図面を開きます。', '#exhibition-admin > h2'),
    step(p, 'room', '編集する展示室を選ぶ', '展示室が複数ある場合は、一覧で編集する展示室を選びます。', '[data-room-select]'),
    step(p, 'add', '展示室を追加する場合', '新しい展示室を作成する場合は追加ボタンを使います。', '[data-room-add]'),
    step(p, 'editor', '展示室の平面図を開く', '展示室全体の形状や設備を確認・編集するには「展示室の編集」を押します。', '[data-open-room-editor="floor"]', { details: ['layout-basic', 'layout-draw', 'layout-dimensions'] }),
    step(p, 'wall', '壁面の編集画面を開く', '壁面に作品を配置するときは「壁面の編集」を開きます。', '[data-open-room-editor="wall"]', { details: ['layout-basic', 'layout-locate', 'layout-align'] }),
    step(p, 'save', '展示室の設定を保存する', '変更した展示室の設定を保存します。編集履歴は詳細案内でも確認できます。', '[data-save-rooms]', { details: ['layout-history'] }),
  ];
    if (p.endsWith('/participants')) return [
    step(p, 'overview', 'このページでできること', '参加投票と作品提出の状況を確認できます。', '#exhibition-admin > h2'),
    step(p, 'filter', '名前で参加者を探す', '名前を入力して対象の会員を探します。', '[data-participant-filter="query"]'),
    step(p, 'filter-vote', '参加回答で絞り込む', '参加、不参加、未定など、確認したい回答の条件を選びます。', '[data-participant-filter="vote"]'),
    step(p, 'filter-submission', '提出状況で絞り込む', '作品提出の状況を条件に絞り込めます。', '[data-participant-filter="submission"]'),
    step(p, 'vote', '参加状態を更新する場合', '対象の行で参加状態を選び直します。', '[data-attendance-user]'),
    step(p, 'save', '参加状態を保存する', '対象者と新しい参加状態を確認し、その行の保存ボタンを押します。', '[data-save-attendance]'),
  ];
    return [
    step(p, 'overview', 'このページでできること', '参加投票・作品提出の受付条件を設定します。各準備画面もこのページから開けます。', '#exhibition-admin > h2'),
    step(p, 'settings', '参加投票の開始日時を設定する', '会員が参加投票を回答できるようになる日時を指定します。', '[data-setting="voteOpensAt"]'),
    step(p, 'vote-deadline', '参加投票の提出期限を設定する', '日本時間で期限を指定します。開催日が設定されている場合、開催日の0時に参加投票が終了します。', '[data-setting="voteClosesAt"]'),
    step(p, 'form-start', '作品提出の受付開始を設定する', '出展フォームの入力を始められる日時を指定します。', '[data-setting="opensAt"]'),
    step(p, 'form-deadline', '作品の提出期限を設定する', '期限を過ぎると警告が表示されます。実際に受付を止める場合は受付状態を「受付終了」にします。', '[data-setting="closesAt"]'),
    step(p, 'intake', '出展フォームの受付状態を選ぶ', '準備中なら下書き、提出を受け付けるなら受付中を選びます。', '[data-setting="status"]'),
    step(p, 'recipients', '参加投票の通知先を選ぶ', '氏名や学年で対象を探し、通知する会員のチェックを確認します。', '[data-exhibition-recipient], [data-recipient-search]'),
    step(p, 'save', '受付設定を保存する', '期間と通知先を確認し、受付設定を保存してください。', '[data-save-settings]'),
    step(p, 'notice', '参加投票の通知本文を書く', '公開前は、回答方法と提出期限が分かる案内文を入力できます。', '[data-exhibition-notice]'),
    step(p, 'publish', '参加投票を公開する', '投票の案内と通知先を確認して、公開ボタンを押します。', '[data-publish-exhibition]'),
    step(p, 'participants', '参加者一覧を開く', '参加投票と作品提出の状態を確認します。', '.exhibition-admin-nav a[href$="/participants"]'),
    step(p, 'form', '出展フォームの設定を開く', '会員が入力する項目や展示区分を設定します。', '.exhibition-admin-nav a[href$="/form"]', { details: ['exhibition-form'] }),
    step(p, 'layout', '展示室・壁面のレイアウトを開く', '作品の配置や展示室の形状を編集できます。', '.exhibition-admin-nav a[href$="/layout"]', { details: ['layout-basic'] }),
    step(p, 'submissions', '提出された作品を確認する', '提出内容、警告やQRの確認へ進みます。', '.exhibition-admin-nav a[href$="/submissions"]', { details: ['exhibition-submissions'] }),
    step(p, 'shifts', '展示シフトを管理する', '希望を集め、担当者を割り当てます。', '.exhibition-admin-nav a[href$="/shifts"]', { details: ['exhibition-shift-manage'] }),
    step(p, 'album', '展示アルバムを管理する', '提出作品のうちアルバムへ掲載する写真を確認できます。', '[data-lightroom-create]', { details: ['exhibition-lightroom'] }),
  ];
  }
  if (id === 'exhibition-form') return [
    step(p, 'overview', 'このページでできること', '会員が入力する出展フォームの展示区分や質問を設定します。', '#exhibition-admin > h2'),
    step(p, 'sections', '展示区分の名前を設定する', '会員が選択する展示の名前を入力します。', '[data-section-key="title"]'),
    step(p, 'description', '展示区分の説明を入力する', '展示の条件や、入力する人に伝えたい注意事項を記入できます。', '[data-section-key="description"]'),
    step(p, 'limits', '展示区分の作品数やサイズを設定する', '展示に合わせて作品数・寸法の目安を設定できます。', '[data-section-limit] input, [data-total-work-limit]'),
    step(p, 'questions', '質問を追加する', '追加ボタンで、会員に入力してほしい質問の欄を作ります。', '[data-add-field]'),
    step(p, 'label', '質問文を入力する', '質問名の欄に、回答してほしい内容を入力します。', '[data-field-key="label"]'),
    step(p, 'type', '質問の回答形式を選ぶ', '自由入力や選択式など、質問に合う形式を選択してください。', '[data-field-key="type"]'),
    step(p, 'required', '必須の質問にするか選ぶ', '必ず回答してほしい項目は必須にします。', '[data-field-key="required"]'),
    step(p, 'preview', '出展者向けの表示をプレビューする', '「プレビューして保存」を押して、出展者に見える項目を確認します。', '[data-save-schema]'),
    step(p, 'confirm', 'フォームの設定を保存する', 'プレビューで質問と表示を確認して、設定の保存を確定します。', '[data-confirm-schema]'),
  ];
  if (id === 'exhibition-submissions') return [
    step(p, 'overview', 'このページでできること', '集計、提出状況、作品画像とQRコードを確認できます。', '#exhibition-admin > h2'),
    step(p, 'summary', '提出人数と作品数を確認する', '概要で人数と作品数を確認します。作品数は最新の提出分を集計しています。', '#submission-summary-title', { activate: '[data-submission-tab="summary"]', details: ['exhibition-boards'] }),
    step(p, 'find', '名前や作品名で検索する', '氏名・作者名・LINE名や、提出済み・下書きの作品名から検索できます。', '[data-submission-search]', { activate: '[data-submission-tab="status"]' }),
    step(p, 'filter', '提出状況で絞り込む', '未提出、下書き、提出済みなどから、確認する対象を選びます。', '[data-submission-stage]'),
    step(p, 'detail', '対象者の提出詳細を開く', 'カードの「詳細を確認」を押してください。警告が付いている場合は該当の項目を確認できます。', '[data-submission-detail]:has([data-submission-warning]), [data-submission-detail]'),
    step(p, 'warnings', '該当する入力欄へ移動する', '詳細に警告がある場合は項目を選ぶと、該当の展示や作品の入力欄に移動できます。', '[data-se-warning-target], .submission-warning-summary'),
    step(p, 'history', '提出履歴を確認する', '詳細の履歴を開くと、提出時刻や期限後提出の表示を確認できます。', '[data-se-tab="history"]'),
  ];
  if (id === 'layout-locate') return fallback;
  if (id.startsWith('layout-')) {
    const open = { activate: '[data-open-room-editor="wall"]', heading: '[data-room-modal-title]' };
    const save = step(p, 'save', '図面の変更を保存する', '編集画面右下の「保存」を押して、保存状態を確認してください。', '[data-layout-save]');
    if (id === 'layout-basic') return [
    step(p, 'canvas', '図面の編集画面を開く', '図面上の作品や設備を選べます。カーソルを合わせるとタイトル、作者、寸法を確認できます。', '[data-layout-canvas]', open),
    step(p, 'view', '編集する図面を選ぶ', '図面の選択欄で、展示室全体や壁面などを切り替えます。', '[data-layout-view]'),
    step(p, 'works', '作品一覧を開く', '「作品」タブを押し、配置する作品を探してください。', '[data-layout-tab="works"]', { details: ['layout-locate'] }),
    step(p, 'add', '配置する作品を選ぶ', '一覧から未配置の作品を選ぶと、図面で配置場所を指定できます。', '[data-layout-work-add]:enabled', { activate: '[data-layout-tab="works"]' }),
    step(p, 'fit', '図面全体を画面に収める', '「全体表示」で、配置を広い範囲で確認できます。', '[data-layout-fit]'),
    save,
  ];
    if (id === 'layout-draw') return [
    step(p, 'tool', '図形を追加するツールを開く', '図形追加を開き、図面に入れたい図形の種類を選びます。', '[data-layout-tool="shapes"]', open),
    step(p, 'pen', 'ペンで線や形を描く', 'ペンを選び、図面に点を置いて線や図形を描きます。', '[data-layout-tool="draw"]'),
    step(p, 'text', '文字を追加する', '文字ツールを選び、図面の表示したい場所に文字を追加します。', '[data-layout-tool="text"]'),
    step(p, 'canvas', '図面上で位置を決める', '選択したツールに合わせて図面上で位置を指定します。', '[data-layout-canvas]'),
    step(p, 'properties', '選んだ図形のプロパティを開く', '図形を選び、プロパティタブで線の色や塗りなどを編集できます。', '[data-layout-tab="properties"]'),
    save,
  ];
    if (id === 'layout-align') return [
    step(p, 'select', '整列する対象を選ぶ', '図面上で対象を選びます。Shiftを押しながら別の対象を選ぶと追加できます。', '[data-layout-canvas]', open),
    step(p, 'align', '整列パネルを開く', '位置や間隔を揃える場合は「整列」タブを押します。', '[data-layout-tab="align"]'),
    step(p, 'equalize', '壁面の両端も含めて均等配置する', '壁面の作品を並べるときは、扉や柱を避けた範囲ごとに作品間隔と両端の余白を揃えられます。', '[data-layout-equalize-surface]', { activate: '[data-layout-tab="align"]' }),
    step(p, 'reference', '整列の基準を選ぶ', '選択範囲、壁面や展示室、キー項目から基準を選びます。', '[data-layout-align-reference]'),
    step(p, 'direction', '揃える方向を選ぶ', '選択した対象を左揃え、中央揃え、上下などに揃えます。', '[data-layout-align="left"]'),
    step(p, 'gap', '指定する間隔を入力する', '一定の距離で並べるときは、使いたい間隔をmmで入力します。', '[data-layout-gap]'),
    step(p, 'snap', 'グリッドへの吸着を設定する', 'グリッドに合わせて置きたいときはグリッド吸着を使います。', '[data-layout-snap]'),
    step(p, 'smart', 'スマートガイドを設定する', '近くの図形の位置に合わせて置くときは、スマートガイドを使います。', '[data-layout-smart]'),
    save,
  ];
    if (id === 'layout-dimensions') return [
    step(p, 'ruler', '定規を選ぶ', '距離や寸法を確認したいときは、左の定規ツールを選びます。', '[data-layout-tool="ruler"]', open),
    step(p, 'canvas', '図面上で計測する', '定規を選んだ状態で図面上の位置を指定し、表示される距離を確認します。', '[data-layout-canvas]'),
    step(p, 'show', '寸法表示を切り替える', '整列パネルの「寸法を表示」で図面上の寸法を確認できます。', '[data-layout-guide="sizes"]', { activate: '[data-layout-tab="align"]' }),
    save,
  ];
    return [
    step(p, 'undo', '直前の編集を元に戻す', '上部の元に戻すボタンで、編集中の直前の変更を取り消します。', '[data-layout-undo]', open),
    step(p, 'redo', '元に戻した操作をやり直す', '取り消した変更を再度適用する場合はやり直しを使います。', '[data-layout-redo]'),
    step(p, 'history', '保存した図面の履歴を開く', '時計のアイコンを押すと、保存済みの履歴を確認できます。', '[data-layout-history]'),
    save,
  ];
  }
  return fallback;
}

function allowed(user: User | null | undefined, minimum?: Role) { return !minimum || hasRole(user, minimum); }
function cleanPath(path: string) { return path.startsWith('/') && !path.startsWith('//') && !/[\\\x00-\x1f]/.test(path) ? path.split(/[?#]/)[0].replace(/\/$/, '') || '/' : '/'; }
const entityKinds: Record<string, string> = { 'event-vote': 'event', 'event-manage': 'event-manage', 'exhibition-vote': 'exhibition', 'exhibition-submit': 'exhibition', 'exhibition-shift': 'shift', 'tool-answer': 'tool', 'account-approve': 'account', 'account-delete': 'deletion', 'admin-login': 'account-access' };
function choicesFor(kind: string, user: User): HelpChoice[] {
  if (kind === 'event' || kind === 'event-manage') return readActivities().events.filter(e => kind === 'event-manage' ? isStaff(user) : e.status === 'published' && e.recipientIds.includes(user.id)).map(e => ({ id: e.id, title: e.title, href: `/Member/${kind === 'event-manage' ? 'manage/' : ''}events/${encodeURIComponent(e.id)}` }));
  if (kind === 'exhibition') return readExhibitions().exhibitions.filter(e => e.participation?.state === 'published' && e.participation.recipientIds.includes(user.id)).map(e => ({ id: e.id, title: e.title, href: `/Member/exhibitions/${e.id}` }));
  if (kind === 'shift') {
    const shifts = readShiftStore();
    return readExhibitions().exhibitions.filter(e => e.participation?.state === 'published' && shifts.records.some(r => r.exhibitionId === e.id && (r.config.state !== 'draft' || r.published))).map(e => ({ id: e.id, title: e.title, href: `/Member/exhibitions/${e.id}/shifts` }));
  }
  if (kind === 'tool' || kind === 'managed-tool') return listTools().filter(t => kind === 'managed-tool' ? isStaff(user) : t.status === 'published' && viewQuestion(t, user)).map(t => ({ id: t.id, title: t.question || '質問', href: `/Member/${kind === 'managed-tool' ? 'manage/' : ''}tools/${t.id}` }));
  if (kind === 'layout') return isStaff(user) ? readExhibitions().exhibitions.map(e => ({ id: e.id, title: e.title, href: `/Member/manage/exhibitions/${e.id}/layout` })) : [];
  if (kind === 'grouping') return isStaff(user) ? readGroupingTools().runs.map(r => ({ id: r.id, title: r.title, href: `/Member/manage/grouping/${r.id}` })) : [];
  if (kind === 'account-access') return isExecutive(user) ? readUsers().filter(t => isMemberAccount(t) && t.id !== user.id && !t.mustResetPassword).map(t => ({ id: t.id, title: t.name || '会員', href: `/Admin/accounts/${encodeURIComponent(t.id)}` })) : [];
  if (kind === 'account') {
    if (!isExecutive(user)) return [];
    const withdrawing = new Set(readDeletionRequests().requests.filter(r => r.status !== 'complete').map(r => r.userId));
    return readUsers().filter(t => canApproveRegistration(user, t) && !withdrawing.has(t.id)).map(t => ({ id: t.id, title: t.name || '申請者', href: `/Admin/accounts/${encodeURIComponent(t.id)}` }));
  }
  if (kind === 'deletion') return isExecutive(user) ? readDeletionRequests().requests.filter(r => { const target = readUsers().find(u => u.id === r.userId); return !target || canManageAccount(user, target); }).map(r => ({ id: r.id, title: r.name || '削除申請', href: `/Admin/account-deletion-requests/${r.id}` })) : [];
  return [];
}
const entityMetadata: Record<string, [string, string, string[], Role]> = {
  'admin-login': ['アカウントへ代理ログインする', '対象者を選び、そのアカウントの権限で閲覧・操作します。', ['代理ログイン', '会員として確認', 'このアカウントでログイン'], 'executive'],
  'event-vote': ['企画に参加回答する', '参加する企画を選び、参加・不参加などを回答します。', ['企画に参加したい', '撮影会に参加', '出欠回答', '参加回答'], 'member'],
  'event-manage': ['企画の参加者・班分けを管理する', '企画の回答と班分けを確認し、必要な更新を行います。', ['参加者管理', '班分け再確認'], 'staff'],
  'exhibition-vote': ['写真展の参加投票をする', '写真展を選び、出展するかどうかを回答します。', ['写真展参加', '出展の参加投票'], 'member'],
  'exhibition-submit': ['写真展に作品を出展する', '写真展の参加投票から作品の入力・写真追加・提出まで案内します。', ['写真展に出展したい', '作品を出す', '写真を提出', '出展フォーム', '写真展に参加したい'], 'member'],
  'exhibition-shift': ['写真展のシフト希望・確定シフトを確認する', '入れる時間を選んで希望を提出し、公開されたシフト表を確認します。', ['シフト表', '展示シフト', 'シフトを提出', 'シフト希望'], 'member'],
  'tool-answer': ['投票・日程調整・目安箱に回答する', '自分が確認できる質問を選んで回答します。', ['アンケートに回答', '日程を回答', '目安箱に投稿'], 'member'],
  'account-approve': ['アカウント登録を承認する', '登録内容を確認し、サイト内で承認します。', ['会員を承認', '登録承認', '申請処理'], 'executive'],
  'account-delete': ['アカウント削除申請を処理する', '本人確認済みの削除申請を確認し、段階を追って処理します。', ['削除申請', '退会処理'], 'executive'],
};

function entityGuide(id: string, user: User, entity?: string): HelpGuide {
  const [title, description, aliases, minimum] = entityMetadata[id];
  const choices = choicesFor(entityKinds[id], user);
  const guide: HelpGuide = { id, title, description, aliases, minimum, category: minimum === 'member' ? '会員' : '管理業務', steps: [] };
  if (!entity) return { ...guide, choices, empty: '現在、案内できる対象がありません。通知や受付期間をご確認ください。' };
  const choice = choices.find(c => c.id === entity);
  if (!choice) throw new Error('この対象の案内を利用できません。');
  const p = choice.href, saved = (key: string): HelpStep['complete'] => ({ kind: 'saved', key: `${key}:${entity}` });
  if (id === 'admin-login') guide.steps = [
    overview(p, '代理ログインの前に、対象のアカウントを確認します。'),
    step(p, 'identity', '代理ログインする相手を確認する', '氏名・メールアドレス・現在の権限を照合してください。', 'main [aria-label="登録内容"]'),
    step(p, 'login', '対象者として代理ログインを開始する', 'このアカウントでログインを押すと対象者として操作できます。同じブラウザの他のタブにも切り替えが反映されます。', '[data-admin-view-account]'),
    step(p, 'return', '代理ログインを終了する', '操作が済んだら上部の代理ログインの表示にある復帰ボタンを押します。切り替える前に編集中の内容を保存してください。', '[data-admin-view-banner] [data-admin-view-stop], [data-admin-view-account]'),
  ];
  if (id === 'event-vote') guide.steps = [
    overview(p, `${choice.title}の詳細を確認し、参加できるか回答します。`),
    step(p, 'schedule', '開催日時を確認する', '企画の開始日時と終了日時を確認し、参加できる日程か確かめます。', 'main dl dt:first-of-type'),
    step(p, 'deadline', '参加回答の提出期限を確認する', '期限を過ぎると警告が表示されます。開催日の日本時間0時からは、参加回答を変更できません。', '[data-vote-warning] .advisory-warning, [data-vote-clock] h3'),
    step(p, 'answer', '参加回答を選ぶ', '回答欄から参加・不参加・未定を選んでください。', '[data-activity-action="vote"] [name="vote"], [data-event-cutoff]', { complete: saved('event-vote') }),
    step(p, 'send', '参加回答を送信する', '「投票する」を押して、選択した回答を保存します。', '[data-activity-action="vote"] button[type="submit"], [data-event-cutoff]', { complete: saved('event-vote') }),
  ];
  if (id === 'event-manage') guide.steps = [
    overview(p, '企画の参加回答と、班分けの案を管理します。'),
    step(p, 'attendance', '企画の参加回答を確認する', '参加者一覧で、参加・不参加・未定の回答を確認してください。', '#attendance'),
    step(p, 'conditions', '班分けの条件を見直す', '班数や人数の条件を確認し、変更が必要な場合は修正して保存します。', '[data-activity-action="groups.rules"] [name="count"]'),
    step(p, 'generate', '新しい班案を生成する', '参加者や条件が変わったときは、現在の状態から新しい案を作れます。', '[data-activity-action="groups.generate"] button[type="submit"]'),
    step(p, 'groups', '生成した班案を確認する', '各班の人数と希望条件に関する警告を確認してください。', '[data-group-summary], [data-group-board]', { details: ['group-export'] }),
    step(p, 'save', '手動で調整した班案を保存する', 'メンバーを入れ替えた場合は変更を保存します。', '[data-activity-action="groups.save"] button[type="submit"]'),
    step(p, 'publish', '班分けを公開する', '班分けを確認して公開を押すと、参加者が確認できる状態になります。', '[data-activity-action="groups.publish"] button[type="submit"]'),
  ];
  if (id === 'exhibition-shift') {
    const e = readExhibitions().exhibitions.find(e => e.id === entity)!;
    const r = readShiftStore().records.find(r => r.exhibitionId === entity)!;
    const state = memberShiftState(e, r, user.id);
    guide.steps = [overview(p, 'シフト希望と確定シフトを切り替えて確認できます。出展しない会員の回答は任意です。')];
    if (state.accepting) {
      if (state.required && !state.layoutSubmitted) guide.steps.push(step(p, 'layout', '先に作品を提出する', '出展者はレイアウトフォームの正式提出後にシフト希望を入力できます。作品提出後、このシフト画面へ戻ってください。', `a[href="/Exhibition/${entity}"]`, { complete: saved('exhibition-submit') }));
      guide.steps.push(
        step(p, 'choose', '入れる時間を選ぶ', '列が日付、行が時間です。入れる枠を選びます。全選択・日別選択のほか、日程が長い場合は前・次の7日間で表示を切り替えられます。', '[data-shift-matrix="answer"] .shift-choice', { activate: '[data-member-tab="answer"]', complete: saved('exhibition-shift') }),
        step(p, 'week', '次の7日間を表示する', '日程が7日を超える場合は、前後の週へ切り替えて続きの希望を選べます。', '[data-shift-matrix="answer"] [data-matrix-page]:enabled'),
        step(p, 'day', '選んだ日の時間をまとめて選択する', '日付ごとの「この日を選択」を押すと、その日程の枠をまとめて選べます。', '[data-shift-matrix="answer"] [data-day-choice="all"]'),
        step(p, 'none', '入れる時間がない場合', 'どの枠にも入れない場合は「入れる時間はない」を選んで提出してください。入れる時間を選んだ場合は、そのまま「次へ」で進みます。', '[data-shift-answer] [name="none"]', { complete: saved('exhibition-shift') }),
        step(p, 'draft', '希望を下書きに保存する', '入力を続ける場合は下書きとして保存できます。正式な回答にするには続く提出ボタンを押してください。', '[data-save-shift]', { complete: saved('exhibition-shift') }),
        step(p, 'submit', 'シフト希望を提出する', '最後に「シフト希望を提出」または「回答を更新して提出」を押してください。期限後でも受付中なら、警告を確認して提出できます。', '[data-shift-answer] button[type="submit"]', { activate: '[data-member-tab="answer"]', complete: saved('exhibition-shift') }),
      );
    } else guide.steps.push(step(p, 'intake', '受付期間を確認する', state.message + ' 公開済みの確定シフトは確認できます。', '[data-member-panel="answer"]', { activate: '[data-member-tab="answer"]' }));
    guide.steps.push(step(p, 'published', '確定シフトを確認する', '公開後はこのタブで担当を確認できます。自分の担当は青緑色です。名前で検索し、「一致した枠へ移動」で担当日を表示できます。', '[data-published-search], [data-member-panel="published"] > .shift-section-heading', { activate: '[data-member-tab="published"]' }));
  }
  if (id === 'exhibition-vote' || id === 'exhibition-submit') {
    const formPath = `/Exhibition/${entity}`;
    guide.steps = [overview(p, `${choice.title}の参加投票・作品提出期間を確認してください。`), step(p, 'vote', '参加投票を回答する', '出展する場合は「参加」を押します。期限を過ぎても、警告を確認して回答できます。開催日が設定されている場合は、その日の日本時間0時に投票受付が終了します。', '[data-event-cutoff], [data-exhibition-answer]', { complete: saved('exhibition-vote') })];
    if (id === 'exhibition-submit') {
      guide.steps[1].complete = saved('exhibition-attending');
      const exhibition = readExhibitions().exhibitions.find(e => e.id === entity)!;
      const state = participationState(exhibition, user);
      if (!state.accepting && (exhibition.status === "closed" || !state.canVote || state.eligible)) {
        guide.steps.push(step(p, 'unavailable', '出展できる期間・参加状態を確認する', state.message + ' 画面に表示されている受付期間をご確認ください。変更が必要な場合は運営へお問い合わせください。', '[data-exhibition-vote] h3'));
        return guide;
      }
    }
    if (id === 'exhibition-submit') guide.steps.push(
    step(p, 'form', '出展フォームへ進む', '「出展フォームを入力する」を押してください。参加と回答し、受付中であれば入力できます。', 'a[href^="/Exhibition/"]'),
    step(formPath, 'begin', '出展を開始する', '「出展を開始する」を押すと、自分の下書きが作られます。', '[data-begin]', { complete: saved('exhibition-start') }),
    step(formPath, 'identity', '出展者の氏名を入力する', '運営が確認できるよう、自分の氏名を入力してください。', '[data-common="name"]', { complete: fields('[data-common="name"]') }),
    step(formPath, 'grade', '学年を選ぶ', '出展者情報で自分の学年を選んでください。', '[data-common="grade"]', { complete: fields('[data-common="grade"]') }),
    step(formPath, 'author', '作者名を入力する', '作品やタイトルボードに載せる作者名を入力します。', '[data-common="authorName"]', { complete: fields('[data-common="authorName"]') }),
    step(formPath, 'works', '展示区分を選ぶ', '作品を出す区分を選ぶと、その区分の作品数を設定できるようになります。', '[data-section-toggle]'),
    step(formPath, 'counts', '作品数を指定する', '選んだ区分で単写真・組写真・ブックのうち該当する作品数を入力します。', '[data-count]'),
    step(formPath, 'photos', '作品写真をアップロードする', '作品の写真を選んでアップロードします。組写真の個別配置は詳しい操作から確認できます。', '[data-upload-work], #exhibition-submission input[type="file"]', { details: ['exhibition-series'] }),
    step(formPath, 'work-title', '作品のタイトルを入力する', '作品に載せるタイトルを入力します。囲みやふりがなは、詳しい操作から設定できます。', '[data-work-key="title"]', { details: ['exhibition-title-fields'] }),
    step(formPath, 'work-caption', '作品のキャプションを書く', '作品について説明したい内容を記入します。', '[data-work-key="caption"]'),
    step(formPath, 'photography', '作品の撮影可否を選ぶ', '展示中の撮影を許可するか、作品ごとに設定します。', '[data-photography-choice]', { details: ['exhibition-photography'] }),
    step(formPath, 'preview', 'タイトルボードの表示を確認する', '作品名や説明がどう表示されるか、プレビューで確認できます。', '[data-preview-boards]'),
    step(formPath, 'submit', '作品を正式に提出する', '警告と必須項目を確認し、「提出する」を押してください。下書きの保存後も提出操作が必要です。', '[data-submit]', { complete: saved('exhibition-submit') })
    );
  }
  if (id === 'exhibition-vote') {
    guide.steps = [
      guide.steps[0],
      step(p, 'period', '参加投票の受付開始と提出期限を確認する', '参加投票の日時は日本時間です。期限を過ぎて受付中の場合は警告が表示されます。', '[data-vote-clock] .exhibition-period'),
      step(p, 'attending', '出展する場合は「参加」を選ぶ', '出展する方は「参加」を押します。受付中は出展フォームへ進めます。', '[data-event-cutoff], [data-exhibition-answer="attending"]', { complete: saved('exhibition-vote') }),
      step(p, 'absent', '出展しない場合は「不参加」を選ぶ', '出展しないことが決まっている場合は「不参加」を押します。', '[data-event-cutoff], [data-exhibition-answer="absent"]', { complete: saved('exhibition-vote') }),
      step(p, 'undecided', '決まっていない場合は「未定」を選ぶ', '判断がつかない場合は「未定」を押します。開催日前で受付中なら、回答を選び直せます。', '[data-event-cutoff], [data-exhibition-answer="undecided"]', { complete: saved('exhibition-vote') }),
      step(p, 'result', '保存された参加回答を確認する', '投票後は「現在の回答」に選んだ内容が表示されます。', '[data-vote-clock] p:has(> strong)'),
    ];
  }
  if (id === 'tool-answer') {
    const tool = listTools().find(tool => tool.id === entity)!;
    const answers = {
      box: ['目安箱に意見を書く', '伝えたい内容を入力欄に記入します。匿名で投稿されるかは画面の説明を確認してください。', '[data-tool-answer] textarea'],
      schedule: ['都合のよい日を選ぶ', '候補日から参加できる日を選択します。', '[data-tool-answer] input:not([type="hidden"])'],
      poll: ['投票する選択肢を選ぶ', '質問に合う回答を選びます。複数選択が許可されている場合は、該当する回答をすべて選べます。', '[data-tool-answer] input:not([type="hidden"])'],
    } as const;
    const [answerTitle, answerText, answerTarget] = answers[tool.kind];
    guide.steps = [
      overview(p, '質問を読み、回答できる状態か確認します。期限後でも受付中なら警告を確認して回答できます。'),
      step(p, 'question', '質問と受付状態を確認する', '質問文を読み、何を回答するか確認します。', '[data-tool-root] .tool-page-header, [data-tool-state-badge]'),
      step(p, 'answer', answerTitle, answerText, answerTarget, { complete: saved('tool-answer') }),
      step(p, 'send', '回答を送信する', '入力した内容を確認して回答・投稿ボタンを押します。', '[data-tool-answer] button[type="submit"], [data-tool-answer] button', { complete: saved('tool-answer') }),
      step(p, 'results', '結果を確認する', '結果の公開条件を満たす場合は、結果を表示するボタンから確認できます。', '[data-load-results], [data-tool-results]'),
    ];
  }
  if (id === 'account-approve') {
    const target = readUsers().find(u => u.id === entity)!;
    const retry = target.approved && (!target.approvalNotifiedAt || target.approvalSetup && !target.approvalSetup.recipientsCompletedAt);
    const completion = retry ? undefined : saved('account-approve');
    guide.steps = [
      overview(p, '対象者の登録内容を確認してから承認します。'),
      step(p, 'review', retry ? '承認後の処理を再確認する' : '承認画面を開く', retry ? 'ボタンを押すと、初期設定や開設メールの再試行を確認できます。' : '「登録を承認する」を押して、対象者を確認する画面を開きます。', '[data-approval-open]', { complete: completion }),
      step(p, 'identity', '確認画面で登録内容を照合する', 'アカウント名、メールアドレス、登録時のPortfolio名が対象者のものか照合してください。', '[data-approval-dialog] dl', { complete: completion }),
      step(p, 'confirm', retry ? '再試行を確定する' : '登録の承認を確定する', retry ? '確認後、「再試行する」を押します。' : '確認後、「この登録を承認する」を押します。', '[data-approval-confirm]', { complete: completion }),
      step(p, 'result', '承認と開設メールの結果を確認する', '表示された結果を確認します。名簿の連携が必要な場合は、幹部以上のやることリストから対象の案内を開けます。', '[data-approval-status], [data-help-target="account-approval"]'),
    ];
  }
  if (id === 'account-delete') guide.steps = [
    overview(p, '申請した会員と処理期限を確認してください。自分の申請は別の管理者が処理します。'),
    step(p, 'start', '削除処理を開始する', '対象者を照合して開始します。開始するとログインと通知を停止し、ローカルの個人データを処理します。', '[data-deletion-start]'),
    step(p, 'external', '外部の保存先を確認する', '画面に示された待機時間が過ぎたら、確認対象の一覧で外部サービスやバックアップを確認します。', '[data-deletion-admin] details > summary'),
    step(p, 'check', '確認した項目にチェックする', '必要な外部確認が済んだものから、確認欄にチェックを入れます。', '[data-deletion-complete] input[name="checks"]'),
    step(p, 'email', '削除対象のメールアドレスを入力する', '処理するアカウントの登録メールアドレスを確認して入力します。', '[data-deletion-complete] [name="confirmationEmail"]'),
    step(p, 'finish', '削除を完了する', 'すべての確認が済んだら確定ボタンを押します。', '[data-deletion-complete] button[type="submit"]', { complete: saved('account-delete') }),
  ];
  return guide;
}

export function helpCatalog(user?: User | null) {
  const entries: HelpGuide[] = [...blueprints, ...detailBlueprints].filter(x => allowed(user, x.minimum)).map(({ id, title, description, aliases, category, minimum, detail }) => ({ id, title, description, aliases, category, minimum, detail, steps: [] }));
  for (const [id, [title, description, aliases, minimum]] of Object.entries(entityMetadata)) {
    if (allowed(user, minimum) || !user?.approved && ['event-vote', 'exhibition-submit', 'tool-answer'].includes(id)) entries.push({ id, title, description, aliases, minimum, category: minimum === 'member' ? '会員' : '管理業務', steps: [] });
  }
  return entries;
}

export function helpGuide(id: string, path: string, user?: User | null, entity?: string): HelpGuide {
  path = cleanPath(path);
  if (entityMetadata[id]) {
    if (!user?.approved || !hasRole(user, entityMetadata[id][3])) throw new Error('ログインまたは権限の確認が必要です。');
    return entityGuide(id, user, entity);
  }
  if (id === 'admin-view' && isStaff(user)) {
    const dest = adminViewPath(user);
    const roles = previewRoles(user);
    const bp = blueprints.find(x => x.id === id)!;
    return { id, title: bp.title, description: bp.description, aliases: bp.aliases, category: bp.category, minimum: bp.minimum, steps: [
      overview(dest, isExecutive(user) ? '代理ログインと、実在の会員を使わないロール別の閲覧専用表示を選べます。' : '一般会員・未ログインの閲覧専用表示を確認できます。'),
      step(dest, 'role', '一般会員の表示を確認する', '一般会員が見られる通知、企画、マイページなどを閲覧専用で確認できます。', '[data-admin-view-role="member"]'),
      ...roles.filter(role => role !== 'member').map(role => {
        const label = role === 'guest' ? '未ログイン' : roleLabels[role];
        return step(dest, `role-${role}`, `${label}の表示を確認する`, `「${label}」を選ぶと、その権限で見える画面を閲覧できます。`, `[data-admin-view-role="${role}"]`);
      }),
      step(dest, 'return', 'ロール表示を終了する', `確認が済んだら、画面上部の「${adminViewReturnLabel(user)}」を押してください。`, '[data-admin-view-banner] [data-admin-view-stop]'),
    ] };
  }
  const bp = [...blueprints, ...detailBlueprints].find(x => x.id === id && allowed(user, x.minimum));
  if (!bp) throw new Error('この案内を利用できません。');
  if (Object.hasOwn(exhibitionGuideViews, id)) {
    const choices = choicesFor('layout', user!);
    const current = path.match(/^\/Member\/manage\/exhibitions\/([^/]+)(?:\/[^/]+)?$/)?.[1];
    const selected = entity || current;
    const metadata = { id, title: bp.title, description: bp.description, aliases: bp.aliases, category: bp.category, minimum: bp.minimum, detail: true };
    if (!selected) return { ...metadata, steps: [], choices, empty: '現在、案内できる写真展がありません。' };
    if (!choices.some(c => c.id === selected)) throw new Error('この写真展の案内を利用できません。');
    const suffix = exhibitionGuideViews[id];
    return { ...metadata, steps: bp.steps(`/Member/manage/exhibitions/${selected}${suffix ? '/' + suffix : ''}`) };
  }
  const detailKind = id.startsWith('layout-') || ['exhibition-form', 'exhibition-submissions'].includes(id) ? 'layout' : id.startsWith('tool-') && id !== 'tool-answer' ? 'managed-tool' : id === 'group-export' ? 'grouping' : ['exhibition-series', 'exhibition-title-fields', 'exhibition-photography'].includes(id) ? 'exhibition' : '';
  const isContextual = detailKind === 'layout' ? /^\/Member\/manage\/exhibitions\/[^/]+(?:\/[^/]+)?$/.test(path) : detailKind === 'managed-tool' ? /^\/Member\/manage\/tools\/[^/]+$/.test(path) : detailKind === 'grouping' ? /^\/Member\/manage\/(?:grouping|events)\/[^/]+$/.test(path) : detailKind === 'exhibition' ? /^\/Exhibition\/[^/]+$/.test(path) : true;
  if (detailKind && user?.approved && (!isContextual || entity)) {
    const choices = choicesFor(detailKind, user).filter(c => id !== 'tool-publication' || manageResults(listTools().find(t => t.id === c.id)!, user));
    if (!entity) return { id, title: bp.title, description: bp.description, aliases: bp.aliases, category: bp.category, detail: true, minimum: bp.minimum, steps: [], choices, empty: '現在、案内できる対象がありません。先に対象を作成または選択してください。' };
    const choice = choices.find(c => c.id === entity);
    if (!choice) throw new Error('この対象の案内を利用できません。');
    path = detailKind === 'exhibition' ? `/Exhibition/${entity}` : choice.href;
  }
  if (id === 'tool-publication') {
    const toolId = path.match(/^\/Member\/manage\/tools\/([^/]+)$/)?.[1];
    const tool = listTools().find(t => t.id === toolId);
    if (!tool || !manageResults(tool, user)) throw new Error('この質問の結果公開を管理する権限がありません。');
  }
  // Detail guides stay in their applicable editor; unrelated pages use the entry page.
  const detailPath = detailKind ? isContextual || !!entity :
    contextualCollectionGuides.has(id) && bp.match.test(path) ||
    id === 'photo-details' && (/^\/(?:Gallery|Portfolio|posts)(?:\/[^/]+)?$/.test(path) || path === '/');
  const dest = bp.detail ? detailPath ? path : bp.entry : bp.match.test(path) ? path : bp.entry;
  const actualDest = id.startsWith('layout-') && /\/exhibitions\/[^/]+/.test(dest) ? dest.replace(/\/(?:form|participants|submissions|layout|shifts)$/, '') + '/layout' : id === 'exhibition-form' && /\/exhibitions\/[^/]+/.test(dest) ? dest.replace(/\/(?:form|participants|submissions|layout|shifts)$/, '') + '/form' : id === 'exhibition-submissions' && /\/exhibitions\/[^/]+/.test(dest) ? dest.replace(/\/(?:form|participants|submissions|layout|shifts)$/, '') + '/submissions' : dest;
  return { id, title: bp.title, description: bp.description, aliases: bp.aliases, category: bp.category, minimum: bp.minimum, detail: bp.detail, steps: contextualSteps(id, actualDest, bp.steps(actualDest), user) };
}

export function pageHelp(path: string, user?: User | null): HelpGuide {
  path = cleanPath(path);
  if (/^\/Member\/manage\/exhibitions\/[^/]+\/shifts$/.test(path) && isStaff(user)) return helpGuide('exhibition-shift-manage', path, user);
  const shiftMatch = path.match(/^\/Member\/exhibitions\/([^/]+)\/shifts$/);
  if (shiftMatch && user?.approved) {
    try { return helpGuide('exhibition-shift', path, user, shiftMatch[1]); } catch { /* Respect the shift page's availability. */ }
  }
  const deletionMatch = path.match(/^\/Admin\/account-deletion-requests\/([^/]+)$/);
  if (deletionMatch && isExecutive(user)) {
    try { return helpGuide('account-delete', path, user, deletionMatch[1]); } catch { /* The page may represent a removed request. */ }
  }
  const entityMatch = path.match(/^\/Member\/(exhibitions|events|tools)\/([^/]+)$/);
  if (entityMatch && user?.approved) {
    try { const guide = helpGuide(({ exhibitions: 'exhibition-submit', events: 'event-vote', tools: 'tool-answer' } as Record<string, string>)[entityMatch[1]], path, user, entityMatch[2]); return { ...guide, steps: guide.steps.filter(s => s.path === path) }; } catch { /* Explain an unavailable page without exposing its records. */ }
  }
  const formMatch = path.match(/^\/Exhibition\/([^/]+)$/);
  if (formMatch && user?.approved) {
    try {
      const guide = helpGuide('exhibition-submit', path, user, formMatch[1]);
      const steps = guide.steps.filter(s => s.path === path);
      return { ...guide, id: 'page-exhibition', steps: steps.length ? steps : [overview(path, '現在は作品を入力できる期間・参加状態ではありません。保存済みの内容と受付状況を確認してください。'), step(path, 'availability', '参加投票・入力期間を確認する', '参加状態や受付期間は、写真展の参加投票ページから確認できます。変更が必要な場合は運営へお問い合わせください。', `a[href="/Member/exhibitions/${formMatch[1]}"]`)] };
    } catch {}
  }
  const bp = blueprints.find(x => x.match.test(path) && allowed(user, x.minimum));
  if (bp) return helpGuide(bp.id, path, user);
  const page = (description: string, steps: HelpStep[] = []): HelpGuide => ({ id: 'page', title: 'このページの使い方', description, aliases: [], category: 'このページ', steps: [overview(path, description), ...steps] });
  if (path === '/AccountDeletion' || path === '/Member/account-deletion') return page('登録メールで本人確認を行い、アカウントの削除を申請します。', [
    step(path, 'email', '登録したメールアドレスを入力する', '削除を申請するアカウントの登録メールアドレスを入力します。', '[data-deletion-email] [name="email"]'),
    step(path, 'request', '確認コードを受け取る', '送信ボタンを押すと、登録メールに確認コードが届きます。', '[data-deletion-email] button[type="submit"]'),
    step(path, 'code', '届いた確認コードを入力する', 'メールに記載された6桁のコードを入力します。', '[data-deletion-confirm] [name="code"]'),
    step(path, 'check', '削除する対象と注意事項を確認する', '表示された注意事項を読み、申請対象を確認してチェックします。', '[data-deletion-confirm] [name="confirm"]'),
    step(path, 'send', '削除申請を送信する', '確認後に送信を押すと、申請が運営へ届きます。', '[data-deletion-confirm] button[type="submit"]'),
  ]);
  if (path === '/ReviewAccount') return page('メールのリンクから、表示されたアカウントの操作を確認します。', [
    step(path, 'review', 'アカウントと操作内容を照合する', '対象者と操作内容が、メールで確認したものと一致するか確かめてください。', '.review > p:has(+ form[action="/api/auth/review"]), .review h1'),
    step(path, 'confirm', '表示された操作を確定する', '確認後、確定ボタンを押してください。リンクが無効と表示された場合は担当者へ確認してください。', 'form[action="/api/auth/review"] button[type="submit"]'),
    step(path, 'result', '処理結果を確認する', '画面に表示される結果を確認します。', '#review-status'),
  ]);
  return page('画面の見出しから情報を確認できます。検索や各リンクで目的のページへ移動してください。');
}
