# Graphify × Obsidian × Personal OS

This dashboard now has a **Knowledge Graph** view that brings
[Graphify](https://github.com/safishamsi/graphify)-style features to your
Obsidian vault. There are two ways to use it — a zero-setup built-in graph, and
an optional bridge to the real Graphify CLI for deeper, LLM-powered analysis.

---

## 1. Built-in graph (no install, works offline)

The Second Brain already imports Obsidian `.md` files and captures their
`[[wiki-links]]` and `#tags`. The **Knowledge Graph** page turns that into a
live, interactive graph:

1. **Second Brain → Import .md** — select your Obsidian notes (multi-select a
   whole folder works; folder names become categories).
2. Open **Knowledge Graph** in the sidebar.
3. Explore:
   - **Nodes** = notes, colored by category, sized by how many links point to them.
   - **Edges** = resolved `[[wiki-links]]` between notes.
   - Drag to pan, scroll to zoom, **click a node to open the note**.
   - Toggle **shared-tag links** to see notes connected by common tags.

### What the report tells you (Graphify parity)

| Panel | Graphify equivalent | Use it to… |
|-------|--------------------|------------|
| **Hub Notes** | "god nodes" (highest degree) | Find the ideas everything else hangs off of |
| **Orphans** | isolated nodes | Spot notes with no links — candidates to connect or prune |
| **Broken Links** | dangling references | Find `[[links]]` whose target note doesn't exist yet |
| **Clusters** | Leiden communities | See how many distinct topic islands you have |
| **Suggested Connections** | inferred edges | Notes sharing 2+ tags that you haven't linked yet — link them in Obsidian |

This is the fast feedback loop: import → see structure → fix orphans/broken
links → re-import. No Python, no API keys, runs on GitHub Pages.

---

## 2. Bridge to the real Graphify CLI (deeper analysis)

The full Graphify tool runs locally over a *folder* and adds semantic
extraction (via an LLM), Leiden community detection, and richer reports. Point
it at your Obsidian vault, then import its output here.

```bash
# one-time install (uv recommended)
uv tool install graphify   # or: pipx install graphify

# run it over your vault
cd /path/to/your/obsidian-vault
graphify .                 # produces graphify-out/graph.json, graph.html, GRAPH_REPORT.md
```

Then in the dashboard: **Knowledge Graph → Import graph.json**, pick
`graphify-out/graph.json`. A **Graphify Import** tab appears so you can explore
its nodes/edges (colored by community) right next to your own notes graph.

The importer is tolerant of Graphify's schema:

```jsonc
{
  "nodes": [{ "id": "...", "label": "...", "type": "...", "community": 0 }],
  "edges": [{ "source": "...", "target": "...", "weight": 1 }]  // "links" also accepted
}
```

### Suggested cadence

- **Daily / on the fly:** use the built-in graph after each Obsidian import to
  catch orphans and broken links while you write.
- **Weekly review:** run the Graphify CLI on the vault for community detection
  and the `GRAPH_REPORT.md` narrative, then import `graph.json` here to browse
  it. Commit `graphify-out/` to share the snapshot.

---

## Why this makes you more efficient

- **Surfaces structure you can't see in a file list** — hubs, islands, and gaps.
- **Turns dead metadata into navigation** — wiki-links are now clickable across
  notes and the graph; orphans/broken links are actionable, not invisible.
- **Suggested connections** push you to weave notes together, which is where a
  Zettelkasten/second-brain actually compounds.
- **Backups include it** — the imported graph round-trips through
  *Export / Import Data*.

Everything stays local in `localStorage`; nothing is uploaded.
