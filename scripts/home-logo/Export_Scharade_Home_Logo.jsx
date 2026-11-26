(function () {
    $.evalFile(new File(File($.fileName).parent.fsName + "/Home_Logo_AE.jsxinc"));
    var output = File.saveDialog("Export Scharade Home Logo (.svg)");
    if (output) ScharadeLogoAE.writeSvg(app.project.activeItem, output);
}());
