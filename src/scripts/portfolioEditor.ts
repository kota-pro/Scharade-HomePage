import { readApiResponse, apiErrorMessage } from "./apiResponse";
import { operationNotice } from "./siteNotice";
import { optimizeMicrocmsImage } from "../utils/microcmsImage";
const form = document.querySelector<HTMLFormElement>("#portfolio-form");
const bootstrap = document.querySelector<HTMLElement>("#portfolio-edit-data");
if (form && bootstrap) {
  const initial = JSON.parse(bootstrap.dataset.initial || "{}");
  const viewUrl = JSON.parse(bootstrap.dataset.viewUrl || '""');
  const pictures: string[] = Array.isArray(initial.pictures)
    ? [...initial.pictures]
    : [];
  let icon = initial.iconUrl || "",
    busy = false,
    dirty = false;
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const status = document.getElementById("status-message")!;
  const iconList = document.getElementById("icon-preview")!,
    pictureList = document.getElementById("picture-list")!;
  const notify = (text: string, error = false) => {
    operationNotice(text,error,"portfolio-editor");
    status.textContent = text;
    status.className = "status-message " + (error ? "error" : "success");
  };
  const markDirty = () => {
    dirty = true;
  };
  form.addEventListener("input", markDirty);
  const setBusy = (value: boolean) => {
    busy = value;
    form
      .querySelectorAll<
        HTMLInputElement | HTMLButtonElement
      >("#submit-button,input[type=file]")
      .forEach((el) => (el.disabled = value));
  };
  const button = (label: string, action: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => {
      if (!busy) action();
    });
    return b;
  };
  const render = () => {
    iconList.replaceChildren();
    pictureList.replaceChildren();
    const chip = (url: string, alt: string) => {
      const div = document.createElement("div");
      div.className = "picture-chip";
      const img = document.createElement("img");
      img.src = optimizeMicrocmsImage(url, { width: 240, quality: 75 });
      img.alt = alt;
      img.width = 120;
      img.height = 120;
      img.loading = "lazy";
      img.style.objectFit = "cover";
      div.append(img);
      return div;
    };
    if (icon) {
      const div = chip(icon, "現在のアイコン");
      div.append(
        button("削除", () => {
          icon = "";
          markDirty();
          render();
        }),
      );
      iconList.append(div);
    }
    pictures.forEach((url, index) => {
      const div = chip(url, `作品 ${index + 1}`);
      const up = button("前へ", () => {
        [pictures[index - 1], pictures[index]] = [
          pictures[index],
          pictures[index - 1],
        ];
        markDirty();
        render();
      });
      up.disabled = index === 0;
      const down = button("後へ", () => {
        [pictures[index + 1], pictures[index]] = [
          pictures[index],
          pictures[index + 1],
        ];
        markDirty();
        render();
      });
      down.disabled = index === pictures.length - 1;
      div.append(
        up,
        down,
        button("削除", () => {
          pictures.splice(index, 1);
          markDirty();
          render();
        }),
      );
      pictureList.append(div);
    });
  };
  const tags = document.getElementById("field-hashtags") as HTMLSelectElement;
  for (const tag of initial.hashtags ?? [])
    if (!Array.from(tags.options).some((option) => option.value === tag))
      tags.add(new Option(tag, tag, true, true));
  async function upload(file: File) {
    if (file.size > 20 * 1024 * 1024)
      throw new Error(`${file.name}: 20MB以下の画像を選択してください。`);
    const data = new FormData();
    data.set("file", file);
    const response = await fetch("/api/portfolio/upload", {
      method: "POST",
      body: data,
    });
    const result = await readApiResponse(response);
    if (!response.ok || !result.url)
      throw new Error(result.message || "画像をアップロードできませんでした。");
    return result.url as string;
  }
  for (const id of ["field-icon-file", "picture-files"])
    input(id)?.addEventListener("change", async () => {
      const files = Array.from(input(id).files ?? []);
      if (!files.length || busy) return;
      if (id === "picture-files" && pictures.length + files.length > 500) {
        notify("作品は500枚以内で選択してください。", true);
        return;
      }
      setBusy(true);
      notify("画像をアップロードしています…");
      try {
        for (const file of files) {
          const url = await upload(file);
          if (id === "field-icon-file") icon = url;
          else pictures.push(url);
          markDirty();
        }
        notify("画像を追加しました。保存すると公開ページへ反映されます。");
      } catch (error) {
        notify(
          apiErrorMessage(error),
          true,
        );
      } finally {
        render();
        setBusy(false);
        input(id).value = "";
      }
    });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (
      busy ||
      !form.reportValidity() ||
      !window.confirm("この内容でPortfolioを更新しますか？")
    )
      return;
    setBusy(true);
    notify("保存しています…");
    const admin = input("field-executive");
    const number = (id: string) =>
      input(id).value === "" ? null : Number(input(id).value);
    const body = {
      portfolioId: input("field-target-id").value,
      name: input("field-name").value,
      iconUrl: icon,
      pictures: [...pictures],
      hashtags: Array.from(tags.selectedOptions).map((o) => o.value),
      grade: input("field-grade").value,
      x_url: input("field-x-url").value,
      instagram: input("field-instagram").value,
      camera: input("field-camera").value,
      self_introduction: (
        document.getElementById("field-self-intro") as HTMLTextAreaElement
      ).value,
      ...(admin
        ? {
            ...(input("field-generation").value !==
            input("field-generation").defaultValue
              ? { generation: number("field-generation") }
              : {}),
            displayOrder: number("field-display-order"),
            role: input("field-role").value,
            isExecutive: admin.checked,
          }
        : {}),
    };
    try {
      const response = await fetch("/api/portfolio/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readApiResponse(response);
      if (!response.ok || !result.ok)
        throw new Error(result.message || "保存できませんでした。");
      dirty = false;
      busy = false;
      notify("保存しました。公開ページへ移動します。");
      if (viewUrl) location.assign(viewUrl);
    } catch (error) {
      notify(
        apiErrorMessage(error),
        true,
      );
      setBusy(false);
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty || busy) event.preventDefault();
  });
  render();
}
