# Vendored character models

Level 1 loads its textured "AAA" characters **local-first**: it tries these
files, then falls back to the media CDN, then to the built-in primitive rigs
(which are fully playable on their own). Dropping the GLBs here makes the
textured meshes load offline and on GitHub Pages with no code change — the same
"no CDN dependency, works offline" principle the rest of the game follows.

Expected files (referenced by `MODELS` in `../level1.js`):

- `jax.glb` — the gun-toting unicorn janitor (target height ~2.05m, facing +Z)
- `zombie.glb` — the rainbow poop-golem zombie (target height ~1.95m, facing +Z)

Both are normalized at runtime (scaled to target height, centered, feet planted
at y=0). If a mesh comes out facing away, press **Shift+R** in-game to re-face it
and the muzzle re-derives from the new orientation automatically.

To vendor: export/download each GLB and commit it here with the exact filename
above. No other change is needed — reload the page and the console logs
`Jax: loaded vendored models/jax.glb`.
