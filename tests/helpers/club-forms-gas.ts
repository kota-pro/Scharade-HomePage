import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";

/** In-memory Google services; runs the real gateway source without external writes or network. */
export function clubGasHarness() {
  const props: Record<string, string> = {
    WEBHOOK_SECRET: "fixture-club-secret-at-least-32-characters",
  };
  const files = new Map<string, any>(),
    forms = new Map<string, any>(),
    books = new Map<string, any>(),
    folders = new Map<string, any>();
  let sequence = 0,
    now = Date.now(),
    owner = "contact@scharade.jp",
    copyCrash = false,
    sheetCrash = false,
    trashCrash = false;
  const triggers: any[] = [];
  const nextId = (prefix: string) =>
    prefix + "_" + String(++sequence).padStart(25, "0");
  const iterator = (values: any[]) => {
    const copy = [...values];
    return { hasNext: () => copy.length > 0, next: () => copy.shift() };
  };
  function folder(name: string, parent?: string, id = nextId("folder")): any {
    const entry: any = {
      id,
      name,
      parent,
      getId: () => id,
      getUrl: () => `https://drive.google.com/drive/folders/${id}`,
      getFoldersByName: (name: string) =>
        iterator(
          [...folders.values()].filter(
            (entry) => entry.name === name && entry.parent === id,
          ),
        ),
      createFolder: (name: string) => folder(name, id),
    };
    folders.set(id, entry);
    files.set(id, {
      id,
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parent ? [parent] : [],
      capabilities: { canAddChildren: true },
    });
    return entry;
  }
  folder("幹部共有資料", undefined, "1iJ_g3gkRoGoIb1AigDBvoPOuRivX6pWl");
  function sheet(
    name: string,
    rows: any[][] = [],
    formId?: string,
    id = ++sequence,
  ): any {
    const result: any = {
      name,
      rows,
      id,
      formId,
      maxRows: 1000,
      maxColumns: 26,
      getSheetId: () => id,
      getName: () => name,
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map((row) => row.length)),
      getFormUrl: () =>
        formId ? `https://docs.google.com/forms/d/${formId}/edit` : null,
      getMaxRows: () => result.maxRows,
      getMaxColumns: () => result.maxColumns,
      insertRowsAfter: (_: number, count: number) => {
        result.maxRows += count;
      },
      insertColumnsAfter: (_: number, count: number) => {
        result.maxColumns += count;
      },
      setFrozenRows() {},
      getRange: (start: number, column: number, count = 1, width = 1) => {
        const range: any = {
          getValues: () =>
            Array.from({ length: count }, (_, i) =>
              Array.from(
                { length: width },
                (_, j) => rows[start - 1 + i]?.[column - 1 + j] ?? "",
              ),
            ),
          getDisplayValues: () =>
            range
              .getValues()
              .map((row: any[]) => row.map((value) => String(value ?? ""))),
          clearContent: () => {
            for (let i = 0; i < count; i++)
              if (rows[start - 1 + i])
                for (let j = 0; j < width; j++)
                  rows[start - 1 + i][column - 1 + j] = "";
            return range;
          },
          setNumberFormat: () => range,
          setNote: (value: string) => {
            result.note = value;
            return range;
          },
          setValues: (values: any[][]) => {
            values.forEach((row, i) => {
              rows[start - 1 + i] ??= [];
              row.forEach(
                (value, j) => (rows[start - 1 + i][column - 1 + j] = value),
              );
            });
            return range;
          },
        };
        return range;
      },
    };
    return result;
  }
  function book(id: string, name: string, sheets: any[] = []): any {
    const entry: any = {
      id,
      name,
      sheets,
      timeZone: "Etc/GMT",
      locale: "en_US",
      setSpreadsheetTimeZone: (value: string) => {
        entry.timeZone = value;
      },
      setSpreadsheetLocale: (value: string) => {
        entry.locale = value;
      },
      getId: () => id,
      getName: () => name,
      getUrl: () => `https://docs.google.com/spreadsheets/d/${id}/edit`,
      getSheets: () => sheets,
      getSheetByName: (name: string) =>
        sheets.find((sheet) => sheet.name === name),
      insertSheet: (name: string) => {
        const entry = sheet(name);
        sheets.push(entry);
        return entry;
      },
    };
    books.set(id, entry);
    return entry;
  }
  function item(title: string, type = "TEXT", help = ""): any {
    const entry: any = {
      title,
      type,
      help,
      required: true,
      choices: ["はい", "いいえ"],
      getTitle: () => entry.title,
      setTitle: (value: string) => {
        entry.title = value;
        return entry;
      },
      getType: () => type,
      getHelpText: () => entry.help,
      setHelpText: (value: string) => {
        entry.help = value;
        return entry;
      },
      asTextItem: () => entry,
      asParagraphTextItem: () => entry,
      asMultipleChoiceItem: () => entry,
    };
    return entry;
  }
  function form(
    id: string,
    name: string,
    description: string,
    items: any[],
  ): any {
    const entry: any = {
      id,
      name,
      description,
      items,
      published: true,
      accepting: true,
      destination: "",
      responseCount: 0,
      getResponses: () =>
        Array.from({ length: entry.responseCount }, () => ({})),
      getId: () => id,
      getItems: () => items,
      getDescription: () => entry.description,
      setTitle: (value: string) => {
        entry.name = value;
        return entry;
      },
      setDescription: (value: string) => {
        entry.description = value;
        return entry;
      },
      supportsAdvancedResponderPermissions: () => true,
      setPublished: (value: boolean) => {
        entry.published = value;
        entry.accepting = value;
        return entry;
      },
      isPublished: () => entry.published,
      setAcceptingResponses: (value: boolean) => {
        if (value && !entry.published) throw new Error("unpublished");
        entry.accepting = value;
        return entry;
      },
      isAcceptingResponses: () => entry.accepting,
      getDestinationId: () => {
        if (!entry.destination) throw new Error("no destination");
        return entry.destination;
      },
      setDestination: (_: unknown, spreadsheetId: string) => {
        entry.destination = spreadsheetId;
        const target = books.get(spreadsheetId);
        if (target.timeZone !== "Asia/Tokyo" || target.locale !== "ja_JP")
          throw new Error(
            "response spreadsheet must be initialized before connecting the form",
          );
        target.timeZone = "America/Los_Angeles";
        if (!target) throw new Error("missing sheet");
        if (!target.sheets.some((sheet: any) => sheet.formId === id))
          target.sheets.push(
            sheet(
              "フォームの回答 1",
              [["タイムスタンプ", ...items.map((item) => item.title)]],
              id,
            ),
          );
      },
      getEditUrl: () => `https://docs.google.com/forms/d/${id}/edit`,
      getPublishedUrl: () =>
        `https://docs.google.com/forms/d/e/published_${id}/viewform`,
    };
    forms.set(id, entry);
    return entry;
  }
  const source = fs.readFileSync("gas/club-forms/Code.gs", "utf8");
  const DateClass = class extends Date {
    constructor(value?: any) {
      super(value ?? now);
    }
    static now() {
      return now;
    }
  };
  const ctx: any = {
    Date: DateClass,
    console: { log() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => props[key],
        setProperty: (key: string, value: string) => {
          props[key] = value;
        },
        deleteProperty: (key: string) => {
          delete props[key];
        },
        getProperties: () => ({ ...props }),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {},
        releaseLock() {},
        hasLock: () => true,
      }),
    },
    ContentService: {
      MimeType: { JSON: "JSON" },
      createTextOutput: (value: string) => ({
        setMimeType: () => JSON.parse(value),
      }),
    },
    ScriptApp: {
      getOAuthToken: () => "fixture-oauth-token",
      getProjectTriggers: () => triggers,
      deleteTrigger: (trigger: any) => {
        const index = triggers.indexOf(trigger);
        if (index >= 0) triggers.splice(index, 1);
      },
      newTrigger: (name: string) => ({
        forForm: (form: any) => ({
          onFormSubmit: () => ({
            create: () => {
              if (triggers.length >= 20) throw new Error("trigger quota");
              triggers.push({
                getHandlerFunction: () => name,
                getTriggerSourceId: () => form.getId(),
              });
            },
          }),
        }),
        timeBased: () => ({
          everyMinutes: (minutes: number) => ({
            create: () => {
              assertMinute(minutes);
              triggers.push({ getHandlerFunction: () => name });
            },
          }),
        }),
      }),
    },
    UrlFetchApp: {
      fetch: (url: string) => {
        const match = url.match(
          /^https:\/\/forms\.googleapis\.com\/v1\/forms\/([A-Za-z0-9_-]+)$/,
        );
        if (!match || !forms.has(match[1]))
          throw new Error("unexpected API destination");
        const form = forms.get(match[1]);
        return {
          getResponseCode: () => (form.uploadCheckFailed ? 503 : 200),
          getContentText: () =>
            JSON.stringify({
              items: form.items
                .filter((item: any) => item.type === "FILE_UPLOAD")
                .map(() => ({
                  questionItem: {
                    question: {
                      fileUploadQuestion: {
                        folderId:
                          form.uploadReady === false
                            ? ""
                            : "1iJ_g3gkRoGoIb1AigDBvoPOuRivX6pWl",
                      },
                    },
                  },
                })),
            }),
        };
      },
    },
    Utilities: {
      Charset: { UTF_8: "utf8" },
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_: any, value: string) => [
        ...crypto.createHash("sha256").update(value).digest(),
      ],
      computeHmacSha256Signature: (value: string, secret: string) => [
        ...crypto.createHmac("sha256", secret).update(value).digest(),
      ],
      formatDate: (value: Date, zone: string, format: string) => {
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat("ja-JP", {
            timeZone: zone,
            year: "numeric",
            month: "numeric",
            day: "numeric",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          })
            .formatToParts(value)
            .map((part) => [part.type, part.value]),
        );
        return format
          .replace("yyyy", parts.year)
          .replace("MM", parts.month.padStart(2, "0"))
          .replace("dd", parts.day.padStart(2, "0"))
          .replace("M", parts.month)
          .replace("d", parts.day)
          .replace("E", parts.weekday)
          .replace("HH", parts.hour)
          .replace("mm", parts.minute);
      },
    },
    Drive: {
      About: { get: () => ({ user: { emailAddress: owner } }) },
      Files: {
        get: (id: string) => {
          const entry = files.get(id);
          if (!entry) throw new Error("missing file");
          return entry;
        },
        list: ({ q }: { q: string }) => {
          const parent = q.match(/'([^']+)' in parents/)?.[1],
            key = q.match(/value='([^']+)'/)?.[1],
            mime = q.match(/mimeType = '([^']+)'/)?.[1];
          return {
            files: [...files.values()]
              .filter(
                (file) =>
                  (!q.includes("trashed = false") || !file.trashed) &&
                  (!parent || file.parents?.includes(parent)) &&
                  file.appProperties?.clubFormsKey === key &&
                  file.mimeType === mime,
              )
              .map((file) => ({ id: file.id })),
          };
        },
        copy: (metadata: any, sourceId: string) => {
          const original = forms.get(sourceId);
          if (!original) throw new Error("missing template");
          const id = nextId("form");
          files.set(id, {
            ...structuredClone(metadata),
            id,
            capabilities: { canTrash: true },
          });
          const copy = form(
            id,
            original.name,
            original.description,
            original.items.map((original: any) =>
              item(original.title, original.type, original.help),
            ),
          );
          copy.destination = original.destination;
          if (copyCrash) {
            copyCrash = false;
            throw new Error("lost copy response");
          }
          return { id };
        },
        create: (metadata: any) => {
          const id = nextId("sheet");
          files.set(id, {
            ...structuredClone(metadata),
            id,
            capabilities: { canTrash: true },
          });
          book(id, metadata.name);
          if (sheetCrash) {
            sheetCrash = false;
            throw new Error("lost sheet response");
          }
          return { id };
        },
        update: (metadata: any, id: string) => {
          Object.assign(files.get(id), metadata);
          if (books.has(id) && metadata.name !== undefined)
            books.get(id).name = metadata.name;
          if (metadata.trashed && trashCrash) {
            trashCrash = false;
            throw new Error("lost trash response");
          }
          return { id };
        },
      },
    },
    DriveApp: {
      getFolderById: (id: string) => {
        const entry = folders.get(id);
        if (!entry) throw new Error("missing folder");
        return entry;
      },
    },
    SpreadsheetApp: {
      openById: (id: string) => {
        const entry = books.get(id);
        if (!entry) throw new Error("missing spreadsheet");
        return entry;
      },
      flush() {},
    },
    FormApp: {
      DestinationType: { SPREADSHEET: "SPREADSHEET" },
      openById: (id: string) => {
        const entry = forms.get(id);
        if (!entry) throw new Error("missing form");
        return entry;
      },
      openByUrl: (url: string) => {
        const id = url.match(/\/forms\/d\/([^/]+)\//)?.[1];
        const entry = forms.get(id!);
        if (!entry) throw new Error("missing form");
        return entry;
      },
    },
  };
  function assertMinute(value: number) {
    if (value !== 1) throw new Error("expected one minute trigger");
  }
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  for (const [kind, id] of Object.entries(ctx.CLUB_TEMPLATES_) as [
    string,
    string,
  ][]) {
    const description =
      kind === "admission"
        ? "入会確認です。こちらのフォームを提出＋会費(4000円)を支払うことで正式な会員となります。\n振込先の案内は保持します。"
        : kind.startsWith("continuation")
          ? "来期(4月~)の継続意思を確認します。期限は3/8(日)までです。"
          : "新歓参加フォームです。\n日付：2026/4/7 (火)\n時間：15:00-18:00\n場所：新宿御苑\n参加費：無料\n持ち物：カメラ\n※当申請フォームの提出期限は4/5(日)です！";
    const items = [
      item("名前"),
      item("大学名"),
      item(
        "春からの学年",
        "MULTIPLE_CHOICE",
        "春からの学年を選択してください。",
      ),
      item("LINEのQRコード", "FILE_UPLOAD"),
    ];
    if (kind.startsWith("continuation"))
      items.push(item("継続しますか？", "MULTIPLE_CHOICE"));
    if (kind === "continuation_autumn")
      items.push(item("会計星山に連絡してください", "FILE_UPLOAD"));
    form(id, kind, description, items);
    files.set(id, {
      id,
      name: kind,
      mimeType: "application/vnd.google-apps.form",
      parents: [],
      original: true,
    });
  }
  ctx.initializeClubForms();
  const signed = (
    payload: any,
    valid = true,
    timestamp = String(now),
    nonce = crypto.randomBytes(16).toString("hex"),
  ) => {
    const text = JSON.stringify(payload),
      signature = crypto
        .createHmac("sha256", props.WEBHOOK_SECRET)
        .update(`v2\n${timestamp}\n${nonce}\n${text}`)
        .digest("hex");
    return {
      postData: {
        contents: JSON.stringify({
          version: 2,
          timestamp,
          nonce,
          payload: text,
          signature: valid ? signature : "0".repeat(64),
        }),
      },
    };
  };
  return {
    ctx,
    props,
    files,
    forms,
    books,
    folders,
    triggers,
    signed,
    send: (payload: any, valid = true) => ctx.doPost(signed(payload, valid)),
    setNow: (value: number) => {
      now = value;
    },
    setOwner: (value: string) => {
      owner = value;
    },
    crashCopy: () => {
      copyCrash = true;
    },
    crashSheet: () => {
      sheetCrash = true;
    },
    crashTrash: () => {
      trashCrash = true;
    },
    addSource: (id: string, gid: number, headers: string[], rows: any[][]) => {
      const entry = sheet(
        "回答",
        [[...headers], ...rows.map((row) => [...row])],
        undefined,
        gid,
      );
      book(id, "名簿回答", [entry]);
      return entry;
    },
    counts: () => ({
      forms: [...files.values()].filter(
        (file) =>
          !file.original &&
          file.mimeType === "application/vnd.google-apps.form",
      ).length,
      sheets: [...files.values()].filter(
        (file) => file.mimeType === "application/vnd.google-apps.spreadsheet",
      ).length,
      folders: folders.size,
    }),
  };
}
