# 写団シャレード公式サイト

早稲田大学公認サークル「写団シャレード」のWebサイトです。公開URLは https://scharade.jp 。AstroでHTMLをサーバー生成し、microCMSの記事・会員Portfolio、Adobe Lightroomの写真を表示します。さくらのVPS（Ubuntu）でNode.jsをPM2管理して運用します。

## デザインを維持する方針

レイアウト、書体、配色、装飾、写真の配置、メニュー、アニメーション、ページ送りは改修前のデザインを維持します。表示の軽量化は、画像の圧縮・表示サイズに応じた `srcset`・遅延読み込み・拡大時の画像取得を中心に行います。ブラウザが画面幅・解像度や通信環境に応じて画像候補を選びます。速度改善を理由に見せ方や操作方法を変更しません。デザイン変更には別途運営者の合意が必要です。

管理画面、指定のパンくず、ログイン名から自身のPortfolioへ進む機能は維持しています。[デザイン復元記録](docs/design-restoration.md)に基準と確認範囲をまとめています。

## まず読む資料

- **更新担当者**：[管理画面・日常運用](docs/editor-guide.md)
- **開発・VPS担当者**：[構成と仕様](docs/architecture.md)、[公開・バックアップ・復旧](docs/operations.md)
- **次期担当者**：まず[サイト引き継ぎ書](docs/handover.md)。全体構成・更新方法・保存先・公開・復旧・年度交代をまとめています
- **機能から修正先を探す**：[機能別ファイル対応表](docs/file-guide.md)
- **今後の企画**：[発展ロードマップ](docs/roadmap.md)
- **修正内容・検証範囲**：[検証記録](docs/validation.md)
- **iPhone・Android・Windowsの確認担当者**：[実機確認票](docs/device-validation.md)
- **現在の本番環境・確認事項**：[2026年9月の公開記録](docs/deployment-2026-09.md)
- **その後の公開履歴**：[2026年10月の公開記録](docs/deployment-2026-10.md)。現在の稼働状態はVPSで照合してください
- **写真展の受付・タイトルボード・展示配置**：[写真展ツール運用](docs/exhibition-tool.md)
- **iOS・Androidアプリ・プッシュ通知**：[アプリの開発・配布と削除申請](docs/mobile-app.md)、[不具合調査](docs/mobile-bug-audit.md)

## 開発環境

Node.js 22.12以上の22系、Yarn 1.22.22を使います。パッケージ管理はYarnに統一します。

```sh
corepack enable
yarn install --frozen-lockfile
cp .env.example .env
```

ローカルの `.env` では `DATA_DIR=./.data`、`SITE_URL=http://localhost:4321`、`TRUST_PROXY=0` と設定してください。外部サービスのキーは担当者から安全な手段で受け取り、Git・チャット・スクリーンショットに載せないでください。

```sh
yarn dev
yarn run check
yarn test
yarn build
yarn start
```

`yarn build` は写真のWebP生成、型検査、本番ビルドを順番に実行します。元画像は `src/assets/`、配信用画像は `public/media/site/`、装飾の配信用画像は `public/media/decorations/`、生成履歴はGit対象外の `.image-manifest.json` です。外部APIが未設定のページでは取得失敗の案内が表示されます。

## 管理アカウント

通常会員の申請では管理者になれません。VPS担当者が、**個人会員とは別のメールアドレス**で専用アカウントを作成します。

```sh
yarn admin:create
```

対話形式で表示名・メール・非表示のパスワードを入力します。専用Portfolioも作成されます。既存の未紐付け専用Portfolioがある場合はIDを指定できます。管理者は `/Login` → `/Admin` からサイト情報と全Portfolioを編集できます。「アカウント管理」では登録済みアカウントの一覧・個別内容を確認し、アカウント名・メールアドレス・登録時のPortfolio名・権限（一般会員／運営／管理者）を編集できます。権限変更後は本人の再ログインが必要で、最後の承認済み管理者の降格はできません。同じ登録内容ページから、確認画面を経てアカウントと紐づくPortfolioを削除できます（自分自身の削除は不可）。初期パスワードをソースに埋め込んだアカウントはありません。引き継ぎ時のパスワード変更は `yarn admin:password` で行い、旧セッションを無効にします。

管理画面のサイト情報は「下書き保存 → 実ページで確認 → 公開」。Portfolioは保存時に即時反映されます。この違いに注意してください。

## 保存先

| 情報                                | 正本                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------- |
| トップ・About us・共通情報・案内文  | VPSの `DATA_DIR/site-content.json`。未編集時は `src/data/siteDefaults.ts` |
| 企画・通知・投票・班履歴・班分けプロフィール | `DATA_DIR/member-activities.json` |
| 会員・権限・ログイン                | `DATA_DIR/users.json` / `sessions.json`                                   |
| 活動記事・Portfolio・カルーセル写真 | microCMS                                                                  |
| Gallery写真・アルバム               | Lightroom                                                                 |
| ドメイン・HTTPS・プロキシ           | ドメイン管理サービス／VPSのNginx                                          |
| ソースと配信用固定画像              | Gitリポジトリ                                                             |

**`dist/` を作り直しても会員・編集内容が消えないよう、DATA_DIRを固定してください。** 現在の本番は `/home/ubuntu/scharade-data` です。バックアップなしでこのディレクトリや旧 `.data` を削除してはいけません。
