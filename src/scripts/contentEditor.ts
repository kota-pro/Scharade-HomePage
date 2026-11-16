import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { operationNotice } from "./siteNotice";
import { homePhotoPicker } from "./homePhotoPicker";
export {};
type Data = Record<string, any>;
const root = document.querySelector<HTMLFormElement>("#content-editor");
const initial = document.querySelector("#editor-initial");
if (root && initial?.textContent) {
  const bootstrap = JSON.parse(initial.textContent);
  let current = bootstrap.document;
  let data: Data = structuredClone(current.draft);
  let dirty = false;
  let busy = false;
  const fields = document.querySelector<HTMLElement>("#editor-fields")!;
  const status = document.querySelector<HTMLElement>("#editor-status")!;
  const toc = document.querySelector<HTMLElement>("#editor-toc");
  const tocList = document.querySelector<HTMLUListElement>("#editor-toc-list");
  const labels: Record<string, string> = {
    excludedPhotoIds: "メイン写真・フィルム写真の除外設定",
    name: "サークル名",
    affiliation: "所属・公認表記",
    founded: "設立",
    members: "会員数",
    composition: "構成",
    memberRatio: "会員の比率",
    feeHalfYear: "半期会費（円）",
    feeAnnual: "年間会費（円）",
    entranceFee: "入会費（円）",
    address: "所在地",
    mapUrl: "地図リンク",
    email: "連絡先メールの表示",
    instagram: "Instagram URL",
    x: "X URL",
    updated: "情報の基準日",
    slogan: "キャッチコピー",
    sloganEnglish: "英語のコピー",
    activities: "活動紹介カード",
    commission: "撮影依頼の案内",
    joinTitle: "入会案内の見出し",
    steps: "入会手順",
    introduction: "紹介文",
    contactText: "問い合わせ案内",
    annual: "年間予定",
    month: "月の表示",
    title: "見出し",
    text: "本文",
    image: "写真",
    url: "リンク先",
    equipment: "設備紹介",
    photos: "写真一覧",
    alt: "写真の説明",
    faqs: "よくある質問",
    question: "質問",
    answer: "回答",
    sections: "本文セクション",
  };
  const notify = (message: string, error = false) => {
    operationNotice(message,error,"content-editor");
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const changed = () => {
    dirty = true;
    renderToc();
  };
  const sectionId = (key: string) => `editor-section-${key}`;
  function markTarget(element: HTMLElement, targetId: string) {
    element.id = targetId;
    element.classList.add("admin-editor-target");
    element.tabIndex = -1;
  }
  function tocLink(targetId: string, label: string) {
    const link = document.createElement("a");
    link.href = `#${targetId}`;
    link.textContent = label;
    return link;
  }
  function renderToc() {
    if (!toc || !tocList) return;
    // Keep expanded lists open while editing titles, sorting or saving a draft.
    const expanded = new Set(
      Array.from(tocList.querySelectorAll<HTMLDetailsElement>("details[open]"))
        .map((details) => details.dataset.section),
    );
    const entries = document.createDocumentFragment();
    for (const [key, sample] of Object.entries(bootstrap.defaults)) {
      const entry = document.createElement("li");
      entry.append(tocLink(sectionId(key), labels[key] ?? key));
      if (key !== "excludedPhotoIds" && Array.isArray(sample) && Array.isArray(data[key]) && data[key].length) {
        const details = document.createElement("details");
        details.dataset.section = key;
        details.open = expanded.has(key);
        const summary = document.createElement("summary");
        summary.textContent = `各項目（${data[key].length}件）`;
        const children = document.createElement("ul");
        data[key].forEach((item: Data, index: number) => {
          const child = document.createElement("li");
          const title = [item.month, item.title || item.question]
            .filter((value) => typeof value === "string" && value.trim())
            .join(" / ").replace(/\s+/g, " ").trim();
          const caption = title.length > 80 ? `${title.slice(0, 80)}…` : title;
          child.append(tocLink(
            `${sectionId(key)}-${index + 1}`,
            `${index + 1}. ${caption || labels[key] || key}`,
          ));
          children.append(child);
        });
        details.append(summary, children);
        entry.append(details);
      }
      entries.append(entry);
    }
    const actions = document.createElement("li");
    actions.append(tocLink("editor-actions", "保存・プレビュー・公開"));
    entries.append(actions);
    tocList.replaceChildren(entries);
    toc.hidden = false;
  }
  let id = 0;
  const photoPicker = bootstrap.key === "home" ? homePhotoPicker({
    read: () => data.excludedPhotoIds ?? [],
    change: ids => { data.excludedPhotoIds = ids; changed(); notify("除外設定を編集画面に反映しました。保存・公開するとトップページに反映されます。"); },
    busy: () => busy,
  }) : null;
  function empty(template: any): any {
    if (Array.isArray(template)) return [];
    if (template && typeof template === "object")
      return Object.fromEntries(
        Object.entries(template).map(([k, v]) => [k, empty(v)]),
      );
    return typeof template === "number" ? 0 : "";
  }
  function button(label: string, action: () => void) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.addEventListener("click", action);
    return element;
  }
  function renderObject(template: Data, value: Data, container: HTMLElement) {
    const isTopLevel = container === fields;
    for (const [key, sample] of Object.entries(template)) {
      if (isTopLevel && key === "excludedPhotoIds" && photoPicker) {
        const section = photoPicker.field(); markTarget(section, sectionId(key)); container.append(section); continue;
      }
      if (Array.isArray(sample)) {
        const group = document.createElement("fieldset");
        group.className = "admin-list";
        if (isTopLevel) markTarget(group, sectionId(key));
        const legend = document.createElement("legend");
        legend.textContent = labels[key] ?? key;
        group.append(legend);
        const items = document.createElement("div");
        group.append(items);
        const array = value[key] as Data[];
        const renderItems = () => {
          items.replaceChildren();
          array.forEach((item, index) => {
            const box = document.createElement("div");
            box.className = "admin-list-item";
            if (isTopLevel) markTarget(box, `${sectionId(key)}-${index + 1}`);
            const heading = document.createElement("h3");
            heading.textContent = `${labels[key] ?? key} ${index + 1}`;
            box.append(heading);
            renderObject(sample[0], item, box);
            const actions = document.createElement("div");
            actions.className = "admin-item-actions";
            const up = button("上へ", () => {
              [array[index - 1], array[index]] = [
                array[index],
                array[index - 1],
              ];
              changed();
              renderItems();
            });
            up.disabled = index === 0;
            const down = button("下へ", () => {
              [array[index + 1], array[index]] = [
                array[index],
                array[index + 1],
              ];
              changed();
              renderItems();
            });
            down.disabled = index === array.length - 1;
            actions.append(
              up,
              down,
              button("この項目を削除", () => {
                if (
                  window.confirm(
                    "この項目を下書きから削除しますか？公開するまでは公開ページは変わりません。",
                  )
                ) {
                  array.splice(index, 1);
                  changed();
                  renderItems();
                }
              }),
            );
            box.append(actions);
            items.append(box);
          });
        };
        renderItems();
        group.append(
          button(`${labels[key] ?? key}を追加`, () => {
            array.push(empty(sample[0]));
            changed();
            renderItems();
          }),
        );
        container.append(group);
        continue;
      }
      const wrapper = document.createElement("div");
      wrapper.className = "admin-field";
      if (isTopLevel) markTarget(wrapper, sectionId(key));
      const inputId = `editor-field-${++id}`;
      const label = document.createElement("label");
      label.htmlFor = inputId;
      label.textContent = labels[key] ?? key;
      const multiline = [
        "text",
        "introduction",
        "answer",
        "address",
        "slogan",
        "joinTitle",
        "commission",
        "composition",
      ].includes(key);
      const input = document.createElement(multiline ? "textarea" : "input");
      input.id = inputId;
      input.value = String(value[key] ?? "");
      if (input instanceof HTMLInputElement) {
        input.type = typeof sample === "number" ? "number" : "text";
        if (typeof sample === "number") input.min = "0";
      }
      input.addEventListener("input", () => {
        value[key] =
          typeof sample === "number" ? Number(input.value) : input.value;
        changed();
      });
      wrapper.append(label, input);
      if (key === "image") {
        const image = document.createElement("img");
        image.alt = "選択中の写真";
        image.loading = "lazy";
        if (value[key]) image.src = value[key];
        else image.hidden = true;
        const file = document.createElement("input");
        file.type = "file";
        file.accept = "image/jpeg,image/png,image/webp,image/avif";
        file.setAttribute("aria-label", "写真をアップロード");
        file.addEventListener("change", async () => {
          if (!file.files?.[0] || busy) return;
          busy = true;
          file.disabled = true;
          notify("写真をアップロードしています…");
          try {
            const form = new FormData();
            form.set("file", file.files[0]);
            const response = await fetch("/api/admin/media", {
              method: "POST",
              body: form,
            });
            const result = await readApiResponse(response);
            if (!response.ok || !result.ok)
              throw new Error(
                result.message || "アップロードできませんでした。",
              );
            value[key] = result.url;
            input.value = result.url;
            image.src = result.url;
            image.hidden = false;
            changed();
            notify("写真を追加しました。下書きを保存してください。");
          } catch (error) {
            notify(apiErrorMessage(error), true);
          } finally {
            busy = false;
            file.disabled = false;
            file.value = "";
          }
        });
        input.addEventListener("change", () => {
          image.hidden = !input.value;
          if (input.value) image.src = input.value;
        });
        wrapper.append(image, file);
      }
      container.append(wrapper);
    }
  }
  const render = () => {
    fields.replaceChildren();
    renderObject(bootstrap.defaults, data, fields);
    renderToc();
    (document.querySelector("#restore-content") as HTMLButtonElement).disabled =
      !current.previous;
  };
  async function send(action: string) {
    if (busy) throw new Error("実行中の処理が終わってから操作してください。");
    busy = true;
    try {
      const response = await fetch(`/api/admin/content/${bootstrap.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, revision: current.revision, data }),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok)
        throw new Error(result.message || "保存できませんでした。");
      current = result.document;
      data = structuredClone(current.draft);
      dirty = false;
      render();
      notify(
        action === "save"
          ? "下書きを保存しました。プレビューで確認できます。"
          : action === "publish"
            ? "公開しました。"
            : "直前の公開版へ復元しました。",
      );
    } finally {
      busy = false;
    }
  }
  const run = async (action: string) => {
    try {
      await send(action);
    } catch (error) {
      notify(apiErrorMessage(error), true);
    }
  };
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    void run("save");
  });
  document
    .querySelector("#preview-content")
    ?.addEventListener("click", async () => {
      try {
        if (busy) throw new Error("写真のアップロード完了をお待ちください。");
        if (dirty) await send("save");
        window.location.href = `${bootstrap.preview}&editor=${bootstrap.key}`;
      } catch (error) {
        notify(apiErrorMessage(error), true);
      }
    });
  document
    .querySelector("#publish-content")
    ?.addEventListener("click", async () => {
      try {
        if (dirty) await send("save");
        (
          document.querySelector("#publish-confirm") as HTMLDialogElement
        ).showModal();
      } catch (error) {
        notify(apiErrorMessage(error), true);
      }
    });
  document
    .querySelector("#restore-content")
    ?.addEventListener("click", () =>
      (
        document.querySelector("#restore-confirm") as HTMLDialogElement
      ).showModal(),
    );
  for (const [selector, action] of [
    ["#publish-confirm", "publish"],
    ["#restore-confirm", "restore"],
  ]) {
    const dialog = document.querySelector<HTMLDialogElement>(selector)!;
    dialog.addEventListener("close", () => {
      if (dialog.returnValue === action) void run(action);
    });
  }
  window.addEventListener("beforeunload", (event) => {
    if (dirty || busy) {
      event.preventDefault();
    }
  });
  render();
}
