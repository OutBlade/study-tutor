# Study Tutor SS2026

An Electron desktop app for studying all 7 SS2026 exams at KIT (ETIT). Each module gets its own AI tutor powered by Claude, with support for PDF materials, LaTeX rendering, image upload, and exam-style quiz generation.

## Features

- Dashboard with live countdown tiles for all 7 exams
- Per-module AI tutor (Claude claude-sonnet-4-6) with streamed responses
- Upload PDFs as study material — text is extracted and sent as context with prompt caching
- LaTeX rendering via KaTeX (`$...$` inline, `$$...$$` block)
- Markdown rendering including tables, code blocks, and math-heavy content
- Image upload, paste (Ctrl+V), and drag-and-drop onto the chat
- Exam quiz generator (5 questions from your materials)
- Conversation history persisted per module
- API key stored encrypted via Electron safeStorage (Windows DPAPI)

## Modules

| Module | Exam date |
|---|---|
| IAT Praktikum | 25.06.2026 |
| IAT | 08.07.2026 |
| HM II | 25.07.2026 |
| EET | 29.07.2026 |
| HM III | 08.08.2026 |
| ES Workshop | 26.08.2026 |
| ES | 08.09.2026 |

## Setup

```bash
git clone https://github.com/OutBlade/study-tutor
cd study-tutor
npm install
npm start
```

On first launch, open **Einstellungen** and paste your [Anthropic API key](https://console.anthropic.com/). The key is stored encrypted on disk and never leaves your machine in plaintext.

## Tech stack

- [Electron](https://electronjs.org/) 33
- [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-node) with streaming + prompt caching
- [pdfjs-dist](https://github.com/mozilla/pdf.js) for PDF text extraction
- [KaTeX](https://katex.org/) for LaTeX
- [marked](https://marked.js.org/) for Markdown
