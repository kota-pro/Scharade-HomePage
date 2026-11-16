# スマホ版デザイン案 v1

2026-10-31 / **配置・レイアウト承認済み／PC版の書体・ロゴ・配色で本番反映済み**

Member・Staff・Adminの配下を含む全32ページへ展開するための、主要3画面＋代表操作7画面の確認用画像です。画像内の名前・予定・件数・メールアドレスは架空の表示例です。2026-10-31に配置・レイアウトの承認を受領しました。追加指定に従い、最上位の英字見出しはDidot、次の見出しはZen Old Mincho、本文はZen Kurenaidoを使います。生成画像のゴシック体は指定の書体に置き換えて実装しました。

[10画面を並べた確認用ギャラリー](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/review.html)

[指定フォントを適用した実装画面10画面](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/implemented/review.html) · [検証・本番反映記録](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/mobile-redesign-2026-10-31.md)

## 画像一覧

| 番号 | 画面 | 確認する点 |
| --- | --- | --- |
| 01 | [Memberトップ](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/01-member-home.png) | 通知・企画・マイページの区切り、共通カード |
| 02 | [Staffトップ](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/02-staff-home.png) | 運営ツールへの入口、行とアイコンの整列 |
| 03 | [Adminトップ](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/03-admin-home.png) | 編集・アカウント・運用のまとまり |
| 04 | [Memberカレンダー](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/04-member-calendar.png) | 月表示と予定一覧の読み分け |
| 05 | [企画詳細・参加投票](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/05-member-event.png) | 項目と値、回答操作、送信ボタン |
| 06 | [立替申請フォーム](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/06-member-advance.png) | ラベルを上に置く縦1列の入力 |
| 07 | [Staff班分け編集](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/07-staff-grouping.png) | 条件設定、班カード、名前の入替と保存 |
| 08 | [Staff写真展レイアウト編集](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/08-staff-exhibition-layout.png) | キャンバス・ツール・設定・保存の分離 |
| 09 | [Adminアカウント一覧](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/09-admin-accounts.png) | 検索・状態・カード内の操作位置 |
| 10 | [Adminページ編集フォーム](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/10-admin-content-editor.png) | 目次・入力欄・下書き保存と公開の区別 |

## 共通ルール

- ロゴ・配色・フォントはPC版サイトに合わせます。Didot／Zen Old Mincho／Zen Kurenaidoを見出し階層に応じて使います。
- 本文16px、補助文14px、左右余白16pxを基本とし、角丸12pxの白いカードを使います。
- 主な操作は高さ48px、アイコン操作は44px以上を基本とします。
- 下部ナビの順番は Member：ホーム／企画／マイページ、Staff：ホーム／企画／運営／マイページ、Admin：ホーム／企画／運営／管理／マイページです。
- 運営・管理は既存のサーバー側権限に応じて表示します。
- 全画面編集とソフトキーボード表示時はWebの下部ナビを退避し、アプリWebViewでは既存のネイティブナビと重複させません。
- スマホ用の変更は768px以下へ適用します。PC・公開ページ・ネイティブアプリ本体は対象外です。

## 実装時の扱い

- 画像はデザイン確認用です。実装ではHTML・CSS・既存コンポーネントを使い、画像をそのまま画面として配置しません。
- 既存の機能・入力項目・送信先・保存処理・権限は保持します。実データの長さや件数に応じて内容はスクロールします。
- 06は入力フォームの先頭部分です。備考、申請者情報、確認ボタンはスクロール先にも保持します。
- 03の「その他のページを編集」は既存ページへの編集リンクを開閉して表示する想定です。
- 08の図面は配置の表示例です。実際の描画・寸法・保存処理は既存エディターを使います。
- ヘッダーのカメラ記号は画像内の仮表現です。本番のブランドロゴには既存SVGを使います。
- 画像の明示的な承認後に全ページへ実装し、ブラウザー・画面幅・権限の検証を経て2026-10-31 03:49 JSTに本番へ反映しました。

## 生成記録

内蔵 image_gen を使用しました。[共通条件・画面別プロンプト・修正内容](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/prompts.json) と [画像のサイズ・SHA-256・承認状態](/Users/kofizeri/Desktop/VScode/Scharade-HomePage/docs/design/mobile-redesign-v1/manifest.json) を保存しています。
