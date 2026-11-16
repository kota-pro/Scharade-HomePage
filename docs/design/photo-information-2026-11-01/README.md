# 写真情報欄のデザイン確認

最終Linux成果物から出力した確認画面です。写真・作者・作品名・機材・キャプションは表示確認用の組み合わせで、実際の作者や機材を示しません。検証用の会員・写真情報は隔離環境だけで使用します。

| 画像 | 内容 |
| --- | --- |
| [01-initial-photo.png](01-initial-photo.png) | 最初は情報欄を閉じて写真を最大表示 |
| [02-desktop-information.png](02-desktop-information.png) | 指定ptサイズ、タイトルと作者、機材と撮影設定の整列 |
| [03-caption-scrolled.png](03-caption-scrolled.png) | キャプションだけをスクロールし、情報見出しとハートは固定 |
| [04-long-equipment.png](04-long-equipment.png) | 長い機材名を改行し、撮影設定の3行を維持 |
| [05-mobile-landscape.png](05-mobile-landscape.png) | 844×390のスマホ横画面 |
| [06-small-mobile.png](06-small-mobile.png) | 568×320の小型スマホ横画面 |
| [07-mobile-portrait.png](07-mobile-portrait.png) | 390×844の縦長写真の情報欄 |
| [08-information-loading.png](08-information-loading.png) | 共通SVGによる情報取得中の表示 |

PCは1460×800です。Zen Old MinchoとGrandiflora Oneの実フォントを使用します。CSSのpt単位は1pt＝4/3pxとしてブラウザーで表示します。
