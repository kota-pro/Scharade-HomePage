// 公開固定ページの正本。XMLと閲覧用サイトマップの両方で使う。
// 会員画面、認証、内部検索、API、企画共有URLはここに追加しない。
export const publicPageSections = [
  {
    title: "Main Pages",
    note: "サイト内の基本ページです。記事・写真・Portfolioの詳細は各一覧から閲覧できます。",
    items: [
      { label: "Home", href: "/", description: "トップページ" },
      { label: "About us", href: "/About_us", description: "活動紹介" },
      { label: "Activity", href: "/Activity", description: "活動記事一覧" },
      { label: "Gallery", href: "/Gallery", description: "アルバム一覧" },
      { label: "Portfolio", href: "/Portfolio", description: "メンバー一覧" },
      { label: "Contact", href: "/Contact", description: "お問い合わせ" },
      {
        label: "Disclaimer",
        href: "/Disclaimer",
        description: "免責事項・ポリシー",
      },
      { label: "Sitemap", href: "/sitemap", description: "公開ページの案内" },
    ],
  },
  {
    title: "App & Account",
    note: "アプリのプライバシーとアカウント削除に関する公開案内です。",
    items: [
      {
        label: "App Privacy",
        href: "/AppPrivacy",
        description: "アプリのプライバシーポリシー",
      },
      {
        label: "Account Deletion",
        href: "/AccountDeletion",
        description: "アカウント削除の申請",
      },
    ],
  },
  {
    title: "Exhibition",
    note: "写真展ツールとGoogle連携についての公開案内です。",
    items: [
      {
        label: "写真展連携",
        href: "/exhibition-integration.html",
        description: "写真展ツールとGoogle連携のご案内",
      },
      {
        label: "写真展のプライバシー",
        href: "/exhibition-privacy.html",
        description: "提出内容と連携データの取り扱い",
      },
      {
        label: "写真展の利用案内",
        href: "/exhibition-terms.html",
        description: "参加登録・入力期間・提出内容の修正",
      },
    ],
  },
];

export const publicPages = publicPageSections.flatMap(
  (section) => section.items,
);
