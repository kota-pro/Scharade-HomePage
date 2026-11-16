# 写真・通知のデザイン確認画像

本番候補のLinuxビルドから出力した実画面です。PCは1440×1000、スマホは390×844で確認しています。ポップアップや写真カードの画像は要素単位で切り出しています。

既存のサイト用写真と、架空の会員・作品情報を使用しています。「雪の日」「FUJIFILM X-T5」「XF35mmF1.4 R」などは表示確認用の入力例で、写真の実際の作者・撮影機材を示すものではありません。この確認用データは本番には反映しません。

| 画像 | 確認内容 |
| --- | --- |
| [01-desktop-photo.png](01-desktop-photo.png) | PCの写真詳細。写真を左、作品名・作者・撮影情報・説明を右に配置。匿名閲覧では件数を表示しない |
| [02-desktop-hover.png](02-desktop-hover.png) | ホバー時の作品名、撮影情報、右端のハート |
| [03-mobile-photo.png](03-mobile-photo.png) | スマホの写真優先表示。詳細は折りたたみ |
| [04-mobile-photo-details.png](04-mobile-photo-details.png) | 詳細を開いた状態の撮影情報とキャプション |
| [05-desktop-member.png](05-desktop-member.png) | PCのMember見出し右端下側と挨拶右上の通知マーク |
| [06-desktop-notifications.png](06-desktop-notifications.png) | 写真ごとの通知集約。閉じるボタンの左に一括既読ボタン |
| [07-mobile-member.png](07-mobile-member.png) | スマホのMember見出しと同じ行の右端にベルを配置 |
| [08-mobile-notifications.png](08-mobile-notifications.png) | スマホの通知ポップアップ |

本番反映前にこの画像を会話内へ出力しています。表示には実フォントを読み込んでいます。任意の入力値への反映、空欄の非表示、匿名いいね、通知の個別・一括既読と幹部権限は、隔離したデータで検証しています。
