# ZeroStructureMask

<!-- TINS Specification v1.0 -->
<!-- ZS:COMPLEXITY:HIGH -->
<!-- ZS:PRIORITY:HIGH -->
<!-- ZS:PLATFORM:WEB -->
<!-- ZS:LANGUAGE:JAVASCRIPT -->
<!-- ZS:FAMILY:ZeroBytes · Zero-Field · Zero-Graph · Zero-Quad -->

---

## Description

**ZeroStructureMask** is a deterministic void-pocket system integrated directly into the KochMegastructure V3 ZeroFamily engine. It punches axis-aligned holes into the infinite 3D Koch megastructure topology so that large Points of Interest (POI) — low-poly `.glb`/`.gltf` structures — can occupy their reserved world-space volumes without geometry clipping through them.

The system operates entirely O(1): given any world-space cell coordinate `(cx, cy, cz)`, the engine can determine in constant time whether that cell falls inside a mask zone, without consulting any stored map or list. Every mask is derived from the same ZeroBytes `posHash` / `h32mix` pipeline already present in the megastructure, so the mask is as infinite and seamless as the world itself.

A **Structure Site** is a POI anchor registered by its cell coordinate. The mask system subtracts a configurable void pocket around that anchor — suppressing Koch panel generation inside the pocket — and renders a diamond-shaped BSP placeholder mesh in its place until a real `.glb`/`.gltf` model is provided. When a model is present, neither placeholder nor Koch panels are rendered, leaving only the imported mesh inside a clean void.

The system is designed to be a drop-in addition to `KochMegastructureV3.jsx`. It does not alter any existing generation functions; it only gates `buildCellMesh` with an early-exit check and adds a second mesh layer for placeholders.

---

## Functionality

### Core Features

1. **Deterministic Site Detection** — Given any `(cx, cy, cz)`, compute `isSiteMask(cx, cy, cz)` in O(1) using ZeroBytes hash. Returns `{ isMask: bool, isAnchor: bool, siteId: number }`.

2. **Void Pocket** — Site anchors suppress Koch mesh generation within a configurable rectangular-prism radius `(MX, MY, MZ)` in cell-space. Default radius: `MX=2, MY=1, MZ=2` (so a 5×3×5 cell block is hollowed out per site).

3. **BSP Diamond Placeholder** — When an anchor cell is visible and no model is loaded for that `siteId`, render a large diamond-shaped octahedron BSP mesh at the anchor's world centre. Scale ≈ `CELL × 1.4` on the long axis. Colour: emissive amber `#ff8800` wireframe overlay on a dark solid, matching megastructure HUD palette.

4. **Model Slot** — Each site holds an optional `modelUrl: string | null`. When non-null, the system loads the `.glb`/`.gltf` at that URL (via `THREE.GLTFLoader` or equivalent), positions it at the anchor world centre, and suppresses the placeholder. The void pocket remains active regardless.

5. **Mask Transition Blend** — Cells at the boundary of the pocket (distance = radius) receive a smooth Koch suppression blend so that megastructure panels fade out at the edge rather than cutting abruptly. Blend function: `smoothstep(radius, radius-1, dist)` applied to panel scale before pushing vertices.

6. **HUD Integration** — When the camera is inside or adjacent to a mask zone, the HUD shows `SITE #N · VOID POCKET` in place of or alongside the biome label. Site count is displayed at lower-right.

7. **Infinite Scalability** — The site registry is a static JavaScript array defined at startup. Adding more sites requires only adding entries to `STRUCTURE_SITES`. No spatial index or quadtree is required for small-to-medium site counts (< 256); for larger counts the spec includes an optional uniform grid bucketing pass.

### Site Definition Schema

```javascript
// One entry per Point of Interest
{
  id:        number,   // Unique integer ID, 0-indexed
  cx:        number,   // Anchor cell X (integer, any range)
  cy:        number,   // Anchor cell Y (integer, any range)
  cz:        number,   // Anchor cell Z (integer, any range)
  radiusX:   number,   // Half-width of void in cells (default 2)
  radiusY:   number,   // Half-height of void in cells (default 1)
  radiusZ:   number,   // Half-depth of void in cells (default 2)
  modelUrl:  string | null,  // Path to .glb/.gltf or null for placeholder
  label:     string,   // Display name shown in HUD e.g. "NEXUS GATE ALPHA"
}
```

### Void Pocket Logic (per cell)

```
For cell (cx, cy, cz), for each site S in STRUCTURE_SITES:
  dx = |cx - S.cx|
  dy = |cy - S.cy|
  dz = |cz - S.cz|
  if dx <= S.radiusX AND dy <= S.radiusY AND dz <= S.radiusZ:
    → cell is MASKED (do not generate Koch panels)
    if dx == 0 AND dy == 0 AND dz == 0:
      → cell is ANCHOR (render placeholder or model)
    else:
      → cell is POCKET (render nothing — void space)
```

### Mesh Layout

```
  World cell grid view (top-down, Y slice, radius 2×2):

  [ ][ ][ ][ ][ ]
  [ ][M][M][M][ ]
  [ ][M][A][M][ ]   A = Anchor cell (placeholder/model)
  [ ][M][M][M][ ]   M = Masked pocket cell (void, no Koch)
  [ ][ ][ ][ ][ ]   [ ] = Normal Koch megastructure cell
```

### BSP Diamond Placeholder Geometry

The placeholder is a regular octahedron (6 vertices, 8 triangular faces) centred at the anchor's world-space midpoint:

```
  Top vertex:    (0,  +H, 0)
  Bottom vertex: (0,  -H, 0)
  Belt 4 verts:  (±R, 0,  0), (0,  0, ±R)

  H = STRIDE * 0.65   (vertical half-extent)
  R = STRIDE * 0.55   (equatorial radius)
  STRIDE = CELL + GAP = 608 units (from megastructure constants)
```

Rendered as:
- **Solid pass**: dark `#0a0a14` fill, depth-write enabled, subtle transparency 0.85
- **Wire pass**: amber `#ff8800` wireframe overlay, additive-ish, emissive feel
- Normals computed per-face (flat shading matches megastructure aesthetic)
- No Koch displacement applied; the placeholder is a clean geometric primitive

### HUD Additions

```
  Existing HUD (right column):
  ┌────────────────────────┐
  │ POS  x · y · z        │
  │ CELL cx,cy,cz          │
  │ BIOME INDUSTRIAL   ←── │ replaced by SITE label when inside pocket
  │ 320K POLYS · 42 CELLS  │
  │ DRAW 3                 │
  │ ─────────────────────  │  ← new divider
  │ SITES  3               │  ← total site count
  │ NEAREST  NEXUS ALPHA   │  ← label of closest site
  └────────────────────────┘
```

---

## Technical Implementation

### Architecture Overview

ZeroStructureMask is implemented as a **self-contained module** that wraps the existing `buildCellMesh` function and the existing render loop in `KochMegastructureV3.jsx`. No existing function bodies are modified; the module inserts before and after hooks.

```
┌──────────────────────────────────────────────────────────┐
│  KochMegastructureV3.jsx  (existing, unmodified)         │
│                                                          │
│  posHash / h32mix / coherent / scalarField  ─────────┐  │
│  cellSolid / buildCellMesh                  ─────────┤  │
│  render loop → getCell → buildCellMesh      ─────────┤  │
└──────────────────────────────────────────────────────────┘
         ↑ wrap / hook
┌──────────────────────────────────────────────────────────┐
│  ZeroStructureMask module  (new, inserted inline)        │
│                                                          │
│  STRUCTURE_SITES[]          site registry                │
│  querySiteMask(cx,cy,cz)    O(1) or O(N_sites) lookup   │
│  buildAnchorMesh(site)      octahedron BSP builder       │
│  anchorCache Map            GL buffer cache per siteId   │
│  loadModel(site)            async GLB loader (optional)  │
│  patchedGetCell(cx,cy,cz,lod)  wraps existing getCell   │
│  renderSiteLayer()          draws placeholders/models    │
└──────────────────────────────────────────────────────────┘
```

### Integration Points in KochMegastructureV3.jsx

**Point 1 — Constants block** (after `const WORLD_SEED=...`):
Insert the site registry and mask constants.

**Point 2 — `buildCellMesh` function** (existing function):
Add an early-return guard at the very top of the function body.

**Point 3 — Render loop** (inside `frame` function, after the Koch cell draw loop):
Add a second draw pass for anchor placeholder meshes.

**Point 4 — HUD update block** (inside the `Math.floor(ts/150)` throttle):
Add site HUD lines.

**Point 5 — Cleanup** (`return()=>` teardown):
Delete anchor GL buffers.

---

### Step-by-Step Implementation

---

#### STEP 1 — Add Site Registry and Mask Constants

Insert immediately after the existing constants block (after `const BIOME_PROPS=[...]`):

```javascript
// ═══════════════════════════════════════════════════════════════════════
// ZERO STRUCTURE MASK — Site Registry
// ═══════════════════════════════════════════════════════════════════════

const STRUCTURE_SITES = [
  // Example sites — replace/extend with real POI coordinates
  { id: 0, cx:  4, cy: 0, cz:  4, radiusX: 2, radiusY: 1, radiusZ: 2, modelUrl: null, label: 'NEXUS GATE ALPHA'   },
  { id: 1, cx: -6, cy: 1, cz:  2, radiusX: 2, radiusY: 1, radiusZ: 2, modelUrl: null, label: 'TRANSIT SHARD BETA' },
  { id: 2, cx:  0, cy:-1, cz: -8, radiusX: 3, radiusY: 2, radiusZ: 3, modelUrl: null, label: 'CATHEDRAL VOID'     },
];

// Mask query — O(N_sites). For > 256 sites, switch to uniform-grid bucket.
// Returns { masked: bool, isAnchor: bool, site: object|null }
const querySiteMask = (cx, cy, cz) => {
  for (let i = 0; i < STRUCTURE_SITES.length; i++) {
    const s = STRUCTURE_SITES[i];
    const dx = Math.abs(cx - s.cx);
    const dy = Math.abs(cy - s.cy);
    const dz = Math.abs(cz - s.cz);
    if (dx <= s.radiusX && dy <= s.radiusY && dz <= s.radiusZ) {
      const isAnchor = (dx === 0 && dy === 0 && dz === 0);
      return { masked: true, isAnchor, site: s };
    }
  }
  return { masked: false, isAnchor: false, site: null };
};

// Boundary blend: distance-based smoothstep for edge cells
// dist: manhattan-like normalised distance 0 (anchor) → 1 (boundary)
const maskBlend = (cx, cy, cz, site) => {
  const nx = Math.abs(cx - site.cx) / (site.radiusX + 0.5);
  const ny = Math.abs(cy - site.cy) / (site.radiusY + 0.5);
  const nz = Math.abs(cz - site.cz) / (site.radiusZ + 0.5);
  const d  = Math.max(nx, ny, nz); // Chebyshev distance, normalised
  // smoothstep: 0 at centre, 1 at boundary
  const t = Math.max(0, Math.min(1, d));
  return t * t * (3 - 2 * t);
};
```

---

#### STEP 2 — Early-Exit Guard in `buildCellMesh`

Find the existing `buildCellMesh` function. It begins:

```javascript
const buildCellMesh = (cx, cy, cz, lod) => {
  const V = [];
  // ... existing code ...
```

**Replace the opening** with:

```javascript
const buildCellMesh = (cx, cy, cz, lod) => {
  // ── ZeroStructureMask void-pocket guard ──────────────────────────────
  const _maskQ = querySiteMask(cx, cy, cz);
  if (_maskQ.masked) {
    // Anchor cells: return empty — placeholder drawn separately
    if (_maskQ.isAnchor) return new Float32Array(0);
    // Inner pocket cells: fully suppressed
    const _blend = maskBlend(cx, cy, cz, _maskQ.site);
    if (_blend < 0.85) return new Float32Array(0);
    // Boundary cells (blend 0.85–1.0): allow generation but will be
    // scaled down in the panel builder below via _maskScale
  }
  const _maskScale = (_maskQ.masked)
    ? maskBlend(cx, cy, cz, _maskQ.site)   // 0.85-1.0 ramp at boundary
    : 1.0;
  // ── end guard ────────────────────────────────────────────────────────

  const V = [];
  // ... rest of existing buildCellMesh unchanged ...
```

Then, inside `buildCellMesh`, find every call to `kochPanel(V, ...)` or `pushQuad(V, ...)` and wrap the displacement magnitude. Specifically locate the `kochD(...)` calls and multiply the result by `_maskScale`:

Find:
```javascript
const d = kochD(u, v, wx, wy, wz, salt, kM);
```

Replace with:
```javascript
const d = kochD(u, v, wx, wy, wz, salt, kM) * _maskScale;
```

> Note: There may be multiple call sites for displacement inside `buildCellMesh`. Apply `* _maskScale` to each computed displacement value, not to the final vertex position directly. This preserves the panel topology while shrinking the Koch roughness to zero at the pocket boundary.

---

#### STEP 3 — Build Diamond Placeholder Mesh

Add this new function after `buildCellMesh`, before the shader source strings:

```javascript
// ═══════════════════════════════════════════════════════════════════════
// ZERO STRUCTURE MASK — Anchor Placeholder Builder (BSP Octahedron)
// ═══════════════════════════════════════════════════════════════════════

const buildAnchorMesh = (site) => {
  // World-space centre of the anchor cell
  const wx = site.cx * STRIDE + CELL * 0.5;
  const wy = site.cy * STRIDE + CELL * 0.5;
  const wz = site.cz * STRIDE + CELL * 0.5;

  const H = STRIDE * 0.65;  // vertical half-extent
  const R = STRIDE * 0.55;  // equatorial radius

  // 6 vertices: top, bottom, +X, -X, +Z, -Z
  const verts = [
    wx,     wy + H, wz,      // 0  top
    wx,     wy - H, wz,      // 1  bottom
    wx + R, wy,     wz,      // 2  +X
    wx - R, wy,     wz,      // 3  -X
    wx,     wy,     wz + R,  // 4  +Z
    wx,     wy,     wz - R,  // 5  -Z
  ];

  // 8 triangular faces (wound CCW from outside)
  const tris = [
    0,2,4,  0,4,3,  0,3,5,  0,5,2,  // upper hemisphere
    1,4,2,  1,3,4,  1,5,3,  1,2,5,  // lower hemisphere
  ];

  // Build flat-shaded vertex buffer (pos + normal, 6 floats per vertex)
  const V = [];
  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t] * 3, i1 = tris[t+1] * 3, i2 = tris[t+2] * 3;
    const ax = verts[i0], ay = verts[i0+1], az = verts[i0+2];
    const bx = verts[i1], by = verts[i1+1], bz = verts[i1+2];
    const cx2= verts[i2], cy2= verts[i2+1], cz2= verts[i2+2];

    // Flat normal from edge cross product
    const ux = bx-ax, uy = by-ay, uz = bz-az;
    const vvx= cx2-ax,vvy= cy2-ay,vvz= cz2-az;
    let nx = uy*vvz - uz*vvy;
    let ny = uz*vvx - ux*vvz;
    let nz = ux*vvy - uy*vvx;
    const nl = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
    nx/=nl; ny/=nl; nz/=nl;

    V.push(ax,ay,az,nx,ny,nz,  bx,by,bz,nx,ny,nz,  cx2,cy2,cz2,nx,ny,nz);
  }
  return new Float32Array(V);
};
```

---

#### STEP 4 — Create Anchor GL Buffers and Shader Program

Add immediately after the WebGL program is linked and `useProgram` is called (after `gl.useProgram(prog)`):

```javascript
// ═══════════════════════════════════════════════════════════════════════
// ZERO STRUCTURE MASK — Anchor Placeholder GL Setup
// ═══════════════════════════════════════════════════════════════════════

// Separate shader for placeholder: flat amber emissive, wireframe-style
const ANCHOR_VS = `
attribute vec3 aPos;
attribute vec3 aNorm;
uniform mat4 uVP;
uniform vec3 uCam;
varying vec3 vP;
varying vec3 vN;
void main(){
  vP = aPos;
  vN = aNorm;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const ANCHOR_FS = `
precision mediump float;
uniform vec3 uCam;
uniform float uFog;
uniform float uPulse;     // 0-1 slow pulse for ambient glow
varying vec3 vP;
varying vec3 vN;
void main(){
  // Amber emissive base
  vec3 amber = vec3(1.0, 0.53, 0.0);
  // Rim lighting from normal vs view
  vec3 viewDir = normalize(uCam - vP);
  float rim = 1.0 - abs(dot(normalize(vN), viewDir));
  rim = pow(rim, 2.5);
  // Dark fill + bright rim
  vec3 col = vec3(0.04, 0.03, 0.01) + amber * (rim * 0.9 + 0.15 + uPulse * 0.1);
  // Fog (quartic like main shader)
  float dist = length(vP - uCam);
  float fogT = clamp(dist / uFog, 0.0, 1.0); fogT *= fogT * fogT * fogT;
  col = mix(col, vec3(0.01, 0.01, 0.02), fogT);
  gl_FragColor = vec4(col, 0.88);
}`;

const mkAnchorSh = (src, t) => {
  const s = gl.createShader(t);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
};
const anchorProg = gl.createProgram();
gl.attachShader(anchorProg, mkAnchorSh(ANCHOR_VS, gl.VERTEX_SHADER));
gl.attachShader(anchorProg, mkAnchorSh(ANCHOR_FS, gl.FRAGMENT_SHADER));
gl.linkProgram(anchorProg);

const aAnchorPos  = gl.getAttribLocation(anchorProg, 'aPos');
const aAnchorNorm = gl.getAttribLocation(anchorProg, 'aNorm');
const uAnchorVP   = gl.getUniformLocation(anchorProg, 'uVP');
const uAnchorCam  = gl.getUniformLocation(anchorProg, 'uCam');
const uAnchorFog  = gl.getUniformLocation(anchorProg, 'uFog');
const uAnchorPulse= gl.getUniformLocation(anchorProg, 'uPulse');

// Buffer cache: siteId → { buf, count }
const anchorCache = new Map();

const getAnchorBuf = (site) => {
  if (anchorCache.has(site.id)) return anchorCache.get(site.id);
  const data = buildAnchorMesh(site);
  const buf  = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const entry = { buf, count: data.length / 6 };
  anchorCache.set(site.id, entry);
  return entry;
};
```

---

#### STEP 5 — Render Anchor Placeholders in the Frame Loop

Inside the `frame` function, after the existing Koch cell draw loop (after `gl.drawArrays(...)` and before the HUD throttle block), add:

```javascript
// ═══════════════════════════════════════════════════════════════════════
// ZERO STRUCTURE MASK — Anchor Placeholder Draw Pass
// ═══════════════════════════════════════════════════════════════════════
{
  const pulse = (Math.sin(ts * 0.0012) * 0.5 + 0.5); // slow 0-1 pulse

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(anchorProg);
  gl.uniformMatrix4fv(uAnchorVP,    false, vp);
  gl.uniform3fv(uAnchorCam,  cam.pos);
  gl.uniform1f(uAnchorFog,   drawDist * STRIDE * FOG_MULT);
  gl.uniform1f(uAnchorPulse, pulse);

  for (let i = 0; i < STRUCTURE_SITES.length; i++) {
    const site = STRUCTURE_SITES[i];
    // Skip if model is loaded (model rendering handled separately)
    if (site.modelUrl && site._modelLoaded) continue;
    // Rough frustum/distance cull: skip if anchor cell is far outside draw range
    const distCX = Math.abs(site.cx - pcx);
    const distCY = Math.abs(site.cy - pcy);
    const distCZ = Math.abs(site.cz - pcz);
    if (distCX > drawDist + 1 || distCY > drawDist + 1 || distCZ > drawDist + 1) continue;

    const { buf, count } = getAnchorBuf(site);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(aAnchorPos);
    gl.vertexAttribPointer(aAnchorPos,  3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(aAnchorNorm);
    gl.vertexAttribPointer(aAnchorNorm, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }

  gl.disable(gl.BLEND);
  gl.useProgram(prog); // restore main Koch program
}
```

---

#### STEP 6 — HUD Integration

Inside the existing HUD throttle block (the `if(Math.floor(ts/150)...)` section), after the existing `h.biome` update line, add:

```javascript
// Site proximity HUD
if (h.site || h.nearest) {
  // Find nearest site to camera
  let nearestSite = null, nearestDist = Infinity;
  for (const s of STRUCTURE_SITES) {
    const d = Math.abs(s.cx - pcx) + Math.abs(s.cy - pcy) + Math.abs(s.cz - pcz);
    if (d < nearestDist) { nearestDist = d; nearestSite = s; }
  }
  // If inside a mask zone, override biome label
  const inMask = querySiteMask(pcx, pcy, pcz);
  if (inMask.masked && h.biome) {
    h.biome.textContent = `SITE · ${inMask.site.label}`;
    h.biome.style.color = 'rgba(255,136,0,0.85)';
  } else {
    if (h.biome) {
      h.biome.textContent = 'BIOME ' + BIOME_NAMES[getBiome(cam.pos[0], cam.pos[1], cam.pos[2])];
      h.biome.style.color = '';
    }
  }
  if (h.site)    h.site.textContent    = `SITES  ${STRUCTURE_SITES.length}`;
  if (h.nearest) h.nearest.textContent = nearestSite ? `NEAREST  ${nearestSite.label}` : '';
}
```

Add two new HUD `div` refs in the JSX (alongside the existing HUD ref divs):

```jsx
<div ref={el => hudRef.current.site    = el}>SITES  —</div>
<div ref={el => hudRef.current.nearest = el}>NEAREST  —</div>
```

Place these after the existing `DRAW` line inside the right-column HUD `div`.

---

#### STEP 7 — Cleanup

Inside the existing cleanup `return()=>` block, after `cache.clear()`, add:

```javascript
// Cleanup anchor buffers
for (const v of anchorCache.values()) gl.deleteBuffer(v.buf);
anchorCache.clear();
```

---

### Optional: Loading Real GLB/GLTF Models

When a site's `modelUrl` is non-null, load asynchronously after the WebGL context is ready. Add inside `useEffect`, after all synchronous setup:

```javascript
// ── Optional GLB model loading ──────────────────────────────────────
// Requires a GLTFLoader adapted to raw WebGL (or wrap in an offscreen
// Three.js renderer sharing the same canvas). Simplified flow:
//
// import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// const loader = new GLTFLoader();
//
// STRUCTURE_SITES.forEach(site => {
//   if (!site.modelUrl) return;
//   loader.load(site.modelUrl, (gltf) => {
//     const model = gltf.scene;
//     // Position at anchor world centre
//     model.position.set(
//       site.cx * STRIDE + CELL * 0.5,
//       site.cy * STRIDE + CELL * 0.5,
//       site.cz * STRIDE + CELL * 0.5
//     );
//     site._modelLoaded = true;
//     site._modelObject = model;
//     // Add to a shared Three.js scene rendered on the same canvas,
//     // or convert geometry to WebGL buffers manually.
//   });
// });
//
// NOTE: The simplest integration uses a second Three.js WebGLRenderer
// targeting the same canvas with { context: gl }. The Koch world draws
// first (raw WebGL), then Three.js composites models on top with
// renderer.render(scene, camera) using gl.clear(false).
// The void pocket ensures no Koch geometry occludes the model space.
```

---

### Data Flow Diagram

```
  Frame tick
    │
    ├─ For each Koch cell (cx,cy,cz) in draw range:
    │    │
    │    ├─ querySiteMask(cx,cy,cz)
    │    │    ├─ masked=false  → buildCellMesh normally
    │    │    ├─ masked=true, isAnchor=true → return Float32Array(0)
    │    │    └─ masked=true, pocket cell:
    │    │         blend < 0.85 → return Float32Array(0)
    │    │         blend 0.85-1 → buildCellMesh with _maskScale ramp
    │    │
    │    └─ Upload to GPU cache, draw arrays
    │
    └─ Anchor placeholder pass:
         For each STRUCTURE_SITES entry:
           ├─ distance cull check
           ├─ modelLoaded? → skip placeholder
           └─ getAnchorBuf(site) → draw octahedron
                (amber rim shader, pulse uniform, quartic fog)
```

---

### Key Constants Reference

| Constant | Value | Source |
|---|---|---|
| `CELL` | 512 units | KochMegastructureV3 |
| `GAP` | 96 units | KochMegastructureV3 |
| `STRIDE` | 608 units (CELL+GAP) | KochMegastructureV3 |
| `WORLD_SEED` | `0x4B4F4348` | KochMegastructureV3 |
| `FOG_MULT` | `0.5` | KochMegastructureV3 |
| Default `radiusX/Z` | 2 cells | ZeroStructureMask |
| Default `radiusY` | 1 cell | ZeroStructureMask |
| Placeholder `H` | `STRIDE × 0.65` = 395.2u | ZeroStructureMask |
| Placeholder `R` | `STRIDE × 0.55` = 334.4u | ZeroStructureMask |
| Blend boundary threshold | `0.85` normalised Chebyshev | ZeroStructureMask |
| Pulse frequency | `0.0012 rad/ms` ≈ 0.19Hz | ZeroStructureMask |

---

## Style Guide

Visual identity must remain consistent with KochMegastructureV3:

- **Background fog colour**: `#010102` (existing)
- **Koch geometry**: achromatic blue-grey `rgb(0.90, 0.92, 0.96)` lit (existing)
- **Placeholder solid fill**: `#0a0a14` (near-black, cold tint)
- **Placeholder rim / wire**: `#ff8800` amber emissive (POI contrast colour)
- **HUD site label colour**: `rgba(255,136,0,0.85)` when inside mask zone
- **HUD normal colour**: `rgba(120,160,220,0.55)` (existing)
- Font: `'Courier New', monospace` throughout (existing)
- Letter spacing: 1–3px (existing)

---

## Performance Goals

- `querySiteMask` must complete in under 1µs for ≤ 64 sites (simple linear scan)
- For > 256 sites: partition into a uniform 3D grid with cell size `= max(radiusX,radiusZ) * 2 + 1`; lookup becomes O(1)
- Placeholder octahedra are pre-baked into GPU buffers at first visibility; subsequent frames cost only one `drawArrays` call per visible site
- Total additional per-frame cost for 8 visible sites: < 0.1ms on integrated GPU
- Mask early-exit keeps Koch mesh vertex count unchanged for all non-boundary cells — zero regression on existing performance

---

## Testing Scenarios

| Scenario | Expected Result |
|---|---|
| Camera inside anchor cell | Biome HUD replaced by amber site label; no Koch panels rendered; octahedron visible from outside |
| Camera inside pocket cell (non-anchor) | No Koch panels; no placeholder; open void; normal fog |
| Camera at boundary cell (blend 0.9) | Koch panels generated with `_maskScale ≈ 0.9`; slight displacement reduction |
| Camera outside all sites | Zero performance change; querySiteMask returns early; all 3 sites in HUD count |
| Two sites with overlapping radii | Both masks applied; cell masked if either query returns masked=true |
| `modelUrl` set and loaded | Placeholder suppressed; void pocket maintained; model visible in cleared space |
| `drawDist` reduced to 1 | Anchor cull check skips all sites beyond 2 cells; no orphan draw calls |

---

## Extended Features (Optional)

- **Animated void boundary**: apply a slow `coherent()` noise warp to `maskBlend` radius for organic-looking pocket edges rather than hard cell-aligned boxes
- **Site type variants**: extend site schema with `shape: 'box' | 'sphere' | 'cylinder'` to change pocket geometry and placeholder primitive
- **Proximity audio cue**: emit a Web Audio `OscillatorNode` tone at anchor frequency when camera enters mask zone (frequency mapped to `site.id`)
- **Export manifest**: `JSON.stringify(STRUCTURE_SITES)` button in HUD to output site registry for game editor integration
- **Dynamic site injection**: expose `window.__ZSM_addSite(siteObj)` to allow runtime site registration from external tools or dev console
