/**
 * ZeroStructureMask-demo.jsx
 * 
 * Interactive demonstration of the ZeroStructureMask system.
 * Shows a top-down infinite 3D cell grid with void pockets, anchor
 * placeholders, and boundary blending — all computed O(1) per cell.
 *
 * Self-contained. No props required. No external dependencies beyond React.
 *
 * Controls:
 *   Click canvas         → place / remove structure site at hovered cell
 *   Scroll / pinch       → zoom
 *   Right-drag / two-finger drag → pan
 *   Y-SLICE slider       → move through Y layers
 *   Radius sliders       → adjust mask radius XZ and Y
 */

const { useEffect, useRef, useState, useCallback } = React;

// ─── ZeroBytes hash (matches KochMegastructureV3 exactly) ─────────────────
const h32mix = v => {
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b);
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b);
  return (v ^ (v >>> 16)) >>> 0;
};
const posHash = (x, y, z, salt = 0) => {
  x = ((x + 32768) & 0xffff) | 0;
  y = ((y + 32768) & 0xffff) | 0;
  z = ((z + 32768) & 0xffff) | 0;
  let s = (salt ^ 0x9e3779b9) >>> 0;
  s = h32mix(s ^ x);
  s = h32mix(s ^ ((y << 8) | (z >>> 8)));
  s = h32mix(s ^ (z & 0xff));
  s = h32mix(s ^ Math.imul(x, 0x6c62272e));
  s = h32mix(s ^ Math.imul(y, 0x9e3779b9));
  s = h32mix(s ^ Math.imul(z, 0x517cc1b7));
  return s >>> 0;
};
const h2f = h => (h >>> 0) / 4294967296;

// ─── Mask query (core algorithm) ──────────────────────────────────────────
const querySiteMask = (cx, cy, cz, sites) => {
  for (let i = 0; i < sites.length; i++) {
    const s = sites[i];
    const dx = Math.abs(cx - s.cx);
    const dy = Math.abs(cy - s.cy);
    const dz = Math.abs(cz - s.cz);
    if (dx <= s.radiusX && dy <= s.radiusY && dz <= s.radiusZ) {
      const isAnchor = dx === 0 && dy === 0 && dz === 0;
      // Normalised Chebyshev distance → blend
      const blend = Math.max(
        dx / (s.radiusX + 0.5),
        dy / (s.radiusY + 0.5),
        dz / (s.radiusZ + 0.5)
      );
      const t = Math.max(0, Math.min(1, blend));
      const smoothBlend = t * t * (3 - 2 * t);
      return { masked: true, isAnchor, blend: smoothBlend, site: s, siteIdx: i };
    }
  }
  return { masked: false, isAnchor: false, blend: 0, site: null, siteIdx: -1 };
};

// ─── Cell density (simulates Koch cellSolid) ──────────────────────────────
const smstep = t => t * t * (3 - 2 * t);
const lat = (ix, iy, iz, s) => h2f(posHash(ix, iy, iz, s)) * 2 - 1;
const WORLD_SEED = 0x4b4f4348;

const coherent2 = (x, y, salt) => {
  const ix = Math.floor(x), iy = Math.floor(y);
  const tx = smstep(x - ix), ty = smstep(y - iy);
  const s = salt;
  const n00 = lat(ix,   iy,   0, s), n10 = lat(ix+1, iy,   0, s);
  const n01 = lat(ix,   iy+1, 0, s), n11 = lat(ix+1, iy+1, 0, s);
  return (n00*(1-tx)+n10*tx)*(1-ty) + (n01*(1-tx)+n11*tx)*ty;
};

const cellDensity = (cx, cy, cz) => {
  const wx = cx * 608, wy = cy * 608, wz = cz * 608;
  const macro = coherent2(wx * 0.0003, wz * 0.0003, WORLD_SEED + 9000);
  const meso  = coherent2(wx * 0.0012, wz * 0.0012, WORLD_SEED + 9500);
  const field = coherent2(wx * 0.0009 + wy * 0.0001, wz * 0.0009, WORLD_SEED + 1000);
  if (macro > 0.55) return 0; // void (foam bubble macro)
  if (macro > 0.30) return meso > 0.0 ? 0.4 : 0;
  return field > -0.52 ? Math.min(1, 0.3 + field * 0.7) : 0;
};

// ─── Palette ──────────────────────────────────────────────────────────────
const PAL = {
  bg:       '#010102',
  grid:     '#0a0a14',
  gridLine: '#0d1020',
  solid:    '#1a1e35',       // Koch solid cell
  solidHi:  '#252b47',       // Koch cell highlight
  void:     '#010102',       // empty cell
  pocket:   '#0a0510',       // masked pocket (void)
  pocketBorder: '#3a1060',   // pocket border
  boundary: '#1a0830',       // boundary blend zone
  anchor:   '#ff8800',       // site anchor amber
  anchorBg: '#1a0800',       // anchor cell fill
  anchorRim:'#ff6600',
  hover:    'rgba(255,136,0,0.18)',
  text:     'rgba(180,210,255,0.7)',
  textDim:  'rgba(100,130,180,0.45)',
  dimGreen: 'rgba(80,220,120,0.6)',
};

// Biome colours matching megastructure
const BIOME_COLORS = [
  '#1e2a4a','#1a2040','#1c2545','#18233e','#202c50',
];

// ─── Main Component ────────────────────────────────────────────────────────
export default function ZeroStructureMaskDemo() {
  const canvasRef = useRef(null);
  const stateRef  = useRef({
    sites: [
      { id: 0, cx:  2, cy: 0, cz:  2, radiusX: 2, radiusY: 1, radiusZ: 2, label: 'NEXUS ALPHA' },
      { id: 1, cx: -4, cy: 0, cz: -3, radiusX: 2, radiusY: 1, radiusZ: 2, label: 'SHARD BETA'  },
    ],
    nextId: 2,
    // View
    panX: 0, panZ: 0,
    zoom: 38,          // px per cell
    sliceY: 0,         // current Y layer
    radiusXZ: 2,
    radiusY: 1,
    // Input
    isPanning: false,
    lastMX: 0, lastMZ: 0,
    hovCX: null, hovCZ: null,
    mouseButton: -1,
  });
  const [ui, setUi] = useState({
    sliceY: 0, radiusXZ: 2, radiusY: 1,
    siteCount: 2, hovLabel: null, fps: 0,
  });
  const rafRef   = useRef(null);
  const lastTsRef= useRef(0);
  const fpsRef   = useRef(0);

  // ── Draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const st = stateRef.current;
    const { panX, panZ, zoom, sliceY, sites } = st;

    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, W, H);

    // Cell range visible
    const halfW = W / 2, halfH = H / 2;
    const minCX = Math.floor((-halfW / zoom - panX) - 1);
    const maxCX = Math.ceil(( halfW / zoom - panX) + 1);
    const minCZ = Math.floor((-halfH / zoom - panZ) - 1);
    const maxCZ = Math.ceil(( halfH / zoom - panZ) + 1);

    // Draw cells
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const sx = (cx + panX) * zoom + halfW;
        const sy = (cz + panZ) * zoom + halfH;
        const cell = zoom;

        const mask  = querySiteMask(cx, sliceY, cz, sites);
        const dens  = cellDensity(cx, sliceY, cz);
        const isHov = cx === st.hovCX && cz === st.hovCZ;

        let fill, stroke, strokeW = 0.5;

        if (mask.masked) {
          if (mask.isAnchor) {
            fill   = PAL.anchorBg;
            stroke = PAL.anchor;
            strokeW = 1.5;
          } else {
            // blend: 0=deep pocket, 1=boundary
            const t = mask.blend;
            if (t < 0.75) {
              fill   = PAL.pocket;
              stroke = PAL.pocketBorder;
            } else {
              // boundary zone
              const lerp = (t - 0.75) / 0.25;
              fill   = PAL.boundary;
              stroke = PAL.pocketBorder;
              strokeW = 0.5 + lerp * 0.5;
            }
          }
        } else if (dens > 0.05) {
          // Koch cell — shade by density
          const shade = Math.floor(dens * 40);
          fill   = `rgb(${20+shade},${26+shade},${52+shade})`;
          stroke = PAL.gridLine;
        } else {
          fill   = PAL.void;
          stroke = PAL.gridLine;
        }

        // Draw cell
        ctx.fillStyle = fill;
        ctx.fillRect(sx, sy, cell - 1, cell - 1);

        if (isHov && !mask.masked) {
          ctx.fillStyle = PAL.hover;
          ctx.fillRect(sx, sy, cell - 1, cell - 1);
        }

        ctx.strokeStyle = stroke;
        ctx.lineWidth   = strokeW;
        ctx.strokeRect(sx + 0.5, sy + 0.5, cell - 2, cell - 2);

        // Anchor: draw diamond
        if (mask.isAnchor && zoom >= 20) {
          const cx2 = sx + cell / 2, cy2 = sy + cell / 2;
          const r   = cell * 0.38;
          ctx.beginPath();
          ctx.moveTo(cx2,    cy2 - r);
          ctx.lineTo(cx2+r,  cy2);
          ctx.lineTo(cx2,    cy2 + r);
          ctx.lineTo(cx2-r,  cy2);
          ctx.closePath();
          ctx.strokeStyle = PAL.anchor;
          ctx.lineWidth   = zoom > 30 ? 1.5 : 1;
          ctx.stroke();
          // Glow fill
          const grd = ctx.createRadialGradient(cx2,cy2,0,cx2,cy2,r);
          grd.addColorStop(0, 'rgba(255,136,0,0.35)');
          grd.addColorStop(1, 'rgba(255,136,0,0.0)');
          ctx.fillStyle = grd;
          ctx.fill();

          // Label
          if (zoom >= 32 && mask.site.label) {
            ctx.fillStyle = 'rgba(255,136,0,0.9)';
            ctx.font = `bold ${Math.max(7, zoom * 0.18)}px "Courier New", monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(mask.site.label, cx2, cy2 + r + zoom * 0.18);
          }
        }

        // Pocket: render subtle X cross for voided cells
        if (mask.masked && !mask.isAnchor && mask.blend < 0.7 && zoom >= 24) {
          ctx.strokeStyle = 'rgba(100,30,180,0.25)';
          ctx.lineWidth   = 0.5;
          const m = cell * 0.25;
          ctx.beginPath();
          ctx.moveTo(sx+m, sy+m); ctx.lineTo(sx+cell-m-1, sy+cell-m-1);
          ctx.moveTo(sx+cell-m-1, sy+m); ctx.lineTo(sx+m, sy+cell-m-1);
          ctx.stroke();
        }

        // Boundary blend indicator
        if (mask.masked && !mask.isAnchor && mask.blend >= 0.75 && zoom >= 28) {
          ctx.fillStyle = 'rgba(120,60,200,0.18)';
          ctx.fillRect(sx+1, sy+1, cell-3, cell-3);
        }

        // Hover highlight on masked cells
        if (isHov && mask.masked && !mask.isAnchor) {
          ctx.fillStyle = 'rgba(255,50,50,0.12)';
          ctx.fillRect(sx, sy, cell-1, cell-1);
        }
      }
    }

    // Axes cross
    const ox = (0 + panX) * zoom + halfW;
    const oz = (0 + panZ) * zoom + halfH;
    ctx.strokeStyle = 'rgba(80,120,200,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(ox,0); ctx.lineTo(ox,H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,oz); ctx.lineTo(W,oz); ctx.stroke();
    ctx.setLineDash([]);

    // Origin label
    ctx.fillStyle = 'rgba(80,100,160,0.4)';
    ctx.font = '9px "Courier New"';
    ctx.textAlign = 'left';
    ctx.fillText('0,0', ox+3, oz-3);

    // HUD overlay (top-left mini legend)
    drawLegend(ctx, W, H, sliceY, sites.length);
  }, []);

  const drawLegend = (ctx, W, H, sliceY, siteCount) => {
    const items = [
      { color: '#252b47', label: 'KOCH SOLID' },
      { color: PAL.pocket, border: PAL.pocketBorder, label: 'VOID POCKET' },
      { color: PAL.boundary, border: PAL.pocketBorder, label: 'BOUNDARY BLEND' },
      { color: PAL.anchorBg, border: PAL.anchor, label: 'ANCHOR (POI SLOT)' },
    ];
    const pad = 12, lh = 16, bw = 12, bh = 10;
    const tw = 168, th = pad*2 + items.length * lh + 10;
    ctx.fillStyle = 'rgba(1,1,2,0.88)';
    ctx.fillRect(pad, pad, tw, th);
    ctx.strokeStyle = 'rgba(80,100,180,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad+0.5, pad+0.5, tw, th);

    ctx.fillStyle = 'rgba(180,210,255,0.55)';
    ctx.font = 'bold 9px "Courier New"';
    ctx.textAlign = 'left';
    ctx.fillText('ZERO STRUCTURE MASK', pad+8, pad+14);

    items.forEach((item, i) => {
      const y = pad + 22 + i * lh;
      ctx.fillStyle = item.color;
      ctx.fillRect(pad+8, y, bw, bh);
      if (item.border) {
        ctx.strokeStyle = item.border;
        ctx.lineWidth = 1;
        ctx.strokeRect(pad+8.5, y+0.5, bw-1, bh-1);
      }
      ctx.fillStyle = 'rgba(140,170,220,0.65)';
      ctx.font = '8px "Courier New"';
      ctx.fillText(item.label, pad+24, y+8);
    });

    // Y slice indicator
    ctx.fillStyle = 'rgba(100,130,180,0.4)';
    ctx.font = '8px "Courier New"';
    ctx.fillText(`Y SLICE  ${sliceY >= 0 ? '+' : ''}${sliceY}`, pad+8, pad + th - 6);
  };

  // ── Render loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = (ts) => {
      rafRef.current = requestAnimationFrame(loop);
      const dt = ts - lastTsRef.current;
      fpsRef.current = Math.round(1000 / Math.max(dt, 1));
      lastTsRef.current = ts;
      draw();
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // ── Resize ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ro = new ResizeObserver(() => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    });
    ro.observe(canvas);
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    return () => ro.disconnect();
  }, []);

  // ── Input helpers ─────────────────────────────────────────────────────────
  const screenToCell = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    const st     = stateRef.current;
    const mx     = clientX - rect.left;
    const my     = clientY - rect.top;
    const halfW  = canvas.width / 2;
    const halfH  = canvas.height / 2;
    const cx     = Math.floor((mx - halfW) / st.zoom - st.panX);
    const cz     = Math.floor((my - halfH) / st.zoom - st.panZ);
    return { cx, cz };
  }, []);

  const onMouseDown = useCallback((e) => {
    const st = stateRef.current;
    st.mouseButton = e.button;
    if (e.button === 2 || e.button === 1) {
      st.isPanning = true;
      st.lastMX = e.clientX;
      st.lastMZ = e.clientY;
      e.preventDefault();
    } else if (e.button === 0) {
      // Place or remove site
      const { cx, cz } = screenToCell(e.clientX, e.clientY);
      const cy = st.sliceY;
      const existIdx = st.sites.findIndex(s =>
        s.cx === cx && s.cy === cy && s.cz === cz
      );
      if (existIdx >= 0) {
        st.sites.splice(existIdx, 1);
      } else {
        st.sites.push({
          id: st.nextId++,
          cx, cy, cz,
          radiusX: st.radiusXZ,
          radiusY: st.radiusY,
          radiusZ: st.radiusXZ,
          label: `SITE #${st.nextId - 1}`,
        });
      }
      setUi(u => ({ ...u, siteCount: st.sites.length }));
    }
  }, [screenToCell]);

  const onMouseMove = useCallback((e) => {
    const st = stateRef.current;
    if (st.isPanning) {
      st.panX += (e.clientX - st.lastMX) / st.zoom;
      st.panZ += (e.clientY - st.lastMZ) / st.zoom;
      st.lastMX = e.clientX;
      st.lastMZ = e.clientY;
    }
    const { cx, cz } = screenToCell(e.clientX, e.clientY);
    st.hovCX = cx;
    st.hovCZ = cz;
    const mask = querySiteMask(cx, st.sliceY, cz, st.sites);
    const label = mask.masked
      ? mask.isAnchor
        ? `ANCHOR · ${mask.site.label}`
        : `VOID POCKET (blend ${mask.blend.toFixed(2)})`
      : `CELL ${cx},${st.sliceY},${cz}`;
    setUi(u => ({ ...u, hovLabel: label }));
  }, [screenToCell]);

  const onMouseUp = useCallback(() => {
    stateRef.current.isPanning = false;
    stateRef.current.mouseButton = -1;
  }, []);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const st = stateRef.current;
    const factor = e.deltaY > 0 ? 0.88 : 1.14;
    st.zoom = Math.max(8, Math.min(96, st.zoom * factor));
  }, []);

  const onContextMenu = useCallback(e => e.preventDefault(), []);

  // ── Slider handlers ────────────────────────────────────────────────────────
  const setSliceY = (v) => {
    stateRef.current.sliceY = v;
    setUi(u => ({ ...u, sliceY: v }));
  };
  const setRadiusXZ = (v) => {
    stateRef.current.radiusXZ = v;
    setUi(u => ({ ...u, radiusXZ: v }));
  };
  const setRadiusY = (v) => {
    stateRef.current.radiusY = v;
    setUi(u => ({ ...u, radiusY: v }));
  };

  const clearSites = () => {
    stateRef.current.sites = [];
    setUi(u => ({ ...u, siteCount: 0 }));
  };

  const resetView = () => {
    const st = stateRef.current;
    st.panX = 0; st.panZ = 0; st.zoom = 38;
  };

  // ── Styles ─────────────────────────────────────────────────────────────────
  const mono = { fontFamily: "'Courier New', monospace" };
  const base = {
    background: '#010102', color: 'rgba(180,210,255,0.7)',
    ...mono, userSelect: 'none', width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  };
  const barStyle = {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '8px 14px',
    background: 'rgba(5,5,16,0.97)',
    borderBottom: '1px solid rgba(40,50,120,0.4)',
    flexShrink: 0, flexWrap: 'wrap',
  };
  const labelStyle = { fontSize: 9, letterSpacing: 2, color: 'rgba(100,130,180,0.6)' };
  const valStyle   = { fontSize: 11, color: 'rgba(200,220,255,0.85)', minWidth: 18, textAlign: 'center' };
  const sliderStyle = {
    accentColor: '#ff8800', cursor: 'pointer', width: 90,
  };
  const btnStyle = {
    background: 'transparent', border: '1px solid rgba(80,100,180,0.4)',
    color: 'rgba(140,170,220,0.7)', padding: '3px 10px', cursor: 'pointer',
    fontSize: 9, letterSpacing: 2, ...mono,
    transition: 'border-color 0.15s, color 0.15s',
  };
  const statusStyle = {
    fontSize: 9, letterSpacing: 1.5,
    color: 'rgba(255,136,0,0.6)', marginLeft: 'auto',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    maxWidth: 300,
  };

  return (
    <div style={base}>
      {/* Top control bar */}
      <div style={barStyle}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: 'rgba(180,210,255,0.4)', flexShrink: 0 }}>
          ZSM · DEMO
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>Y SLICE</span>
          <input type="range" min={-4} max={4} step={1}
            value={ui.sliceY} style={sliderStyle}
            onChange={e => setSliceY(+e.target.value)} />
          <span style={valStyle}>{ui.sliceY >= 0 ? '+' : ''}{ui.sliceY}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>RADIUS XZ</span>
          <input type="range" min={1} max={5} step={1}
            value={ui.radiusXZ} style={sliderStyle}
            onChange={e => setRadiusXZ(+e.target.value)} />
          <span style={valStyle}>{ui.radiusXZ}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={labelStyle}>RADIUS Y</span>
          <input type="range" min={0} max={4} step={1}
            value={ui.radiusY} style={sliderStyle}
            onChange={e => setRadiusY(+e.target.value)} />
          <span style={valStyle}>{ui.radiusY}</span>
        </div>

        <button style={btnStyle} onClick={resetView}>RESET VIEW</button>
        <button style={{ ...btnStyle, borderColor: 'rgba(180,60,60,0.4)', color: 'rgba(220,100,100,0.6)' }}
          onClick={clearSites}>CLEAR SITES</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <span style={{ ...labelStyle }}>SITES</span>
          <span style={{ ...valStyle, color: 'rgba(255,136,0,0.8)', minWidth: 24 }}>{ui.siteCount}</span>
        </div>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%', cursor: 'crosshair' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
        />
      </div>

      {/* Bottom status bar */}
      <div style={{
        ...barStyle, borderBottom: 'none',
        borderTop: '1px solid rgba(40,50,120,0.3)',
        padding: '5px 14px',
      }}>
        <span style={{ fontSize: 8, letterSpacing: 2, color: 'rgba(60,80,140,0.5)' }}>
          LMB PLACE/REMOVE · RMB PAN · SCROLL ZOOM
        </span>
        <span style={statusStyle}>{ui.hovLabel || '—'}</span>
      </div>
    </div>
  );
}
