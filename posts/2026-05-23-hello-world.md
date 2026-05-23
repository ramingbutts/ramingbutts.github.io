title: Hello World
date: 2026-05-23

---

This is the first post. It was written in plain Markdown and
turned into HTML by a shell script.

## How it works

Each post is a `.md` file with a small header (title, date)
separated from the body by `---`. The build script:

1. Reads the header to extract metadata
2. Converts the Markdown body to HTML through `sed` transforms
3. Pipes the result into a template

No dependencies. No magic. Just text in, text out.

## Why the Unix way?

- **Do one thing well** — each file has one job
- **Text streams** — data flows through pipelines
- **Composability** — swap any piece without breaking the rest
- **Simplicity** — you can read every line of the build script
