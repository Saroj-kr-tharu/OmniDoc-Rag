import { OmniRAG } from "./src/core.module.js";
import { TerminalUI } from "./src/terminalUI.js";

const rag = new OmniRAG();
const ui = new TerminalUI(rag);   

await ui.startMenu();