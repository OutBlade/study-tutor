<div align="center">

# Study Tutor SS2026

**An Electron desktop app that puts a Claude AI tutor on every exam.**

[![Electron](https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white)](https://electronjs.org)
[![Claude](https://img.shields.io/badge/Claude-Sonnet%204.6-D97757?style=flat-square)](https://anthropic.com)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square&logo=windows&logoColor=white)](https://github.com/OutBlade/study-tutor)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

</div>

---

## What it does

Upload PDFs from your ILIAS course. Ask questions. Get step-by-step solutions with full LaTeX math rendering. Generate 5 exam-style questions at any time. All conversations persist per module and your API key is encrypted on disk.

---

## Exams

| Module | Date |
|---|---|
| IAT Praktikum | 25.06.2026 |
| IAT | 08.07.2026 |
| HM II | 25.07.2026 |
| EET | 29.07.2026 |
| HM III | 08.08.2026 |
| ES Workshop | 26.08.2026 |
| ES | 08.09.2026 |

---

## Features

**AI tutor per module**
Each module has its own conversation history and its own context window. Upload lecture slides or exercise sheets as PDF — the text is extracted and sent with every request using Anthropic prompt caching, so repeated questions on the same material cost almost nothing in tokens.

**LaTeX rendering**
Inline `$...$` and display `$$...$$` math renders via KaTeX. Differential equations, linear algebra, integrals — all typeset properly in the chat.

**Image support**
Paste a screenshot directly with Ctrl+V, drag an image onto the text field, or click the attach button. Useful for photographed handwritten notes or screenshots of ILIAS exercise PDFs.

**Exam quiz generator**
One click generates 5 exam-style questions from your uploaded materials. Claude constructs the questions from the actual content, not generic templates.

**Secure key storage**
Your Anthropic API key is encrypted with Windows DPAPI via Electron safeStorage. It is never stored in plaintext and never leaves your machine.

---

## Setup

```
git clone https://github.com/OutBlade/study-tutor
cd study-tutor
npm install
npm start
```

On first launch click **Einstellungen** in the top-right corner and paste your [Anthropic API key](https://console.anthropic.com/). The key is encrypted immediately on save.

---

## Tech stack

| | |
|---|---|
| Runtime | Electron 33 |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) — streaming, prompt caching |
| PDF extraction | pdfjs-dist (Mozilla PDF.js, legacy Node build) |
| Math | KaTeX |
| Markdown | marked |
| Key storage | Electron safeStorage (Windows DPAPI) |
| Persistence | JSON files in `%APPDATA%\study-tutor\` |

---

<div align="center">
Built for KIT ETIT SS2026
</div>
