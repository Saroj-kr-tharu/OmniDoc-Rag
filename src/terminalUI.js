import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

export class TerminalUI  {

    constructor(rag) {
    this.rag = rag;
  }


  c = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    gray: "\x1b[90m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
  };
  // ---------- UI helpers ----------
  clear() {
    process.stdout.write("\x1Bc");
  }

  center(text, width) {
    const left = Math.floor((width - text.length) / 2);
    return " ".repeat(left) + text + " ".repeat(width - text.length - left);
  }

  banner() {
    const w = 46;
    const { c } = this;
    console.log(`${c.cyan}╔${"═".repeat(w)}╗`);
    console.log(
      `║${c.bold}${this.center("OmniDoc RAG", w)}${c.reset}${c.cyan}║`,
    );
    console.log(
      `║${c.dim}${this.center("Chat with PDF, DOCX, Excel, SRT, images", w)}${c.reset}${c.cyan}║`,
    );
    console.log(`╚${"═".repeat(w)}╝${c.reset}`);
  }

  showMenu(loadedFiles) {
    const { c } = this;
    console.log(`\n  ${c.bold}MENU${c.reset}`);
    console.log(`  ${c.green}1${c.reset}  Ask a question`);
    console.log(`  ${c.green}2${c.reset}  Load a document`);
    console.log(`  ${c.green}3${c.reset}  Test query decomposition`);
    console.log(`  ${c.green}4${c.reset}  Test query enhancement`);
    console.log(`  ${c.red}0${c.reset}  Exit`);
    console.log(
      `\n  ${c.gray}Loaded documents: ${loadedFiles.length ? loadedFiles.join(", ") : "none"}${c.reset}`,
    );
  }

  async withSpinner(label, task) {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let i = 0;
    const timer = setInterval(() => {
      process.stdout.write(
        `\r  ${this.c.cyan}${frames[i++ % frames.length]}${this.c.reset} ${label}`,
      );
    }, 80);
    try {
      return await task();
    } finally {
      clearInterval(timer);
      process.stdout.write("\r" + " ".repeat(label.length + 6) + "\r");
    }
  }

  printList(title, items) {
    const { c } = this;
    console.log(`\n  ${c.bold}${c.magenta}${title}${c.reset}`);
    items.forEach((q, i) => console.log(`  ${c.gray}${i + 1}.${c.reset} ${q}`));
  }

  wrap(text, width, indent = "   ") {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    for (const w of words) {
      if ((line + " " + w).trim().length > width) {
        lines.push(line);
        line = w;
      } else {
        line = (line + " " + w).trim();
      }
    }
    if (line) lines.push(line);
    return lines.map((l) => indent + l).join("\n");
  }

  printAnswers(response) {
    const { c } = this;
    // accept a JSON string or an already parsed object
    let data = response;
    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch {
        console.log(data); // plain text
        return;
      }
    }

    const answers = data?.answers ?? [];
    const width = Math.min(process.stdout.columns || 80, 100) - 4;
    const line = c.gray + "─".repeat(width + 3) + c.reset;

    console.log("\n" + line);
    answers.forEach((item, i) => {
      const unknown = /^i don'?t know/i.test(item.answer);

      console.log(`${c.bold}${c.cyan}${i + 1}. ${item.question}${c.reset}`);
      console.log(
        (unknown ? c.yellow : c.green) +
          this.wrap(item.answer, width) +
          c.reset,
      );

      if (!unknown) {
        console.log(
          `${c.gray}   📄 ${item.source}  |  page ${item.page}${c.reset}`,
        );
      }
      console.log(line);
    });
    console.log();
  }

  // ---------- the menu loop ----------
  async startMenu() {
    const { c } = this;
    const rl = readline.createInterface({ input, output });
    const loadedFiles = [];

    this.clear();
    this.banner();

    let running = true;
    while (running) {
      this.showMenu(loadedFiles);
      const choice = (
        await rl.question(`\n  ${c.bold}Choose an option > ${c.reset}`)
      ).trim();

      try {
        switch (choice) {
          // 1. ask a question
          case "1": {
            const question = (
              await rl.question(`\n  ${c.bold}Your question > ${c.reset}`)
            ).trim();
            if (!question) break;

            const answer = await this.withSpinner("Thinking...", () =>
              this.rag.Query(question),
            );
            console.log(`\n${c.green}  Answer${c.reset}`);

            this.printAnswers(answer);
            break;
          }

          // 2. load a document
          case "2": {
            const raw = (
              await rl.question(`\n  ${c.bold}File path > ${c.reset}`)
            ).trim();
            const filePath = raw.replace(/^["']|["']$/g, "");
            if (!filePath) break;

            await this.withSpinner(`Loading ${filePath}`, () =>
              this.rag.Indexing(filePath),
            );
            loadedFiles.push(filePath.split(/[\\/]/).pop());
            console.log(
              `\n  ${c.green}✔ Loaded and indexed:${c.reset} ${filePath}`,
            );
            break;
          }

          // 3. decomposition
          case "3": {
            const q = (
              await rl.question(`\n  ${c.bold}Question > ${c.reset}`)
            ).trim();
            if (!q) break;

            const subQuestions = await this.withSpinner(
              "Splitting question...",
              () => this.rag.DecompositionQuery(q),
            );
            this.printList(
              `Decomposition (${subQuestions.length})`,
              subQuestions,
            );
            break;
          }

          // 4. enhancement
          case "4": {
            const q = (
              await rl.question(`\n  ${c.bold}Question > ${c.reset}`)
            ).trim();
            if (!q) break;

            const subQuestions = await this.withSpinner(
              "Splitting question...",
              () => this.rag.DecompositionQuery(q),
            );
            const enhanced = await this.withSpinner(
              "Enhancing queries...",
              () => this.rag.EnhanceUserQuery(subQuestions),
            );

            this.printList("Original", subQuestions);
            this.printList("Enhanced", enhanced);
            break;
          }

          // 0. exit
          case "0":
          case "exit":
          case "q":
            running = false;
            console.log(`\n  ${c.cyan}Goodbye!${c.reset}\n`);
            break;

          default:
            console.log(
              `\n  ${c.red}Invalid option. Please choose 0 to 4.${c.reset}`,
            );
        }
      } catch (error) {
        console.log(`\n  ${c.red}✖ Error:${c.reset} ${error.message}`);
      }

      if (running) {
        await rl.question(`\n  ${c.dim}Press Enter to continue...${c.reset}`);
        this.clear();
        this.banner();
      }
    }

    rl.close();
  }
}



