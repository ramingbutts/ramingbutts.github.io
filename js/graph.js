// ─── KNOWLEDGE GRAPH ───
// Brings Graphify-style knowledge-graph features to the Second Brain.
// Builds a graph from imported Obsidian notes (nodes = notes, edges = [[wiki-links]]),
// renders an interactive force-directed map, and surfaces a Graphify-style report
// (hub "god" notes, orphans, broken links, clusters, suggested connections).
// Can also ingest the real graphify tool's graph.json output for exploration.

const Graph = {
  // category color name -> hex (mirrors css custom properties)
  _palette: {
    accent: '#00d4ff', purple: '#7c3aed', green: '#10b981',
    amber: '#f59e0b', pink: '#ec4899', red: '#ef4444'
  },
  _clusterColors: ['#00d4ff', '#7c3aed', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#6366f1', '#14b8a6'],

  mode: 'notes',       // 'notes' | 'imported'
  showTagEdges: false, // overlay shared-tag links
  highlight: '',       // search highlight term
  _sim: null,

  render(container) {
    const model = this.buildModel();
    container.innerHTML = `
      <div class="section">
        <div class="grid-4">
          ${this._statCard('Notes', model.nodes.length, 'var(--accent)')}
          ${this._statCard('Connections', model.edges.length, 'var(--purple)')}
          ${this._statCard('Orphans', model.orphans.length, 'var(--amber)')}
          ${this._statCard('Broken Links', model.broken.length, 'var(--red)')}
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <span class="section-title">Knowledge Graph</span>
            <input id="graph-search" type="text" placeholder="Highlight notes..." style="max-width:240px;padding:7px 12px;font-size:13px" value="${App.escAttr(this.highlight)}">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);cursor:pointer">
              <input type="checkbox" id="graph-tag-edges" ${this.showTagEdges ? 'checked' : ''} style="width:auto"> shared-tag links
            </label>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-secondary btn-sm" id="graph-reset">Re-layout</button>
            <button class="btn btn-secondary btn-sm" id="graph-import">Import graph.json</button>
            <input type="file" id="graphify-file" accept=".json" style="display:none">
            <a class="btn btn-ghost btn-sm" href="#/brain">Second Brain &rarr;</a>
          </div>
        </div>
        ${this._sourceTabs()}
        <div class="card" style="padding:0;overflow:hidden;position:relative">
          <canvas id="graph-canvas" style="display:block;width:100%;height:560px;cursor:grab"></canvas>
          <div id="graph-legend" style="position:absolute;top:10px;left:12px;font-size:11px;color:var(--text-secondary);pointer-events:none"></div>
          <div id="graph-hint" style="position:absolute;bottom:10px;right:12px;font-size:11px;color:var(--text-muted);pointer-events:none">drag to pan · scroll to zoom · click a node to open</div>
        </div>
      </div>

      <div class="section">
        <div class="grid-2">
          ${this._reportPanel(model)}
          ${this._suggestionsPanel(model)}
        </div>
      </div>
    `;

    this._wireControls(model);
    this._startSim(model);
  },

  _sourceTabs() {
    const imported = Storage.get('graph_imported');
    if (!imported) return '';
    return `
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="btn btn-sm ${this.mode === 'notes' ? 'btn-primary' : 'btn-secondary'}" id="src-notes">My Notes</button>
        <button class="btn btn-sm ${this.mode === 'imported' ? 'btn-primary' : 'btn-secondary'}" id="src-imported">Graphify Import (${(imported.nodes || []).length})</button>
      </div>`;
  },

  _statCard(label, value, color) {
    return `<div class="card">
      <div class="card-title">${label}</div>
      <div class="card-value" style="margin-top:8px;color:${color}">${value}</div>
    </div>`;
  },

  // ─── MODEL BUILDING ───
  buildModel() {
    if (this.mode === 'imported') {
      const imp = Storage.get('graph_imported');
      if (imp) return this._modelFromImport(imp);
      this.mode = 'notes';
    }
    return this._modelFromNotes();
  },

  _modelFromNotes() {
    const notes = Storage.get('brain_notes') || [];
    const categories = Storage.get('brain_categories') || [];
    const catColor = {};
    categories.forEach(c => { catColor[c.id] = this._palette[c.color] || '#64748b'; });

    const byTitle = {};
    notes.forEach(n => { byTitle[(n.title || '').toLowerCase().trim()] = n.id; });

    const nodes = notes.map(n => ({
      id: n.id,
      title: n.title || 'Untitled',
      tags: n.tags || [],
      color: n.categoryId ? (catColor[n.categoryId] || '#64748b') : '#64748b',
      deg: 0
    }));
    const nodeById = {};
    nodes.forEach(nd => { nodeById[nd.id] = nd; });

    const edgeSet = new Set();
    const edges = [];
    const broken = [];
    const addEdge = (s, t, type) => {
      if (s === t) return;
      const key = [s, t].sort().join('|') + '|' + type;
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      edges.push({ s, t, type });
      // only wiki-links count toward degree, so node sizes, hubs and orphan
      // detection stay stable whether or not the shared-tag overlay is on
      if (type === 'link') {
        if (nodeById[s]) nodeById[s].deg++;
        if (nodeById[t]) nodeById[t].deg++;
      }
    };

    notes.forEach(n => {
      (n.wikiLinks || []).forEach(link => {
        const key = this._linkKey(link);
        if (!key) return; // bare same-note #heading / ^block reference
        const targetId = byTitle[key];
        if (targetId) addEdge(n.id, targetId, 'link');
        else broken.push({ from: n.id, fromTitle: n.title, link });
      });
    });

    // candidate pairs sharing >=1 tag, via an inverted tag index — avoids a
    // full O(n^2) scan over the whole vault for both the overlay and suggestions
    const tagPairs = this._tagPairCounts(notes);

    // shared-tag edges (overlay)
    if (this.showTagEdges) {
      tagPairs.forEach((count, pairKey) => {
        const [i, j] = pairKey.split('|').map(Number);
        addEdge(notes[i].id, notes[j].id, 'tag');
      });
    }

    const orphans = nodes.filter(n => n.deg === 0);
    const hubs = [...nodes].filter(n => n.deg > 0).sort((a, b) => b.deg - a.deg).slice(0, 6);
    const clusters = this._components(nodes, edges);
    const suggestions = this._suggestConnections(notes, tagPairs, edgeSet);

    return { nodes, edges, broken, orphans, hubs, clusters, suggestions, nodeById, source: 'notes' };
  },

  _modelFromImport(imp) {
    const rawNodes = imp.nodes || [];
    const rawEdges = imp.edges || imp.links || [];
    const nodes = rawNodes.map((n, i) => ({
      id: String(n.id != null ? n.id : i),
      title: n.label || n.name || n.title || String(n.id),
      tags: n.tags || (n.type ? [n.type] : []),
      community: n.community != null ? n.community : (n.cluster != null ? n.cluster : null),
      color: '#64748b',
      deg: 0
    }));
    const nodeById = {};
    nodes.forEach(nd => { nodeById[nd.id] = nd; });

    const edges = [];
    const edgeSet = new Set();
    rawEdges.forEach(e => {
      const s = String(e.source != null ? e.source : (e.s != null ? e.s : e.from));
      const t = String(e.target != null ? e.target : (e.t != null ? e.t : e.to));
      if (s == null || t == null || s === t || !nodeById[s] || !nodeById[t]) return;
      const key = [s, t].sort().join('|');
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      edges.push({ s, t, type: 'link' });
      nodeById[s].deg++; nodeById[t].deg++;
    });

    // color by community if present, else by component
    const clusters = this._components(nodes, edges);
    nodes.forEach(n => {
      const c = n.community != null ? n.community : null;
      n.color = this._clusterColors[((c != null ? c : 0) | 0) % this._clusterColors.length];
    });
    if (nodes.every(n => n.community == null)) {
      clusters.forEach((comp, idx) => {
        const col = this._clusterColors[idx % this._clusterColors.length];
        comp.forEach(id => { if (nodeById[id]) nodeById[id].color = col; });
      });
    }

    const orphans = nodes.filter(n => n.deg === 0);
    const hubs = [...nodes].filter(n => n.deg > 0).sort((a, b) => b.deg - a.deg).slice(0, 6);
    return { nodes, edges, broken: [], orphans, hubs, clusters, suggestions: [], nodeById, source: 'imported' };
  },

  // union-find connected components over link edges
  _components(nodes, edges) {
    const parent = {};
    nodes.forEach(n => { parent[n.id] = n.id; });
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { parent[find(a)] = find(b); };
    edges.forEach(e => { if (e.type === 'link') union(e.s, e.t); });
    const groups = {};
    nodes.forEach(n => { const r = find(n.id); (groups[r] = groups[r] || []).push(n.id); });
    return Object.values(groups).filter(g => g.length > 1).sort((a, b) => b.length - a.length);
  },

  // strip Obsidian heading/block fragments ([[Note#Heading]], [[Note^block]])
  // and normalise so links resolve to the target note's title
  _linkKey(link) {
    return (link || '').split(/[#^]/)[0].toLowerCase().trim();
  },

  // count shared tags per note pair using an inverted index (tag -> note indices)
  _tagPairCounts(notes) {
    const tagMap = new Map();
    notes.forEach((n, i) => (n.tags || []).forEach(t => {
      if (!tagMap.has(t)) tagMap.set(t, []);
      tagMap.get(t).push(i);
    }));
    const pairCount = new Map();
    tagMap.forEach(list => {
      for (let a = 0; a < list.length; a++) {
        for (let b = a + 1; b < list.length; b++) {
          const key = list[a] < list[b] ? list[a] + '|' + list[b] : list[b] + '|' + list[a];
          pairCount.set(key, (pairCount.get(key) || 0) + 1);
        }
      }
    });
    return pairCount;
  },

  // notes sharing >=2 tags but not yet linked (pairCount value = shared tag count)
  _suggestConnections(notes, tagPairs, edgeSet) {
    const out = [];
    tagPairs.forEach((count, pairKey) => {
      if (count < 2) return;
      const [i, j] = pairKey.split('|').map(Number);
      const linked = edgeSet.has([notes[i].id, notes[j].id].sort().join('|') + '|link');
      if (linked) return;
      const shared = (notes[i].tags || []).filter(t => (notes[j].tags || []).includes(t));
      out.push({ a: notes[i].title, b: notes[j].title, shared, score: shared.length });
    });
    return out.sort((x, y) => y.score - x.score).slice(0, 8);
  },

  // ─── REPORT PANELS ───
  _reportPanel(model) {
    const row = (label, value, color) =>
      `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
        <span style="color:var(--text-secondary)">${label}</span><span style="color:${color || 'var(--text)'};font-weight:600">${value}</span></div>`;
    const density = model.nodes.length > 1
      ? (2 * model.edges.length / (model.nodes.length * (model.nodes.length - 1)) * 100).toFixed(1) + '%'
      : '0%';

    return `<div>
      <div class="section-header"><span class="section-title">Graph Report</span></div>
      <div class="card">
        ${row('Nodes', model.nodes.length)}
        ${row('Edges', model.edges.length)}
        ${row('Clusters', model.clusters.length, 'var(--purple)')}
        ${row('Connected', model.nodes.length - model.orphans.length, 'var(--green)')}
        ${row('Density', density, 'var(--accent)')}
        <div style="margin-top:14px;font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Hub Notes (god nodes)</div>
        ${model.hubs.length ? model.hubs.map(h => `
          <div class="graph-jump" data-nid="${App.escAttr(h.id)}" style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;cursor:pointer">
            <span>${this._esc(h.title)}</span><span class="badge badge-accent">${h.deg} links</span>
          </div>`).join('') : '<div style="padding:8px 0;font-size:12px;color:var(--text-muted)">No connections yet — add [[wiki-links]] between notes.</div>'}
      </div>
    </div>`;
  },

  _suggestionsPanel(model) {
    const brokenHtml = model.broken.length ? `
      <div style="margin-top:14px;font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Broken Links</div>
      ${model.broken.slice(0, 8).map(b => `
        <div style="padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span style="color:var(--text-secondary)">${this._esc(b.fromTitle)}</span>
          <span style="color:var(--text-muted)"> &rarr; </span>
          <span style="color:var(--red)">[[${this._esc(b.link)}]]</span>
        </div>`).join('')}` : '';

    const orphanHtml = model.orphans.length ? `
      <div style="margin-top:14px;font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Orphan Notes</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
        ${model.orphans.slice(0, 12).map(o => `<span class="badge badge-amber graph-jump" data-nid="${App.escAttr(o.id)}" style="cursor:pointer">${this._esc(o.title)}</span>`).join('')}
      </div>` : '';

    const suggHtml = model.suggestions.length ? model.suggestions.map(s => `
      <div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
        <div><span>${this._esc(s.a)}</span> <span style="color:var(--accent)">&harr;</span> <span>${this._esc(s.b)}</span></div>
        <div style="margin-top:3px">${s.shared.map(t => `<span class="badge badge-purple">${this._esc(t)}</span>`).join(' ')}</div>
      </div>`).join('') : '<div style="padding:8px 0;font-size:12px;color:var(--text-muted)">No suggestions — notes need 2+ shared tags.</div>';

    return `<div>
      <div class="section-header"><span class="section-title">Suggested Connections</span></div>
      <div class="card">
        ${model.source === 'imported' ? '<div style="font-size:12px;color:var(--text-muted)">Suggestions apply to your own notes. Switch to "My Notes" to see them.</div>' : suggHtml}
        ${orphanHtml}
        ${brokenHtml}
      </div>
    </div>`;
  },

  // ─── CONTROLS ───
  _wireControls(model) {
    const search = document.getElementById('graph-search');
    let debounce;
    search.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => { this.highlight = search.value.trim().toLowerCase(); this._draw(); }, 150);
    });

    document.getElementById('graph-tag-edges').addEventListener('change', (e) => {
      this.showTagEdges = e.target.checked;
      this.render(document.getElementById('page-content'));
    });
    document.getElementById('graph-reset').addEventListener('click', () => this.render(document.getElementById('page-content')));
    document.getElementById('graph-import').addEventListener('click', () => document.getElementById('graphify-file').click());
    document.getElementById('graphify-file').addEventListener('change', (e) => { this._importGraphify(e.target.files[0]); e.target.value = ''; });

    const srcNotes = document.getElementById('src-notes');
    const srcImp = document.getElementById('src-imported');
    if (srcNotes) srcNotes.addEventListener('click', () => { this.mode = 'notes'; this.render(document.getElementById('page-content')); });
    if (srcImp) srcImp.addEventListener('click', () => { this.mode = 'imported'; this.render(document.getElementById('page-content')); });

    document.querySelectorAll('.graph-jump').forEach(el => {
      el.addEventListener('click', () => this._openNode(model, el.dataset.nid));
    });

    // legend by color
    const legend = document.getElementById('graph-legend');
    if (model.source === 'notes') {
      const cats = Storage.get('brain_categories') || [];
      legend.innerHTML = cats.map(c => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:10px"><span style="width:8px;height:8px;border-radius:50%;background:${this._palette[c.color] || '#64748b'};display:inline-block"></span>${this._esc(c.name)}</span>`).join('');
    } else {
      legend.innerHTML = '<span style="color:var(--text-muted)">colored by community</span>';
    }
  },

  _openNode(model, id) {
    if (model.source === 'notes' && App.pages.brain) {
      App.pages.brain._viewNote(id);
    } else {
      const n = model.nodeById[id];
      if (!n) return;
      App.openModal(n.title, `
        <div style="font-size:13px;line-height:1.7">
          <div><span style="color:var(--text-secondary)">Connections:</span> ${n.deg}</div>
          ${n.tags && n.tags.length ? `<div style="margin-top:8px">${n.tags.map(t => `<span class="badge badge-accent">${this._esc(t)}</span>`).join(' ')}</div>` : ''}
        </div>
        <div class="modal-actions"><button class="btn btn-secondary" onclick="App.closeModal()">Close</button></div>`);
    }
  },

  _importGraphify(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.nodes || !Array.isArray(data.nodes)) throw new Error('no nodes array');
        Storage.set('graph_imported', { nodes: data.nodes, edges: data.edges || data.links || [] });
        this.mode = 'imported';
        App.toast(`Imported graphify graph: ${data.nodes.length} nodes`, 'success');
        this.render(document.getElementById('page-content'));
      } catch (err) {
        App.toast('Invalid graph.json — expected { nodes, edges }', 'error');
      }
    };
    reader.readAsText(file);
  },

  // ─── FORCE SIMULATION + CANVAS ───
  _startSim(model) {
    const canvas = document.getElementById('graph-canvas');
    if (!canvas) return;
    if (this._sim && this._sim.raf) cancelAnimationFrame(this._sim.raf);

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();

    const W = canvas.width / dpr, H = canvas.height / dpr;
    const nodes = model.nodes;
    const cx = W / 2, cy = H / 2;
    nodes.forEach((n, i) => {
      const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
      n.x = cx + Math.cos(a) * (60 + (i % 7) * 30);
      n.y = cy + Math.sin(a) * (60 + (i % 7) * 30);
      n.vx = 0; n.vy = 0; n.r = 4 + Math.min(14, n.deg * 1.6);
    });

    const sim = {
      canvas, ctx: canvas.getContext('2d'), dpr, model, nodes,
      view: { x: 0, y: 0, scale: 1 },
      alpha: 1, hoverId: null, dragNode: null, panning: false,
      lastX: 0, lastY: 0, downX: 0, downY: 0, moved: false, raf: null
    };
    this._sim = sim;

    const tick = () => {
      // the router renders pages without an unmount hook; stop the loop once the
      // canvas has been replaced (navigated away) so it doesn't run in the background
      if (!document.body.contains(canvas)) { sim.raf = null; return; }
      if (sim.alpha > 0.005 && !sim.dragNode) {
        this._physics(sim, W, H);
        sim.alpha *= 0.96;
      }
      this._draw();
      sim.raf = requestAnimationFrame(tick);
    };

    this._bindCanvas(sim);
    tick();
  },

  _physics(sim, W, H) {
    const nodes = sim.nodes, edges = sim.model.edges;
    const k = 0.02, rep = 1400, ideal = 70, center = 0.008;
    const cx = W / 2, cy = H / 2;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy || 0.01;
        const d = Math.sqrt(d2);
        const f = rep / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      a.vx += (cx - a.x) * center;
      a.vy += (cy - a.y) * center;
    }

    edges.forEach(e => {
      const a = sim.model.nodeById[e.s], b = sim.model.nodeById[e.t];
      if (!a || !b) return;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d - ideal) * k;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    });

    nodes.forEach(n => {
      if (n === sim.dragNode) return;
      n.vx *= 0.85; n.vy *= 0.85;
      n.x += Math.max(-20, Math.min(20, n.vx * sim.alpha));
      n.y += Math.max(-20, Math.min(20, n.vy * sim.alpha));
    });
  },

  _draw() {
    const sim = this._sim;
    if (!sim) return;
    const { ctx, dpr, view, model } = sim;
    const W = sim.canvas.width, H = sim.canvas.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.scale, view.scale);

    const hl = this.highlight;
    const hover = sim.hoverId;
    const neighbors = new Set();
    if (hover) {
      model.edges.forEach(e => {
        if (e.s === hover) neighbors.add(e.t);
        if (e.t === hover) neighbors.add(e.s);
      });
    }

    // edges
    model.edges.forEach(e => {
      const a = model.nodeById[e.s], b = model.nodeById[e.t];
      if (!a || !b) return;
      const active = hover && (e.s === hover || e.t === hover);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = active ? 'rgba(0,212,255,0.7)' : (e.type === 'tag' ? 'rgba(124,58,237,0.18)' : 'rgba(120,130,160,0.22)');
      ctx.lineWidth = (active ? 1.6 : 0.7) / view.scale;
      if (e.type === 'tag') ctx.setLineDash([3, 3]); else ctx.setLineDash([]);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    // nodes
    model.nodes.forEach(n => {
      const isHover = n.id === hover;
      const isNeighbor = neighbors.has(n.id);
      const match = hl && n.title.toLowerCase().includes(hl);
      const dim = (hover && !isHover && !isNeighbor) || (hl && !match);
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.globalAlpha = dim ? 0.18 : 1;
      ctx.fill();
      if (match || isHover) {
        ctx.lineWidth = 2 / view.scale;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // labels: hubs, hover, neighbors, matches — or all when zoomed in
      if (isHover || isNeighbor || match || n.r > 9 || view.scale > 1.6) {
        ctx.globalAlpha = dim ? 0.3 : 1;
        ctx.fillStyle = '#cbd5e1';
        ctx.font = `${11 / view.scale}px Inter, sans-serif`;
        ctx.fillText(n.title.length > 24 ? n.title.slice(0, 24) + '…' : n.title, n.x + n.r + 3, n.y + 3);
        ctx.globalAlpha = 1;
      }
    });

    ctx.restore();

    if (!model.nodes.length) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No notes yet — import Obsidian notes in Second Brain to grow your graph.', (W / dpr) / 2, (H / dpr) / 2);
      ctx.textAlign = 'left';
    }
  },

  _bindCanvas(sim) {
    const canvas = sim.canvas;
    const toGraph = (mx, my) => ({
      x: (mx - sim.view.x) / sim.view.scale,
      y: (my - sim.view.y) / sim.view.scale
    });
    const pick = (mx, my) => {
      const p = toGraph(mx, my);
      let hit = null, best = Infinity;
      sim.nodes.forEach(n => {
        const dx = n.x - p.x, dy = n.y - p.y, d = dx * dx + dy * dy;
        const rr = (n.r + 4) * (n.r + 4);
        if (d < rr && d < best) { best = d; hit = n; }
      });
      return hit;
    };
    const rel = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    canvas.addEventListener('mousedown', (e) => {
      const { x, y } = rel(e);
      sim.downX = x; sim.downY = y; sim.moved = false;
      const hit = pick(x, y);
      if (hit) { sim.dragNode = hit; sim.alpha = Math.max(sim.alpha, 0.3); }
      else { sim.panning = true; canvas.style.cursor = 'grabbing'; }
      sim.lastX = x; sim.lastY = y;
    });

    canvas.addEventListener('mousemove', (e) => {
      const { x, y } = rel(e);
      if (Math.abs(x - sim.downX) + Math.abs(y - sim.downY) > 4) sim.moved = true;
      if (sim.dragNode) {
        const p = toGraph(x, y);
        sim.dragNode.x = p.x; sim.dragNode.y = p.y;
        sim.dragNode.vx = 0; sim.dragNode.vy = 0;
      } else if (sim.panning) {
        sim.view.x += x - sim.lastX;
        sim.view.y += y - sim.lastY;
      } else {
        const hit = pick(x, y);
        const newHover = hit ? hit.id : null;
        if (newHover !== sim.hoverId) { sim.hoverId = newHover; canvas.style.cursor = hit ? 'pointer' : 'grab'; }
      }
      sim.lastX = x; sim.lastY = y;
    });

    const endDrag = () => {
      if (sim.dragNode && !sim.moved) this._openNode(sim.model, sim.dragNode.id);
      else if (sim.panning && !sim.moved) { /* background click */ }
      sim.dragNode = null; sim.panning = false;
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', () => { sim.dragNode = null; sim.panning = false; sim.hoverId = null; });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const { x, y } = rel(e);
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.2, Math.min(5, sim.view.scale * factor));
      // zoom toward cursor
      sim.view.x = x - (x - sim.view.x) * (newScale / sim.view.scale);
      sim.view.y = y - (y - sim.view.y) * (newScale / sim.view.scale);
      sim.view.scale = newScale;
    }, { passive: false });
  },

  _esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
};

App.registerPage('graph', Graph);
