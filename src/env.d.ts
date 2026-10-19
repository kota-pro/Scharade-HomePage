/// <reference types="astro/client" />
declare namespace App {
  interface Locals {
    user: import("./lib/auth").User | null;
    preview: boolean;
    appShell: boolean;
  }
}
