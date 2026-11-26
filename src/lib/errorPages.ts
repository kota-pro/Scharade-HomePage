type ErrorPage = {
  title: string;
  lines: string[];
  artworkSize?: [width: number, height: number];
  action?: "search" | "account";
  contact?: string;
};

const recurringError = "繰り返し表示されてしまう場合は、";

export const errorPages = {
  400: {
    title: "リクエストを読み取れません",
    lines: ["リクエストの内容を読み取れませんでした。", "URLや入力内容をご確認のうえ、もう一度お試しください。"],
    action: "search",
  },
  401: {
    title: "ログインが必要です",
    lines: ["このページを開くにはログインが必要です。ログインしてから、もう一度お試しください。"],
    action: "account",
  },
  403: {
    title: "アクセス権限がありません",
    lines: ["このページを開く権限がありません。ログイン中のアカウントをご確認ください。"],
    action: "account",
  },
  404: {
    title: "ページが見つかりません",
    lines: [
      "申し訳ございません。お探しのページは未実装か、削除されているか、URLが変更されている可能性があります。",
      "URLをご確認の上もう一度お試しいただくか、以下からお目当てのページをお探しください。",
    ],
    action: "search",
  },
  408: {
    title: "リクエストがタイムアウトしました",
    lines: ["リクエストの受付に時間がかかり、処理を続けられませんでした。", "通信環境をご確認のうえ、もう一度お試しください。"],
    artworkSize: [1046, 541],
    action: "search",
  },
  429: {
    title: "アクセスや操作が集中しています",
    lines: ["短時間に多くのアクセスや操作がありました。", "しばらく待ってから、もう一度お試しください。"],
    artworkSize: [1064, 541],
  },
  500: {
    title: "サイト内部でエラーが発生しました",
    lines: ["サイト内部で予期しないエラーが発生しました。時間をおいてから、もう一度ページを開いてください。"],
    contact: recurringError,
  },
  502: {
    title: "接続先との通信に問題が発生しました",
    lines: ["接続先との通信に問題が発生しました。時間をおいてから、もう一度ページを開いてください。"],
    artworkSize: [980, 611],
    contact: recurringError,
  },
  503: {
    title: "メンテナンス中",
    lines: ["申し訳ございません。只今メンテナンス中です。もうしばらくお待ちください。"],
    contact: "お急ぎの場合は、",
  },
  504: {
    title: "接続先の応答がタイムアウトしました",
    lines: ["接続先からの応答に時間がかかっています。しばらく待ってから、もう一度ページを開いてください。"],
    artworkSize: [1148, 556],
    contact: recurringError,
    action: "search",
  },
} satisfies Record<number, ErrorPage>;

export type ErrorPageStatus = keyof typeof errorPages;

export function hasErrorPage(status: number): status is ErrorPageStatus {
  return Object.hasOwn(errorPages, status);
}

export function getErrorPage(status: ErrorPageStatus): ErrorPage {
  return errorPages[status];
}
