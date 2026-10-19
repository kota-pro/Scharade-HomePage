// 公開情報の初期値。運用上の編集は管理画面から行います。
export const siteDefaults = {
  common: {
    name: "写団シャレード",
    affiliation: "早稲田大学公認サークル",
    founded: "1974年",
    members: "161名",
    composition:
      "インカレサークル\n（東大、慶応、中央、お茶女、本女、京都美大など）",
    memberRatio: "男女比１：１、早稲田：インカレ = 4：1",
    feeHalfYear: 4000,
    feeAnnual: 8000,
    entranceFee: 0,
    address: "〒162-0052\n東京都新宿区戸山1-24-1\n早稲田大学学生会館E224",
    mapUrl: "https://maps.app.goo.gl/WGv8zg5tN3dyiwy8A",
    email: "contact@scharade.jp",
    instagram: "https://www.instagram.com/SCHARADE_JP",
    x: "https://x.com/SCHARADE_JP",
    updated: "2026年5月",
  },
  home: {
    slogan: "私たちと一緒に\n一生に残る素敵な思い出を\n写真に残しませんか？",
    sloganEnglish: "Shall we create and capture beautiful memories together?",
    activities: [
      {
        title: "Scharade",
        text: "〜活動内容紹介〜",
        image: "/media/site/activity/Photo1.webp",
        url: "",
      },
      {
        title: "定例会",
        text: "月に2回、E212の部室にて定例会を行なっています！定例会ではカメラ講習、ボドゲ大会などを行なっています。",
        image: "/media/site/activity/Photo2.webp",
        url: "",
      },
      {
        title: "撮影会",
        text: "月に２回、東京近辺で撮影会を行なっています！神楽坂撮影会、星空ドライブ撮影会、ディズニー撮影会など。",
        image: "/media/site/activity/Photo3.webp",
        url: "",
      },
      {
        title: "展示",
        text: "年に5回、学生会館や外部のスペースを借りて展示を行なっています！自分の作品を多くの方に見てもらえるので技術の向上になります。",
        image: "/media/site/activity/Photo4.webp",
        url: "",
      },
      {
        title: "夏合宿",
        text: "8月~9月頃に1泊2日か2泊3日の合宿を行います！2025年には石川・富山、2024年には熱海・伊東に行きました。",
        image: "/media/site/activity/Photo5.webp",
        url: "",
      },
      {
        title: "春合宿",
        text: "2月~3月頃に1泊2日か2泊3日の合宿を行います！2025年には宮城・福島、2024年には長野に行きました。",
        image: "/media/site/activity/Photo6.webp",
        url: "",
      },
      {
        title: "新歓",
        text: "4月~5月は新入生歓迎企画を行います！ビラを配ったり食事会をしたりなど、色々な人と話せるいい機会になります。",
        image: "/media/site/activity/Photo7.webp",
        url: "",
      },
      {
        title: "部室",
        text: "学生会館のE224に部室があります！2階にあるためとてもアクセスがよく、過ごしやすい空間になっています。詳しくはAbout usの方へ。",
        image: "/media/site/activity/Photo8.webp",
        url: "",
      },
    ],
    commission: "撮影依頼も承っております。\n御依頼はこちらから。",
    joinTitle:
      "あなたの大学生活を、\nあなたの目線で「写真」に残してみませんか？",
    steps: [
      {
        title: "活動に参加する",
        text: "Instagramなどから新歓企画を確認！\nContact、またはInstagramのDMなどで参加したい旨を教えてください！",
      },
      {
        title: "会費を払う",
        text: "企画参加後に三役に手渡し、または振込で会費をお支払いいただきます。入会費は{{entranceFee}}円、半期{{feeHalfYear}}円です。",
      },
      {
        title: "入会完了",
        text: "これだけで入会できます！\n部室のプリンターやL判写真用紙、暗室など、お好きにご利用いただけます！",
      },
    ],
  },
  about: {
    introduction:
      "写団シャレードは早稲田大学公認の写真サークルです。活動内容は年4〜5回の写真展を中心に都内での撮影会や部員同士の交流である定例会などを行っています。また年に2回の合宿も行っています。現在幅広い個性をもったメンバーが100名以上在籍しており、趣味の合う仲間と親交を深めることができます。\n\n早稲田大学戸山キャンパス学生会館E224に部室があり、暗室とデジタル処理用のソフト及びPCを完備しています。印刷機やスキャナーなどの機材も使用可能です。所有機材、現段階での技術などは問いません。カメラを本格的に学びたい方はもちろん、大学から写真を始めたいという方も大歓迎です。兼部したい方や学外の方の入会も可能です。",
    contactText: "ご興味がありましたら、Contactからお気軽にご連絡ください。",
    annual: [
      {
        month: "4月 / 5月",
        title: "新歓",
        text: "部室開放や食事会、撮影会を行います。参加費無料なので雰囲気を知りたい方や同輩や先輩の友達作りなどに最適です！",
        image: "/media/site/annual_schedule/apr_may.webp",
      },
      {
        month: "6月",
        title: "六月展",
        text: "学生会館の地下にて写真展を行います！新入生にとっては上級生の作品が展示されるのでここで展示方法等を学んでもらえる機会になります！",
        image: "/media/site/annual_schedule/jun.webp",
      },
      {
        month: "7月",
        title: "BBQ",
        text: "新入生同士や上級生との交流の場としてBBQを行います！",
        image: "/media/site/annual_schedule/jul.webp",
      },
      {
        month: "8月",
        title: "夏合宿",
        text: "8月~9月頃に1泊2日か2泊3日の合宿を行います！2025年には石川・富山、2024年には熱海・伊東に行きました！",
        image: "/media/site/annual_schedule/aug.webp",
      },
      {
        month: "9月",
        title: "新人展",
        text: "9月には新人展を行います！新入生の作品のみを展示し、他の学生や一般の人々に紹介する機会になります。",
        image: "/media/site/annual_schedule/sep.webp",
      },
      {
        month: "10月",
        title: "ハロウィン\nパーティ",
        text: "10月といえばハロウィンということでハロウィンパーティーを行います！都内のレンタルスペースを借りて仮装して盛り上がりましょう！",
        image: "/media/site/annual_schedule/oct.webp",
      },
      {
        month: "11月",
        title: "早稲田祭展",
        text: "早稲田大学のイベントといえば早稲田祭！ということで早稲田祭にて展示を行います！部員全員の集大成を見せる場なので普段以上にクオリティがある写真が集まる展示です！",
        image: "/media/site/annual_schedule/nov.webp",
      },
      {
        month: "12月",
        title: "忘年会",
        text: "1年の振り返りをしながら来年の目標を立てましょう!",
        image: "/media/site/annual_schedule/dec.webp",
      },
      {
        month: "1月",
        title: "新年会",
        text: "年越しの挨拶と共にこれからの1年を過ごす仲間と新年を祝いましょう！",
        image: "/media/site/annual_schedule/jan.webp",
      },
      {
        month: "2月",
        title: "卒業制作展\n二月展",
        text: "卒業制作展では今年卒業する部員たちの最後の展示をします。学生生活の集大成が見られます!\n二月展ではテーマ展を行うなど普段の展示とは少し変えた展示などを行なっています！",
        image: "/media/site/annual_schedule/feb.webp",
      },
      {
        month: "3月",
        title: "春合宿",
        text: "2月~3月頃に1泊2日か2泊3日の合宿を行います！2025年には宮城・福島、2024年には長野に行きました！",
        image: "/media/site/annual_schedule/mar.webp",
      },
    ],
    equipment: [
      {
        title: "暗室",
        text: "暗室ではカラーフィルムとモノクロフィルムの現像、プリントが可能です。 暗室作業は、慣れるまで先輩がついて指導します。また、スピーカーが設置してあるので好きな音楽を聴きながら快適に楽しく暗室作業ができます。",
        photos: [
          {
            image: "/media/site/equipments/darkroom1.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/darkroom2.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/darkroom3.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/darkroom4.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/darkroom5.webp",
            alt: "",
          },
        ],
      },
      {
        title: "Desktop PC\n&スピーカー",
        text: "高解像度の画像編集や動画編集が可能なデスクトップPCです。モニターは適切な色が再現されるものを使用しています！また、lightroomやPhotoshopなどのソフトウェアが無料で利用可能です。\nスピーカーとアンプも完備しており、音質の高い音楽を楽しむことができます。",
        photos: [
          {
            image: "/media/site/equipments/desktopPc1.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/desktopPc2.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/desktopPc3.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/desktopPc4.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/desktopPc5.webp",
            alt: "",
          },
        ],
      },
      {
        title: "4K対応 TV",
        text: "Google TVに対応しているのでNetflixやYouTubeなど様々なストリーミングサービスが利用できます。また、Wiiがあるのでゲームを楽しむこともできます。",
        photos: [
          {
            image: "/media/site/equipments/4kTv1.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/4kTv2.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/4kTv3.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/4kTv4.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/4kTv5.webp",
            alt: "",
          },
        ],
      },
      {
        title: "プリンター\n&スキャナー",
        text: "最大A2サイズまで高品質な写真プリントが可能なプリンターです。また、フィルムスキャナーも完備しており、お店で1000円程度かかるフィルムのデジタル化も可能です。",
        photos: [
          {
            image: "/media/site/equipments/printing1.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/printing2.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/printing3.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/printing4.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/printing5.webp",
            alt: "",
          },
        ],
      },
      {
        title: "その他",
        text: "コーヒーミルや電子レンジ、冷蔵庫、スピーカー、Wii、ボードゲームなど部室を快適に過ごすことができる設備が整っています！",
        photos: [
          {
            image: "/media/site/equipments/other1.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/other2.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/other3.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/other4.webp",
            alt: "",
          },
          {
            image: "/media/site/equipments/other5.webp",
            alt: "",
          },
        ],
      },
    ],
    faqs: [
      {
        question: "写真の経験がなくても大丈夫ですか？",
        answer:
          "はい、全く問題ありません！\n部員はカメラ：フィルム：スマホ = 5：2：3の割合で、初心者の方でも安心して参加できます！\n写真を楽しむ気持ちがあれば大歓迎です！",
      },
      {
        question:
          "カメラを買いたいと思っているのですが、何を買ったらよいのかわかりません。",
        answer:
          "部室にきていただけたら部員が購入の相談にのります。また、日程をあわせて一緒にカメラ屋に出かけ、購入の際にアドバイスすることもあります。\n部員の半分ほどが一眼デジタルカメラを、残りの半分がフィルムカメラやコンパクトデジタルカメラ、スマートフォンなどで撮影しています。",
      },
      {
        question: "活動費用はどのくらいかかりますか？",
        answer:
          "部費は半期で{{feeHalfYear}}円（年間{{feeAnnual}}円）です。その他、撮影会や展示会などのイベントに参加する際には、別途費用がかかる場合があります。",
      },
      {
        question: "兼部・兼サークルは可能ですか？",
        answer:
          "はい、兼部・兼サークル可能です！部員の約7割が学業や他のサークル活動と両立しながら、写真を楽しでいます！",
      },
      {
        question: "インカレの割合はどのくらいですか？",
        answer:
          "早稲田：インカレ = 4：1の割合で、インカレの割には早稲田の部員が多いサークルになります。\nもちろんそこで分けることはなく、インカレのメンバーも多数参加しています！",
      },
      {
        question: "活動頻度はどのくらいですか？",
        answer:
          "月2回の定例会と、月2回の撮影会で合計月に4回活動をしています！\nまた、それに加えて季節ごとの合宿などがあります。\n出席義務など特にないので、参加したいタイミングで参加しやすいのが特徴です！",
      },
    ],
  },
  gallery: {
    introduction:
      "サークルの普段の活動を各イベントごとにアルバムで分類しています。",
  },
  portfolio: {
    introduction: "サークル員のポートフォリオになります。ぜひご鑑賞ください。",
  },
  contact: {
    introduction:
      "写団 シャレードに興味を持っていただきありがとうございます。\n\n入会希望や見学、撮影の依頼などお問い合わせは、下記のメールフォームからご気軽にお問い合わせください。\n後日、ご連絡させて頂きます。",
  },
  disclaimer: {
    sections: [
      {
        title: "プライバシーポリシー",
        text: "個人情報の利用\n\n当ブログでは、お問い合わせや記事へのコメントの際、名前やメールアドレス等の個人情報を入力していただく場合がございます。\n\n取得した個人情報は、お問い合わせに対する回答や必要な情報を電子メールでご連絡する場合に利用させていただくものであり、これらの目的以外では利用しません。\n\nアクセス解析ツールについて\n\n当ブログでは、Googleによるアクセス解析ツール「Googleアナリティクス」を利用しています。このGoogleアナリティクスはトラフィックデータの収集のためにクッキー（Cookie）を使用しております。トラフィックデータは匿名で収集されており、個人を特定するものではありません。\n\nコメントについて\n\n当ブログへのコメントを残す際に、IP アドレスを収集しています。\n\nこれはブログの標準機能としてサポートされている機能で、スパムや荒らしへの対応以外にこのIPアドレスを使用することはありません。なお、全てのコメントは管理人が事前にその内容を確認し、承認した上での掲載となります。あらかじめご了承ください。",
      },
      {
        title: "免責事項",
        text: "当ブログからのリンクやバナーなどで移動したサイトで提供される情報、サービス等について一切の責任を負いません。\n\nまた当ブログのコンテンツ・情報について、できる限り正確な情報を提供するように努めておりますが、正確性や安全性を保証するものではありません。情報が古くなっていることもございます。\n\n当サイトに掲載された内容によって生じた損害等の一切の責任を負いかねますのでご了承ください。",
      },
      {
        title: "著作権について",
        text: "当ブログで掲載している文章や画像などにつきましては、無断転載することを禁止します。\n\n当ブログは著作権や肖像権の侵害を目的としたものではありません。著作権や肖像権に関して問題がございましたら、Contactよりご連絡ください。迅速に対応いたします。",
      },
      {
        title: "リンクについて",
        text: "当ブログは基本的にリンクフリーです。リンクを行う場合の許可や連絡は不要です。\n\nただし、インラインフレームの使用や画像の直リンクはご遠慮ください。",
      },
    ],
  },
};
export type PageKey = keyof typeof siteDefaults;
export type SiteDefaults = typeof siteDefaults;
