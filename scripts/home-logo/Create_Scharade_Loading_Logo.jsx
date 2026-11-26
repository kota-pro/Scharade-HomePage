(function () {
    var options = $.global.scharadeLoadingBuild;
    var source = options ? new File(options.source) : File.openDialog("Select loading-data.json");
    if (!source) return;
    var destination = options ? new File(options.project) : File.saveDialog("Save Scharade Loading Logo (.aep)");
    if (!destination) return;
    if (!app.project || app.project.file || app.project.numItems) {
        throw new Error("Open a new, empty After Effects project.");
    }
    source.encoding = "UTF-8";
    if (!source.open("r")) throw new Error("Could not open the prepared shape data.");
    var input = source.read();
    source.close();
    var data = typeof JSON === "undefined" ? eval("(" + input + ")") : JSON.parse(input);
    var box = data.box;
    var contentsName = "ADBE Vectors Group";

    function shapeLayer(comp, name) {
        var layer = comp.layers.addShape();
        layer.name = name;
        var transform = layer.property("ADBE Transform Group");
        transform.property("ADBE Anchor Point").setValue([0, 0]);
        transform.property("ADBE Position").setValue([-box[0], -box[1]]);
        return layer;
    }

    function contents(layer, name) {
        var group = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        group.name = name;
        return group.property(contentsName);
    }

    function path(group, geometry) {
        var shape = new Shape();
        shape.vertices = geometry.vertices;
        shape.inTangents = geometry.inTangents;
        shape.outTangents = geometry.outTangents;
        shape.closed = geometry.closed;
        group.addProperty("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(shape);
    }

    function color(value) {
        return [parseInt(value.substr(1, 2), 16) / 255, parseInt(value.substr(3, 2), 16) / 255,
            parseInt(value.substr(5, 2), 16) / 255, 1];
    }

    function ease(property, times) {
        property.setValueAtTime(times[0], 0);
        property.setValueAtTime(times[1], 100);
        var keyEase = new KeyframeEase(0, 33.33333);
        for (var i = 1; i <= property.numKeys; i++) {
            property.setTemporalEaseAtKey(i, [keyEase], [keyEase]);
        }
    }

    function pen(layer, track, strokeColor) {
        var group = contents(layer, "Pen path");
        path(group, track.path);
        var stroke = group.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(color(strokeColor));
        stroke.property("ADBE Vector Stroke Width").setValue(track.width);
        stroke.property("ADBE Vector Stroke Line Cap").setValue(track.round ? 2 : 1);
        stroke.property("ADBE Vector Stroke Line Join").setValue(2);
        var trim = group.addProperty("ADBE Vector Filter - Trim");
        trim.name = "Draw End / Erase Start";
        ease(trim.property("ADBE Vector Trim End"), track.draw);
        ease(trim.property("ADBE Vector Trim Start"), track.erase);
    }

    function fill(layer, track) {
        var group = contents(layer, "Illustrator artwork");
        for (var i = 0; i < track.art.length; i++) path(group, track.art[i]);
        var paint = group.addProperty("ADBE Vector Graphic - Fill");
        paint.property("ADBE Vector Fill Color").setValue(color(track.color));
        paint.property("ADBE Vector Fill Rule").setValue(1);
    }

    app.beginUndoGroup("Create Scharade Loading Logo");
    try {
        var comp = app.project.items.addComp("Scharade Loading Logo", box[2], box[3], 1, data.duration, 30);
        comp.bgColor = [0.992, 0.992, 0.992];
        for (var index = 0; index < data.layers.length; index++) {
            var track = data.layers[index];
            var layer = shapeLayer(comp, track.name);
            if (track.art) {
                fill(layer, track);
                if (track.opacity) {
                    var opacity = layer.property("ADBE Transform Group").property("ADBE Opacity");
                    opacity.setValueAtTime(0, 0);
                    opacity.setValueAtTime(track.opacity[0], 100);
                    opacity.setValueAtTime(track.opacity[1], 0);
                    for (var key = 1; key <= opacity.numKeys; key++) {
                        opacity.setInterpolationTypeAtKey(key, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                    }
                } else {
                    var matte = shapeLayer(comp, "Draw / " + track.name);
                    pen(matte, track, "#ffffff");
                    layer.setTrackMatte(matte, TrackMatteType.ALPHA);
                    matte.enabled = false;
                }
            } else {
                pen(layer, track, track.color);
            }
        }
        comp.markerProperty.setValueAtTime(0, new MarkerValue("Draw camera and wordmark"));
        comp.markerProperty.setValueAtTime(1.97, new MarkerValue("Erase from the beginning"));
        comp.time = 1.8;
        app.project.save(destination);
        comp.openInViewer();
    } finally {
        app.endUndoGroup();
    }
}());
