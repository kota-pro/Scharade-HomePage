"""Prepare the homepage assets from Illustrator's SVG export of scharade_logo.ai."""

import argparse
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path


SVG = "{http://www.w3.org/2000/svg}"
WIDTH, HEIGHT = 479, 116.33
ARTBOARD_ORIGIN = (304, 476.07)
FPS, FRAMES = 30, 108
TOKEN = re.compile(r"[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?")
ARITY = dict(M=2, L=2, H=1, V=1, C=6, S=4, Q=4)


def path_shapes(path):
    """Translate the commands used in this artwork to AE's relative handles."""
    tokens = TOKEN.findall(path)
    shapes = []
    command = last = None
    current = (0, 0)
    offset = 0
    while offset < len(tokens):
        if tokens[offset].isalpha():
            command = tokens[offset]
            offset += 1
        kind = command.upper()
        if kind == "Z":
            shape["closed"] = True
            current = tuple(shape["vertices"][0])
            if shape["vertices"][-1] == list(current):
                shape["inTangents"][0] = shape["inTangents"].pop()
                shape["outTangents"].pop()
                shape["vertices"].pop()
            last = command = None
            continue

        count = ARITY[kind]
        args = list(map(float, tokens[offset:offset + count]))
        offset += count
        x, y = current
        dx, dy = current if command.islower() else (0, 0)
        first = second = None
        if kind == "H":
            end = (args[0] + dx, y)
        elif kind == "V":
            end = (x, args[0] + dy)
        else:
            end = (args[-2] + dx, args[-1] + dy)
            if kind == "C":
                first = (args[0] + dx, args[1] + dy)
                second = (args[2] + dx, args[3] + dy)
            elif kind == "S":
                first = (2*x - control[0], 2*y - control[1]) if last in ("C", "S") else current
                second = (args[0] + dx, args[1] + dy)
            elif kind == "Q":
                control = (args[0] + dx, args[1] + dy)
                first = (x + 2/3*(control[0]-x), y + 2/3*(control[1]-y))
                second = (end[0] + 2/3*(control[0]-end[0]), end[1] + 2/3*(control[1]-end[1]))
        if kind == "M":
            shape = dict(vertices=[], inTangents=[], outTangents=[], closed=False)
            shapes.append(shape)
            command = "l" if command.islower() else "L"
        if first is not None:
            shape["outTangents"][-1] = [first[0]-x, first[1]-y]
        shape["vertices"].append(list(end))
        shape["inTangents"].append([0, 0] if second is None else [second[0]-end[0], second[1]-end[1]])
        shape["outTangents"].append([0, 0])
        current = end
        last = kind
        control = second
    return shapes


def path_distances(shape):
    distances = [0]
    for index, end in enumerate(shape["vertices"][1:], 1):
        start = shape["vertices"][index - 1]
        out = shape["outTangents"][index - 1]
        incoming = shape["inTangents"][index]
        first = [start[i] + out[i] for i in range(2)]
        second = [end[i] + incoming[i] for i in range(2)]
        previous = start
        length = distances[-1]
        for step in range(1, 101):
            t = step / 100
            u = 1 - t
            point = [u**3*start[i] + 3*u*u*t*first[i] + 3*u*t*t*second[i] + t**3*end[i] for i in range(2)]
            length += math.dist(previous, point)
            previous = point
        distances.append(length)
    return distances


def rectangle(x, y, w, h):
    return f"M{x},{y} H{x+w} V{y+h} H{x} Z"


def circle(cx, cy, r, closed=False):
    k = 0.5522847498307936 * r
    path = (
        f"M{cx},{cy+r} C{cx-k},{cy+r} {cx-r},{cy+k} {cx-r},{cy}"
        f" C{cx-r},{cy-k} {cx-k},{cy-r} {cx},{cy-r}"
        f" C{cx+k},{cy-r} {cx+r},{cy-k} {cx+r},{cy}"
        f" C{cx+r},{cy+k} {cx+k},{cy+r} {cx},{cy+r}"
    )
    return path + (" Z" if closed else "")


def key(frame, value, speed=0, influence=33.333333, hold=False):
    return dict(time=frame/FPS, value=value, speed=speed, influence=influence, hold=hold)


def trace(path, width, start, finish, *, butt=False):
    return dict(shape=path_shapes(path)[0], width=width, butt=butt, keys=[key(start, 0), key(finish, 100)])


def camera_trace():
    shape, = path_shapes(
        "M343.7 95.6 C347.8 89.5 346.7 54 346.22 29.93"
        " C346 21 345.8 18.05 355.48 17.84"
        " C361 17.8 370 18 375 17.6 C385 17 380 1.3 389.4 1.18"
        " C405 1.03 425 0.99 435.4 1.25 C444.5 1.55 439.5 13.7 445.8 16.55"
        " C449 18 458 17.82 468.2 17.9 C477 17.9 477.94 18.5 477.96 23.4"
        " L477.97 93.94 C477.98 98.8 477.15 99.45 472.6 99.5"
        " L412.05 99.555 C394.1 99.75 378.55 85.4 377.63 67.2"
        " C376.65 55.2 382.32 43.23 392.77 36.53"
        " C403.15 29.5 415.88 28.45 426.83 33.76"
        " C439.04 39.56 446.66 51.53 446.66 65.0"
    )
    distances = path_distances(shape)
    # The matched incoming/outgoing speeds keep the pen moving at the branch cues.
    def progress(vertex):
        return 100 * distances[vertex] / distances[-1]

    return dict(shape=shape, width=4, butt=False, keys=[
        key(39, 0, influence=47),
        key(46, progress(1), speed=53),
        key(50, progress(2), speed=32),
        key(72, progress(11), speed=72),
        key(87, 100, influence=62),
    ])


def prepare(source, output, still):
    original = ET.parse(source).getroot()
    layout, = [group for group in original.findall(SVG + "g") if len(group)]
    artwork, japanese = layout.findall(SVG + "g")
    lettering, camera = artwork.findall(SVG + "g")
    tint, lens, body, arc, button, grip = list(camera)
    lens_color, lens_ring = list(lens)
    assert original.get("viewBox") == "0 0 1080 1080" and len(lettering) == 8 and len(japanese) == 12
    origin_x, origin_y = ARTBOARD_ORIGIN

    def draw(element):
        tag = element.tag.removeprefix(SVG)
        attrs = element.attrib
        if tag == "path":
            d = attrs["d"]
        elif tag == "rect":
            d = rectangle(*(float(attrs[k]) for k in ("x", "y", "width", "height")))
        elif tag == "circle":
            d = circle(*(float(attrs[k]) for k in ("cx", "cy", "r")), closed=True)
        else:
            raise ValueError(f"Unexpected artwork element {tag}")
        shapes = path_shapes(d)
        for shape in shapes:
            shape["vertices"] = [[x-origin_x, y-origin_y] for x, y in shape["vertices"]]
        return dict(color=attrs.get("fill", "#000000").lower(), shapes=shapes)

    def layer(name, elements, matte=None, opacity=None):
        return dict(name=name, art=elements, matte=matte, opacity=opacity)

    cursive = [
        ("S", "M76.4 54.6 C78.9 52.15 80 49.7 80 47.6 C80 42 71.8 37.2 62.13 37.2"
              " C49.1 37.2 35.86 45.3 35.5 53.8 C35.24 59.2 39.35 63.8 44.15 68.5"
              " C51.35 75.4 60.0 82.25 58.77 91.15 C57.98 97.5 53.4 103.42 46.12 107.88"
              " C38.65 112.52 28.75 115.44 19.74 115.44 C8.7 115.44 0.93 109.7 0.93 100.88"
              " C0.93 96.38 3 91.4 6.92 85.85", 3.1, 0, 11),
        ("c", "M86.38 97.17 C90.5 93.55 89.67 91.43 85.54 91.43 C79.6 91.43 73.67 98.75 76.97 102.58"
              " C80.4 106.76 100.95 104.2 113.95 98.28", 3.2, 11, 15),
        ("h", "M137.9 70.4 L113.97 106.25 C120.7 96.28 128.1 91.7 132.28 91.7"
              " C134.95 91.7 132.43 95.63 129.97 99.2 C126.35 104.2 126.8 106.9 131.41 106.9"
              " C138.9 106.9 156.8 99.22 159.18 98.28", 3.4, 14, 20),
        ("a", "M171.05 96.1 C170.3 94.3 168.6 93.78 166.79 93.78 C163 93.78 159.11 98 159.11 101.63"
              " C159.11 107.3 166.3 101 173.9 93.95 C172.4 96.3 170.35 100.4 170.35 102.62"
              " C170.35 109.15 184.2 103.44 196.62 98.28", 3.5, 19, 25),
        ("r", "M196.62 98.28 C202.35 95.92 208.78 91.18 210.83 91.18 C213.6 91.18 206.4 101.9 204.78 104.25"
              " C209.46 97.32 214.98 91.55 219.25 91.55 C221 91.55 222.1 92.6 222.1 93.66"
              " C220.6 91.73 218.2 91.2 217.0 94.13 C214.15 101.3 228.55 103.75 240.24 98.28", 3.6, 24, 29),
        ("a", "M252.03 96.1 C251.28 94.3 249.58 93.78 247.77 93.78 C243.98 93.78 240.09 98 240.09 101.63"
              " C240.09 107.3 247.28 101 254.88 93.95 C253.38 96.3 251.33 100.4 251.33 102.62"
              " C251.33 109.15 265.18 103.44 277.60 98.28", 3.5, 28, 32),
        ("d", "M288.48 96.1 C287.65 94.42 286.45 93.8 285.21 93.8 C281.44 93.8 277.6 98.12 277.6 101.63"
              " C277.6 106.55 282.05 103.75 286.95 97.78 C294.21 89.03 301 78.33 306 70.43"
              " C301 78.33 294.21 89.03 288.87 96.4 C286.8 99.3 285.44 105.43 290.43 105.43"
              " C295 105.43 305.9 101.32 312.9 98.28", 3.6, 31, 36),
        ("e", "M313 98.36 C312.9 102.6 323.12 99 323.12 94.54 C323.12 90.16 313.43 91.66 312.95 98.33"
              " C312.2 110.54 332.9 107.54 343.76 95.57", 3.8, 35, 39),
    ]
    layers = [
        layer("Camera body color", [draw(tint)], trace("M345.5 64.43 H477.5", 53.1, 90, 101, butt=True)),
        layer("Lens interior color", [draw(lens_color)], opacity=[key(0, 0, hold=True), key(90, 100)]),
        layer("Inner lens ring", [draw(lens_ring)], trace(circle(412.05, 64.73, 25.99), 3.6, 72, 90, butt=True)),
        layer("Camera outline and lens arc", [draw(body), draw(arc)], camera_trace()),
        layer("Shutter button", [draw(button)], trace(
            "M356.48 12.82 C356.48 13.85 357.31 14.68 358.34 14.68 H368.66"
            " C369.69 14.68 370.51 13.85 370.51 12.82 V10.78 C370.51 9.75 369.69 8.93 368.66 8.93"
            " H358.34 C357.31 8.93 356.48 9.75 356.48 10.78 V12.82", 3.1, 50, 63)),
        layer("Camera grip", [draw(grip)], trace("M353 29.93 V90.93", 3.1, 46, 58)),
    ]
    layers.extend(layer(f"Handwriting {index + 1:02d} {letter}", [draw(element)], trace(d, width, start, end))
                  for index, (element, (letter, d, width, start, end)) in enumerate(zip(lettering, cursive)))
    layers.append(layer("Japanese wordmark", [draw(element) for element in japanese], opacity=[key(90, 0), key(101, 100)]))

    output.write_text(json.dumps(dict(width=WIDTH, height=HEIGHT, duration=FRAMES/FPS, fps=FPS, layers=layers),
                                 separators=(",", ":")) + "\n", encoding="utf-8")

    ET.register_namespace("", SVG[1:-1])
    root = ET.Element(SVG + "svg", {"viewBox": f"0 0 {WIDTH} {HEIGHT}", "width": str(WIDTH), "height": str(HEIGHT)})
    crop = ET.SubElement(root, SVG + "g", {"transform": f"translate({-origin_x} {-origin_y})"})
    crop.extend([lettering, camera, japanese])
    ET.indent(root, space="  ")
    still.write_text(ET.tostring(root, encoding="unicode") + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("still", type=Path)
    args = parser.parse_args()
    prepare(args.source, args.output, args.still)
