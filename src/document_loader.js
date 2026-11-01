import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { CSVLoader } from "@langchain/community/document_loaders/fs/csv";
import { DocxLoader } from "@langchain/community/document_loaders/fs/docx";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { PPTXLoader } from "@langchain/community/document_loaders/fs/pptx";
import { SRTLoader } from "@langchain/community/document_loaders/fs/srt";
import fs from "node:fs";
import path from "node:path";

const LOADER_MAP = {
  pdf: ["pdf"],
  docx: ["docx", "docm", "dotx", "dotm"],
  pptx: ["pptx", "pptm", "potx", "potm", "ppsx", "ppsm", "sldx", "sldm"],
  csv: ["csv"],
  text: ["txt", "md", "log"],
  srt: ["srt"],
};

// reverse lookup: { docx: "docx", docm: "docx", ppsx: "pptx", ... }
const EXT_TO_LOADER = Object.fromEntries(
  Object.entries(LOADER_MAP).flatMap(([loader, exts]) =>
    exts.map((ext) => [ext, loader]),
  ),
);

export class DocumentLoader {

  cleanPath(filePath = "") {
    return String(filePath).trim().replace(/^["']|["']$/g, "");
  }

  getFileExtension(filePath = "") {
    return path.extname(this.cleanPath(filePath)).slice(1).toLowerCase();
  }

  getSupportedExtensions() {
    return Object.keys(EXT_TO_LOADER);
  }
  
  async loadPdf(filePath) {
    return new PDFLoader(filePath).load();
  }

  async loadDocx(filePath) {
    return new DocxLoader(filePath).load();
  }

  async loadPptx(filePath) {
    return new PPTXLoader(filePath).load();
  }

  async loadCsv(filePath) {
    return new CSVLoader(filePath).load();
  }

  async loadText(filePath) {
    return new TextLoader(filePath).load();
  }

  async loadSrt(filePath) {
    return new SRTLoader(filePath).load();
  }

  //  make metadata the same for every file type 
  normalizeMetadata(docs, filePath) {
    return docs.map((doc) => {
      const meta = doc.metadata ?? {};
      const pageNumber = meta.loc?.pageNumber;

      doc.metadata = {
        ...meta,
        source: meta.source ?? filePath,
        fileName: path.basename(filePath),
        location: meta.location ?? (pageNumber != null ? `page ${pageNumber}` : "N/A"),
      };
      return doc;
    });
  }

  async MainDocumentLoad(filePath = "") {
    const cleaned = this.cleanPath(filePath);

    if (!cleaned) {
      throw new Error("File path is empty.");
    }
    if (!fs.existsSync(cleaned)) {
      throw new Error(`File not found: ${cleaned}`);
    }

    const ext = this.getFileExtension(cleaned);
    const loaderType = EXT_TO_LOADER[ext];

    let docs;
    switch (loaderType) {
      case "pdf":
        docs = await this.loadPdf(cleaned);
        break;
      case "docx":
        docs = await this.loadDocx(cleaned);
        break;
      case "pptx":
        docs = await this.loadPptx(cleaned);
        break;
      case "csv":
        docs = await this.loadCsv(cleaned);
        break;
      case "text":
        docs = await this.loadText(cleaned);
        break;
      case "srt":
        docs = await this.loadSrt(cleaned);
        break;
      default:
        throw new Error(
          `Unsupported file type: ".${ext}". Supported: ${this.getSupportedExtensions().join(", ")}`,
        );
    }

    return this.normalizeMetadata(docs, cleaned);
  }
}