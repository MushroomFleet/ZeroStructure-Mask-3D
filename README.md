# ZeroStructureMask 3D

**Deterministic void-pocket system for infinite 3D procedural worlds.**

A drop-in extension for the [Koch Megastructure JSX](https://github.com/MushroomFleet) component — punches clean, seed-consistent holes into infinite procedural topology so that large Points of Interest (low-poly `.glb` / `.gltf` structures) can occupy their reserved world-space volumes without geometry clipping through them.

> 🌐 **[Live Demo → scuffedepoch.com/zerostructure-mask](https://scuffedepoch.com/zerostructure-mask/)**

---

## What It Does

The Koch Megastructure generates an infinite interior world from a single 32-bit seed — no stored maps, no chunk files, no world state. Every cell is computed O(1) from its coordinate. But placing a large structure inside that world requires *empty space* the topology won't fill back in.

ZeroStructureMask solves this by registering **Structure Sites** — anchor coordinates in the infinite 3D cell lattice — and suppressing Koch panel generation inside a configurable void pocket around each one. The system is:

- **O(1) per cell** — mask state is computed from a simple axis-aligned distance check against a static site registry, with no spatial indexing required
- **Zero stored world state** — site coordinates are plain integers; the void is defined by arithmetic, not by any chunk map or bitmask
- **Infinitely scalable** — sites can be placed anywhere in the unbounded 3D lattice, at any depth, across any biome

When the camera approaches an anchor cell, the megastructure topology is absent and a **diamond-shaped BSP octahedron placeholder** renders in amber — a large, visible stand-in until a real `.glb` / `.gltf` model is slotted in. The void pocket remains active regardless of whether a model is loaded.

---

## Built For: Koch Megastructure JSX

This system was designed specifically as an extension layer for the **Koch Megastructure V3** component, previously released on this account. That component implements a real-time infinite interior megastructure using raw WebGL, driven entirely by the ZeroFamily of deterministic generation algorithms:

| System | Role |
|---|---|
| **ZeroBytes** | Position-is-seed O(1) hash — `posHash(cx, cy, cz)` |
| **Zero-Field** | Trilinear coherent noise for density, biome, roughness fields |
| **Zero-Graph** | Procedural structural connectivity (gap pipes, cantilever beams) |
| **Zero-Quad** | Pairwise relational properties between cell pairs |

ZeroStructureMask integrates at five precise points in the Koch Megastructure component — wrapping `buildCellMesh` with an early-exit guard and adding a second draw pass for anchor placeholders — without modifying any existing function bodies.

---

## How It Works

### The Void Pocket

For any cell `(cx, cy, cz)` in the draw range, the mask query runs in constant time:

```javascript
for (site of STRUCTURE_SITES) {
  dx = |cx - site.cx|
  dy = |cy - site.cy|
  dz = |cz - site.cz|

  if (dx ≤ radiusX AND dy ≤ radiusY AND dz ≤ radiusZ) {
    return { masked: true, isAnchor: (dx=0 AND dy=0 AND dz=0) }
  }
}
return { masked: false }
```

Three outcomes per cell:

| State | Result |
|---|---|
| **Normal** | Koch geometry builds as usual |
| **Pocket** | `buildCellMesh` returns `Float32Array(0)` — open void |
| **Anchor** | Empty mesh + diamond placeholder drawn in separate pass |

### Boundary Blending

Cells at the pocket edge receive a **smoothstep displacement ramp** so Koch panels fade out gradually rather than cutting hard at a voxel wall. The blend is computed as a normalised Chebyshev distance from the anchor, smoothstepped from 0 (deep void) to 1 (full Koch surface).

### Visual Layout (top-down Y slice)

```
  [ ][ ][ ][ ][ ][ ][ ]
  [ ][ ][▒][▒][▒][ ][ ]
  [ ][▒][░][░][░][▒][ ]
  [ ][▒][░][◆][░][▒][ ]   ◆ = Anchor (BSP diamond placeholder)
  [ ][▒][░][░][░][▒][ ]   ░ = Void pocket (no Koch geometry)
  [ ][ ][▒][▒][▒][ ][ ]   ▒ = Boundary blend zone
  [ ][ ][ ][ ][ ][ ][ ]   █ = Normal Koch megastructure cell
```

### BSP Diamond Placeholder

The placeholder is a regular octahedron centred at the anchor's world-space midpoint, sized to fill the void pocket volume:

```
  H = STRIDE × 0.65  (vertical half-extent ≈ 395 world units)
  R = STRIDE × 0.55  (equatorial radius    ≈ 334 world units)

  STRIDE = CELL + GAP = 512 + 96 = 608 world units
```

Rendered with a second minimal WebGL shader — dark fill, amber rim lighting, slow pulse glow — matching the megastructure HUD palette.

---

## Structure Site Registry

Sites are defined as plain objects in a static `STRUCTURE_SITES` array:

```javascript
const STRUCTURE_SITES = [
  {
    id: 0,
    cx: 4,  cy: 0,  cz: 4,       // anchor cell coordinate
    radiusX: 2,                   // void half-extent (cells)
    radiusY: 1,
    radiusZ: 2,
    modelUrl: null,               // set to '/models/nexus.glb' when ready
    label: 'NEXUS GATE ALPHA',
  },
  {
    id: 1,
    cx: -6, cy: 1,  cz: 2,
    radiusX: 2,
    radiusY: 1,
    radiusZ: 2,
    modelUrl: '/models/shard.glb',
    label: 'TRANSIT SHARD BETA',
  },
];
```

When `modelUrl` is non-null and the model is loaded, the placeholder is suppressed and the imported mesh renders inside the void. The pocket remains active either way.

---

## Files

| File | Description |
|---|---|
| `ZeroStructureMask-demo.jsx` | Self-contained interactive React demo — infinite grid viewer with live mask query, site placement, Y-slice travel, radius controls |
| `demo.html` | Full single-page documentation with embedded live demo, algorithm explainer, integration steps, and data format reference |
| `ZeroStructureMask-TINS.md` | Complete TINS implementation specification — all steps and code required to integrate into KochMegastructureV3.jsx |

---

## Integration (5 Points)

The system is a drop-in addition to `KochMegastructureV3.jsx`. All five insertion points leave existing function bodies unmodified:

1. **Site registry** — `STRUCTURE_SITES[]` + `querySiteMask()` after the constants block
2. **`buildCellMesh` guard** — early exit at the top of the function; boundary cells get `_maskScale` ramp applied to `kochD()` displacement
3. **`buildAnchorMesh` + anchor shader** — octahedron builder and second WebGL program (`ANCHOR_VS` / `ANCHOR_FS`)
4. **Frame loop — second draw pass** — anchor placeholders rendered after the Koch cell loop
5. **HUD + cleanup** — site count and nearest label lines; anchor buffers deleted on teardown

Full step-by-step instructions with exact code are in [`ZeroStructureMask-TINS.md`](./ZeroStructureMask-TINS.md).

---

## Performance

- Mask query completes in under 1µs for ≤ 64 sites (linear scan, no spatial index)
- For > 256 sites: partition into a uniform 3D grid; lookup becomes O(1)
- Anchor octahedra are pre-baked into GPU buffers on first visibility — subsequent frames cost one `drawArrays` call per visible site
- The early-exit guard adds zero overhead to normal Koch cells and keeps existing mesh vertex counts unchanged

---

## 🌐 Live Demo

**[scuffedepoch.com/zerostructure-mask](https://scuffedepoch.com/zerostructure-mask/)**

Left-click to place Structure Sites. Right-drag to pan. Scroll to zoom. Use the Y Slice slider to travel through the 3D lattice and watch pockets appear and disappear as the slice passes through `radiusY`.

---

## 📚 Citation

### Academic Citation

If you use this codebase in your research or project, please cite:

```bibtex
@software{zero_structure_mask,
  title = {ZeroStructureMask 3D: Deterministic void-pocket system for infinite 3D procedural worlds},
  author = {[Drift Johnson]},
  year = {2025},
  url = {https://github.com/MushroomFleet/ZeroStructure-Mask-3D},
  version = {1.0.0}
}
```

### Donate

[![Ko-Fi](https://cdn.ko-fi.com/cdn/kofi3.png?v=3)](https://ko-fi.com/driftjohnson)
