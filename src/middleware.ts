import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url;

  if (pathname === "/Portfolio" || pathname.startsWith("/Portfolio/")) {
    return context.redirect(`${pathname.toLowerCase()}${search}`, 301);
  }

  return next();
});
