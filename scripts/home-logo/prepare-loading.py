"""Build the looping camera and Loading wordmark from the Illustrator SVG export."""

import argparse
import json
import xml.etree.ElementTree as ET
from pathlib import Path

from prepare import SVG, circle, path_distances, path_shapes, rectangle


BOX = (244, 338, 584, 394)
DURATION = 3.50
ERASE_START = 1.97
ERASE_SCALE = 0.78
CAMERA_END = 1.52
EASE = "0.333333 0 0.666667 1"


def number(value):
    return f"{value:.6f}".rstrip("0").rstrip(".") or "0"


def svg_path(shape):
    vertices = shape["vertices"]
    point = lambda p: " ".join(number(v) for v in p)
    result = ["M" + point(vertices[0])]
    count = len(vertices)
    for i in range(1, count + int(shape["closed"])):
        start, end = vertices[i - 1], vertices[i % count]
        outgoing, incoming = shape["outTangents"][i - 1], shape["inTangents"][i % count]
        if any(outgoing) or any(incoming):
            a = [v + d for v, d in zip(start, outgoing)]
            b = [v + d for v, d in zip(end, incoming)]
            result.append("C" + " ".join(map(point, [a, b, end])))
        elif i < count:
            result.append("L" + point(end))
    if shape["closed"]:
        result.append("Z")
    return " ".join(result)


def reverse(shape):
    return dict(vertices=shape["vertices"][::-1], inTangents=shape["outTangents"][::-1],
                outTangents=shape["inTangents"][::-1], closed=shape["closed"])


def at_distance(fraction):
    # Convert an arc-length fraction to the time of the cubic ease.
    low, high = 0, 1
    for _ in range(32):
        t = (low + high) / 2
        if t * t * (3 - 2*t) < fraction:
            low = t
        else:
            high = t
    return (low + high) / 2 * CAMERA_END


def element(tag, **attributes):
    return ET.Element(tag, {k.replace("_", "-"): str(v) for k, v in attributes.items()})


def animate(parent, attribute, points, *, discrete=False):
    clean = []
    for time, value in points:
        if clean and abs(clean[-1][0] - time) < 1e-7:
            clean[-1] = (time, value)
        else:
            clean.append((time, value))
    attrs = {
        "attributeName": attribute, "dur": f"{DURATION}s", "repeatCount": "indefinite",
        "calcMode": "discrete" if discrete else "spline",
        "keyTimes": ";".join(number(time / DURATION) for time, _ in clean),
        "values": ";".join(number(value) for _, value in clean),
    }
    if not discrete:
        attrs["keySplines"] = ";".join("0 0 1 1" if a == b else EASE
                                      for (_, a), (_, b) in zip(clean, clean[1:]))
    ET.SubElement(parent, "animate", attrs)


def stroke_animation(path, start, end, erase_start, erase_end):
    path.set("pathLength", "1")
    path.set("stroke-dasharray", "1 2")
    path.set("stroke-dashoffset", "0")
    animate(path, "stroke-dashoffset", [(0, 1), (start, 1), (end, 0),
                                       (erase_start, 0), (erase_end, -1), (DURATION, -1)])
    animate(path, "opacity", [(0, 0), (start + 0.0001, 1), (erase_end, 0), (DURATION, 0)], discrete=True)


def artwork(node):
    return ET.Element(node.tag.removeprefix(SVG), node.attrib.copy())


def shape_for(node):
    tag = node.tag.removeprefix(SVG)
    if tag == "path":
        return path_shapes(node.get("d"))
    if tag == "rect":
        return path_shapes(rectangle(*(float(node.get(key)) for key in ("x", "y", "width", "height"))))
    if tag == "circle":
        return path_shapes(circle(*(float(node.get(key)) for key in ("cx", "cy", "r")), closed=True))
    raise ValueError(tag)


def build(source, animated_path, still_path, model_path):
    root = ET.parse(source).getroot()
    camera, word = [g for g in root.findall(SVG + "g") if len(g)]
    tint, lens_color, outlines = list(camera)
    ring, body, arc, button, grip = [item for item in outlines if item.get("display") != "none"]
    letters = list(word)
    if len(letters) != 10:
        raise ValueError("Expected the ten Loading artwork paths")

    view_box = " ".join(map(str, BOX))
    def canvas():
        return ET.Element("svg", {"xmlns": SVG[1:-1], "viewBox": view_box, "width": "146", "height": "98.5"})

    animated = canvas()
    still = canvas()
    animated_defs = ET.SubElement(animated, "defs")
    model = []

    def track(name, guide, draw_start, draw_end, *, art=None, width=3, cap="butt", erase=None):
        erase_from, erase_to = erase or (ERASE_START + ERASE_SCALE * draw_start, ERASE_START + ERASE_SCALE * draw_end)
        shape = path_shapes(guide)[0]
        style = {"d": guide, "fill": "none", "stroke-width": str(width), "stroke-linecap": cap,
                 "stroke-linejoin": "round"}
        if art is None:
            shown = ET.SubElement(animated, "path", {"data-loading-part": name, **style, "stroke": "#000"})
            stroke_animation(shown, draw_start, draw_end, erase_from, erase_to)
            ET.SubElement(still, "path", {**style, "stroke": "#000"})
        else:
            mask_id = "loading-mask-" + name
            mask = ET.SubElement(animated_defs, "mask", {
                "id": mask_id, "maskUnits": "userSpaceOnUse",
                **dict(zip(("x", "y", "width", "height"), map(str, BOX))),
            })
            pen = ET.SubElement(mask, "path", {**style, "stroke": "#fff"})
            stroke_animation(pen, draw_start, draw_end, erase_from, erase_to)
            shown = artwork(art)
            shown.set("data-loading-part", name)
            shown.set("mask", f"url(#{mask_id})")
            animated.append(shown)
            still.append(artwork(art))
        model.append(dict(name=name, path=shape, width=width, round=cap == "round",
                          art=shape_for(art) if art is not None else None,
                          color=art.get("fill", "#000000") if art is not None else "#000000",
                          draw=[draw_start, draw_end], erase=[erase_from, erase_to]))

    body_shape = reverse(path_shapes(body.get("d"))[0])
    arc_shape = path_shapes(arc.get("d"))[0]
    main_shape = {key: body_shape[key] + arc_shape[key] for key in ("vertices", "inTangents", "outTangents")}
    main_shape["closed"] = False
    distances = path_distances(main_shape)
    lens_start = at_distance(distances[len(body_shape["vertices"])] / distances[-1])
    grip_start = at_distance((body_shape["vertices"][0][1] - float(grip.get("y1"))) / distances[-1])
    shutter_start = at_distance((distances[3] + 1.4) / distances[-1])

    x1, y1 = float(tint.get("x")), float(tint.get("y"))
    tint_width, tint_height = float(tint.get("width")), float(tint.get("height"))
    track("body-fill", f"M{x1 - 2} {y1 + tint_height/2} H{x1 + tint_width + 2}", CAMERA_END, 1.68,
          art=tint, width=tint_height + 2, erase=(ERASE_START, ERASE_START + 0.32))

    fill = artwork(lens_color)
    fill.set("data-loading-part", "lens-fill")
    fill_end = ERASE_START + ERASE_SCALE * lens_start
    animate(fill, "opacity", [(0, 0), (CAMERA_END, 1), (fill_end, 0), (DURATION, 0)], discrete=True)
    animated.append(fill)
    still.append(artwork(lens_color))
    model.append(dict(name="lens-fill", art=shape_for(lens_color), color=lens_color.get("fill"),
                      opacity=[CAMERA_END, fill_end]))

    track("body-outline", svg_path(main_shape), 0, CAMERA_END)
    track("grip", "M" + grip.get("x1") + " " + grip.get("y1") + " V" + grip.get("y2"),
          grip_start, grip_start + 0.29)

    shutter = reverse(path_shapes(button.get("d"))[0])
    start_vertex = min(range(len(shutter["vertices"])),
                       key=lambda i: abs(shutter["vertices"][i][0] - 434.47265) +
                       abs(shutter["vertices"][i][1] - 375.71008))
    for key in ("vertices", "inTangents", "outTangents"):
        shutter[key] = shutter[key][start_vertex:] + shutter[key][:start_vertex]
    track("shutter", svg_path(shutter), shutter_start, shutter_start + 0.29)
    track("lens", circle(*(float(ring.get(key)) for key in ("cx", "cy", "r"))), lens_start, CAMERA_END)

    pens = [
        ("M379.78 602.25 C397.9 602.25 411.8 588.6 412.7 576.7 C413.3 568 407.5 562.5 396.1 562.5"
         " C375.8 562.5 360.8 589.8 343.5 612.8 C329.2 632.7 315.4 654.6 298.2 666.75"
         " C288.9 673 279.4 675.7 270.7 675.7 C263.1 675.7 257.65 670.9 258.0 665"
         " C258.5 660.1 262.9 656.4 268.8 656.4 C276 656.4 286.7 661.4 298.7 667.4"
         " C318.5 677.4 342.6 690.6 369.93 690.6 C381.6 690.6 393.6 688 403.4 683.6", 0, .47, 5.8),
        ("M386.9 646.55 C379.1 652 375.8 666.8 389.1 658.6 C394.4 655.4 401.2 649 401.2 644.8"
         " C401.2 638.0 390.25 639 390.25 650.55 C390.25 656.7 396.0 659.75 407.65 659.75"
         " C418 659.75 427.3 655.6 436.35 651.8", .44, .64, 6),
        ("M453.25 649.1 C449 638.4 435 649.1 435 657.0 C435 665.6 446.5 655.65 457.7 645.2"
         " C453.3 651.8 446.0 663 458.47 663 C464.5 663 481.6 657.0 493.68 651.8", .61, .79, 6),
        ("M509 648.5 C504 638.8 492.1 648.5 492.1 657.05 C492.1 666.5 501.4 657.9 511.7 644.8"
         " C520.3 633.4 529.1 619.1 536.6 608.6 C529 620.5 518.9 635.5 511.6 645.5"
         " C507.2 652.0 502.4 663.0 512.23 663.0 C519.4 663.0 536.8 656.7 547.45 651.8", .76, .99, 6),
        ("M547.45 651.8 C553.6 649.1 558.1 647.0 563.35 643.65 C548 656.5 560.3 661.87 575.2 661.87"
         " C589.2 661.87 605.5 657.0 615.7 651.8", .96, 1.11, 6),
        ("M615.7 651.8 C631.0 645.0 641.7 639.8 643.5 642.9 C645.2 646.5 636.0 657.7 633.5 660.6"
         " C640.0 654.3 654.9 642.8 659.2 642.8 C663.5 643.1 654.45 650.0 654.45 655.7"
         " C654.45 666.4 681.8 662.3 703.7 651.8", 1.09, 1.28, 6),
        ("M719.6 649.2 C716.6 638.0 702 649.5 702 657 C702 667.0 715.9 651.7 722 647.0"
         " C710.5 662.1 675.0 727.2 656.7 719 C649.0 715.5 657.5 692.0 686.0 681.4"
         " C705.0 673.3 733.5 659.8 751.8 651.8", 1.24, 1.54, 6.4),
    ]
    i_stem, i_dot = letters[4].get("d").strip().split("M571.74609", 1)
    letters[4].set("d", i_stem)
    dot = element("path", d="M571.74609" + i_dot)
    for i, (pen, start, end, width) in enumerate(pens):
        track(f"word-{i + 1}", pen, start, end, art=letters[i], width=width, cap="round")
        if i == 4:
            track("i-dot", "M571 638 L576.4 634.55", 1.075, 1.15, art=dot, width=5, cap="round")
    for i, (x, art) in enumerate(zip((762.5, 788.7, 814.9), letters[7:])):
        track(f"dot-{i + 1}", f"M{x-0.65} 659 L{x+0.7} 660.65",
              1.48 + i*.055, 1.55 + i*.055, art=art, width=4, cap="round")

    for svg, path in ((animated, animated_path), (still, still_path)):
        ET.indent(svg, space="  ")
        path.write_text(ET.tostring(svg, encoding="unicode") + "\n", encoding="utf-8")
    model_path.write_text(json.dumps(dict(box=BOX, duration=DURATION, layers=model),
                                     separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("animated", type=Path)
    parser.add_argument("still", type=Path)
    parser.add_argument("model", type=Path)
    args = parser.parse_args()
    build(args.source, args.animated, args.still, args.model)
