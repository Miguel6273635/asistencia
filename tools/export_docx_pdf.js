var args = WScript.Arguments;
if (args.length < 2) {
    WScript.Echo("Uso: cscript export_docx_pdf.js entrada.docx salida.pdf");
    WScript.Quit(2);
}

var inputPath = args.Item(0);
var outputPath = args.Item(1);
var word = null;
var document = null;

try {
    word = new ActiveXObject("Word.Application");
    word.Visible = false;
    word.DisplayAlerts = 0;
    document = word.Documents.Open(inputPath, false, true);
    document.ExportAsFixedFormat(outputPath, 17, false, 0, 0, 1, 9999, 0, true, true, 1, true, true, false);
    document.Close(false);
    document = null;
    word.Quit();
    word = null;
    WScript.Echo(outputPath);
} catch (error) {
    if (document !== null) {
        try { document.Close(false); } catch (ignoredDocumentError) {}
    }
    if (word !== null) {
        try { word.Quit(); } catch (ignoredWordError) {}
    }
    WScript.Echo("Error: " + error.message);
    WScript.Quit(1);
}
