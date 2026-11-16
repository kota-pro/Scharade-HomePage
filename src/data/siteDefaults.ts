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
    excludedPhotoIds: [] as string[],
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
        text: "本サイトは、早稲田大学公認の写真サークル「写団シャレード」が運営する公式サイトです。活動の紹介、写真作品の公開、お問い合わせへの対応、会員向け機能の提供にあたり、以下の方針で個人情報を取り扱います。\n\n個人情報の取得と利用\n\nお問い合わせフォームで入力された氏名・フリガナ・所属・学年・メールアドレス・お問い合わせ内容は、ご質問への回答、入会・見学や撮影依頼への対応、そのために必要な連絡に利用します。\n\n会員登録時のアカウント名・メールアドレス・認証情報は、本人確認、ログイン、登録の承認、会員管理に利用します。活動への参加回答、班分けに必要なプロフィール、写真展の提出内容・写真、立替申請の情報は、それぞれの活動の運営と手続きに利用します。\n\n写真・プロフィールの公開範囲\n\nPortfolioに掲載する表示名・プロフィール・作品・SNSリンクや、公開設定のGallery・活動記事に掲載する写真などは、会員以外の方も閲覧できます。公開する内容には、ご自身や写真に写る方の個人情報が含まれていないかご確認ください。\n\n登録用のメールアドレスや認証情報を、公開プロフィールとして掲載することはありません。会員向け・運営向けの情報は、機能ごとの権限に応じて閲覧を制限します。\n\n外部サービスと情報の管理\n\n記事・Portfolioの管理や写真の保存・表示にmicroCMS、Adobe Lightroomを、写真展などの運営にGoogleのフォーム・スプレッドシート・Drive等を利用します。各サービスには、機能の提供に必要な情報を送信・保存します。\n\n個人情報は、利用目的に必要な範囲で取り扱い、アクセス権限の管理などにより適切な管理に努めます。上記のサービス利用に伴う取扱いの委託や法令に基づく場合などを除き、ご本人の同意なく第三者に提供しません。\n\nCookie・アクセス情報\n\nログイン状態の維持や認証のためにCookieを使用します。ブラウザーの設定でCookieを無効にすると、会員向け機能の一部を利用できない場合があります。アクセス時のIPアドレス等は、不正アクセスの防止や障害対応のために取り扱う場合があります。\n\n個人情報に関するお問い合わせ\n\n個人情報の確認・訂正・削除や、掲載された写真・プロフィールについてのご相談は、Contactからご連絡ください。アカウントと関連データの削除は、アカウント削除の申請ページでも受け付けています。アプリの通知や端末情報の取扱いは、アプリのプライバシーポリシーをご確認ください。",
      },
      {
        title: "免責事項",
        text: "本サイトでは、活動内容、写真展の日程、入会案内などについて、正確な情報の掲載に努めています。ただし、掲載内容の正確性・完全性・最新性を保証するものではありません。日程や参加条件は変更される場合がありますので、最新のお知らせや運営からの案内をご確認ください。\n\n本サイトからリンクする外部サイトやSNSの情報・サービスは、それぞれの運営者が管理しています。ご利用にあたっては、リンク先の利用条件やプライバシーポリシーをご確認ください。\n\n本サイトの内容は、予告なく変更・削除する場合があります。また、保守や通信障害、外部サービスの状況などにより、閲覧や会員向け機能の提供を一時的に中断する場合があります。\n\n本サイトの利用や掲載情報に基づく行動によって生じた損害について、写団シャレードは法令上認められる範囲で責任を負いかねます。",
      },
      {
        title: "著作権・肖像権について",
        text: "本サイトに掲載する写真・文章・ロゴ等の著作権は、撮影者・執筆者その他の正当な権利者に帰属します。GalleryやPortfolioで作品を公開していることは、その作品の自由な利用を許可するものではありません。\n\n私的使用や引用など、法令で認められる場合を除き、権利者の許可なく転載・複製・加工・配布・販売等を行うことはできません。作品の利用を希望される場合は、Contactからお問い合わせください。\n\n写真や記事を掲載する会員は、被写体の方のプライバシー・肖像権や、写り込む作品等の権利に配慮し、必要な確認・許可を得てください。\n\n掲載内容について著作権・肖像権・プライバシー上の問題がある場合は、該当ページのURLと対象の写真・文章、ご相談内容をContactからお知らせください。内容を確認のうえ、修正や掲載の取り下げ等に対応します。",
      },
      {
        title: "リンクについて",
        text: "本サイトの公開ページへのリンクや、ページURLを用いたSNSでの紹介は、原則として事前の連絡なく行っていただけます。写団シャレードの公式サイトや、各会員の作品ページへのリンクであることが分かる形でご紹介ください。\n\n本サイトを別のサイトの一部に見せるフレーム内での表示や、画像ファイルへの直接リンクによる埋め込みはご遠慮ください。写真を転載して紹介する場合は、法令で認められる場合を除き、権利者の許可が必要です。\n\nページのURLや公開範囲は、予告なく変更する場合があります。会員限定ページや個人情報を含むURLの公開・共有はお控えください。",
      },
    ],
  },
};
export type PageKey = keyof typeof siteDefaults;
export type SiteDefaults = typeof siteDefaults;
