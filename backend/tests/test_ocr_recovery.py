import builtins
import io

from reportlab.pdfgen import canvas

from app.ingestion import PdfExtractor


def test_ocr_import_failure_keeps_page_and_returns_recovery_warning(monkeypatch):
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer)
    pdf.showPage()
    pdf.save()
    original_import = builtins.__import__

    def broken_ocr_import(name, *args, **kwargs):
        if name in {"pypdfium2", "rapidocr_onnxruntime"}:
            raise RuntimeError("OCR dependency unavailable")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", broken_ocr_import)
    pages, warnings = PdfExtractor().extract(buffer.getvalue())
    assert len(pages) == 1
    assert pages[0]["page_number"] == 1
    assert warnings and warnings[0]["page"] == 1
    assert "OCR unavailable or failed" in warnings[0]["warning"]
