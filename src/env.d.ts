/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    user: import("./lib/auth").User | null;
    session: import("./lib/auth").Session | null;
    actor: import("./lib/auth").User | null;
    adminView: import("./lib/adminViewState").AdminView | null;
    preview: boolean;
    appShell: boolean;
  }
}
