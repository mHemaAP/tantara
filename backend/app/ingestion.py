"""Safe local extraction, storage and chunk indexing primitives."""
import hashlib, io, json, mimetypes, os, uuid
from pathlib import Path
from app.config import get_settings
from app.chunking import chunk_text

class DocumentStorage:
    def __init__(self): self.root=get_settings().data_dir/"uploads"; self.root.mkdir(parents=True,exist_ok=True)
    def save(self,data:bytes):
        name=hashlib.sha256(data).hexdigest()+".bin"; path=(self.root/name).resolve()
        if path.parent!=self.root.resolve(): raise ValueError("Invalid storage path")
        if not path.exists(): path.write_bytes(data)
        return str(path)
class PdfExtractor:
    def extract(self,data):
        from pypdf import PdfReader
        reader=PdfReader(io.BytesIO(data)); pages=[]; warnings=[]
        for i,page in enumerate(reader.pages,1):
            content=page.extract_text() or ""; conf=None
            if len(content.strip())<20:
                try:
                    import pypdfium2 as pdfium
                    from rapidocr_onnxruntime import RapidOCR
                    bmp=pdfium.PdfDocument(data)[i-1].render(scale=2).to_pil()
                    result,_=RapidOCR()(bmp); content="\n".join(x[1] for x in (result or [])); conf=(sum(x[2] for x in result)/len(result)) if result else 0
                except Exception as exc: warnings.append({"page":i,"warning":f"OCR unavailable or failed: {type(exc).__name__}"})
            pages.append({"page_number":i,"text":content,"ocr_confidence":conf})
        return pages,warnings
class DocxExtractor:
    def extract(self,data):
        from docx import Document
        d=Document(io.BytesIO(data)); return [{"page_number":1,"text":"\n".join(p.text for p in d.paragraphs),"ocr_confidence":None}],[]
class TextMarkdownExtractor:
    def extract(self,data): return [{"page_number":1,"text":data.decode("utf8",errors="replace"),"ocr_confidence":None}],[]
class OcrFallback(PdfExtractor): pass
class DocumentExtractor:
    def extract(self,filename,data):
        ext=Path(filename).suffix.lower()
        if ext==".pdf": return PdfExtractor().extract(data)
        if ext==".docx": return DocxExtractor().extract(data)
        if ext in {".txt",".md"}: return TextMarkdownExtractor().extract(data)
        raise ValueError("Supported file types: PDF, DOCX, TXT, MD")

def extract(filename,data):
    pages,warnings=DocumentExtractor().extract(filename,data)
    return "\n".join(p["text"] for p in pages)
def ingest(filename,data,title,document_type="template",jurisdiction="India",source_label=None):
    """Legacy entry point retained for callers; new API persists async jobs."""
    pages,warnings=DocumentExtractor().extract(filename,data)
    return {"text":"\n".join(p["text"] for p in pages),"pages":pages,"warnings":warnings,"content_hash":hashlib.sha256(data).hexdigest()}
