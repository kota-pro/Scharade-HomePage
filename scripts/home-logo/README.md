# トップページのロゴアニメーション

元データは Illustrator の `scharade_logo.ai` です。書き出した SVG のアートボード上で、ロゴを `(304, 476.07)` から `479 × 116.33` の範囲で切り出しています。公開ページは `src/assets/brand/home-logo-animated.svg` を表示し、動きを減らす設定では `home-logo.svg` を使います。

## After Effectsで調整する

1. `video-guide/home-logo/Scharade_Home_Logo.aep` を開き、`Scharade Home Logo` コンポジションを選びます。
2. `Draw /` レイヤーの `Pen path → Draw → End` で描画のタイミングと速度を調整します。日本語とレンズ内の色は各レイヤーの不透明度で調整します。レンズ内はホールドキーフレームで切り替わります。
3. After Effects の「ファイル → スクリプト → スクリプトファイルを実行」から `Export_Scharade_Home_Logo.jsx` を実行し、`src/assets/brand/home-logo-animated.svg` に保存します。

書き出しはこのコンポジションの構造に対応しています。ベジェパス、塗り、描画マット、指定の不透明度キーフレームを変換します。コンテンツのグループ構造とレイヤーの位置・拡大率は維持してください。

## 元データから組み直す

Illustrator から `scharade_logo.ai` をSVGに書き出します。スタイルはプレゼンテーション属性、テキストはアウトライン、座標の小数桁は5桁に設定します。以下のコマンドでロゴの静止画とAfter Effects用のデータを作ります。

```sh
mkdir -p video-guide/home-logo
python3 scripts/home-logo/prepare.py /path/to/illustrator-export.svg \
  video-guide/home-logo/logo-data.json src/assets/brand/home-logo.svg
```

After Effectsで空のプロジェクトを開き、`Create_Scharade_Home_Logo.jsx` を実行します。生成した `logo-data.json` を選び、AEPを保存してから書き出しスクリプトを実行します。

## ローディング用のカメラと筆記体

カメラと「Loading...」が入った Illustrator 原本の SVG を、同じ書き出し設定で用意します。`prepare-loading.py` が、ループSVG、動きを減らす設定用の静止SVG、After Effects用のデータを生成します。

```sh
mkdir -p video-guide/loading-logo
python3 scripts/home-logo/prepare-loading.py /path/to/illustrator-export.svg \
  src/assets/brand/loading-camera.svg src/assets/brand/loading-camera-still.svg \
  video-guide/loading-logo/loading-data.json
```

`Scharade_Loading_Logo.aep` の `Draw End / Erase Start` で、表示と消去のキーフレームを調整できます。AEPを作り直す場合は、空のプロジェクトで `Create_Scharade_Loading_Logo.jsx` を実行し、`loading-data.json` を選びます。サイト用SVGを更新する場合は、`prepare-loading.py` で設定を調整して再生成します。
