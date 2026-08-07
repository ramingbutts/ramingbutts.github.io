# Character models — drop them here

Both levels look in this folder **first**, before falling back to a remote URL:

| file | who |
|---|---|
| `jax.glb` | the player |
| `zombie.glb` | every enemy (tinted per kind at runtime) |

The names matter. `level1.js` and `level2.js` both ask for exactly
`models/jax.glb` and `models/zombie.glb`, so a file dropped here with the right
name is picked up with no code change at all.

## Why this folder exists

The game currently loads both characters from a content-delivery URL. That has
already failed once: an earlier pair of URLs started returning 403 and the game
silently swapped in crude block stand-ins, shipping placeholder art to everyone
for an unknown number of builds before anybody noticed. The URLs in the code now
work, but they can expire the same way.

A file committed here cannot expire. It is the permanent fix, and it is why
`local:` is checked before `url:` in the loader.

## Format

`.glb` (or `.gltf` with its assets alongside) — the game uses three.js's
`GLTFLoader`. `.fbx`, `.obj` and `.blend` will **not** load as-is.

Keep them reasonably sized; they are downloaded by every player on first load.
The current pair are roughly 5 MB and 4 MB.

## How to check it worked

Load the level and press **P**. The CHARACTERS row reads `3D`. Hit
**COPY DIAGNOSTIC REPORT** and it will say `jax:local zombie:local` — `local`
means it used this folder, `cdn` means it fell through to the remote URL, and
`failed` means neither worked and you are looking at the block rig. If anything
failed, the build stamp in the corner also reads `PLACEHOLDER ART`.
