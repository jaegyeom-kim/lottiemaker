// src/lib/svgImport.ts
function fitImageSize(img, fit) {
  const s = fit / Math.max(img.w, img.h);
  return { w: Math.round(img.w * s), h: Math.round(img.h * s) };
}
function wrapToFit(graphic, fit) {
  const { items, bbox } = graphic;
  const scale = fit / Math.max(bbox.w, bbox.h) * 100;
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  return {
    ty: "gr",
    nm: "Custom Graphic",
    it: [
      ...items,
      {
        ty: "tr",
        p: { a: 0, k: [0, 0] },
        a: { a: 0, k: [cx, cy] },
        // 그래픽 중심을 앵커로
        s: { a: 0, k: [scale, scale] },
        r: { a: 0, k: 0 },
        o: { a: 0, k: 100 }
      }
    ]
  };
}

// src/lib/customBuilder.ts
var CUSTOM_OP = 90;
var CUSTOM_ASSET_PREFIX = "img_custom";
var LAYER_COLORS = [
  "#5B8DEF",
  "#E5A64B",
  "#9B6EE8",
  "#4BC0C8",
  "#E570A6",
  "#B0BC4A",
  "#8894A8",
  "#C98F5A"
];
function layerColor(layer, fallbackIdx) {
  const ci = typeof layer.xci === "number" ? layer.xci : fallbackIdx;
  return LAYER_COLORS[(ci % LAYER_COLORS.length + LAYER_COLORS.length) % LAYER_COLORS.length];
}
function tint(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
var IN_TYPES = ["\uC5C6\uC74C", "\uD398\uC774\uB4DC", "\uC544\uB798\uC5D0\uC11C", "\uC704\uC5D0\uC11C", "\uC67C\uCABD\uC5D0\uC11C", "\uC624\uB978\uCABD\uC5D0\uC11C", "\uD31D", "\uB4DC\uB86D"];
var LOOP_TYPES = ["\uC5C6\uC74C", "\uD50C\uB85C\uD305", "\uD384\uC2A4", "\uD754\uB4E4\uAE30", "\uD68C\uC804", "\uBC14\uC6B4\uC2A4"];
var OUT_TYPES = ["\uC5C6\uC74C", "\uD398\uC774\uB4DC", "\uC544\uB798\uB85C", "\uC704\uB85C", "\uC67C\uCABD\uC73C\uB85C", "\uC624\uB978\uCABD\uC73C\uB85C", "\uCD95\uC18C"];
var DEFAULT_SEL = {
  size: 240,
  rotation: 0,
  opacity: 100,
  anchor: [0.5, 0.5],
  clip: [0, CUSTOM_OP],
  in: { type: 0, delay: 0, dur: 24, dist: 80, bounce: 1 },
  loop: { type: 0, amount: 24, period: 60 },
  out: { type: 0, dur: 20, dist: 80, bounce: 1 }
};
function normSel(raw, op = CUSTOM_OP) {
  const r = raw ?? {};
  const inn = { ...DEFAULT_SEL.in, ...r.in ?? {} };
  const clip = Array.isArray(r.clip) ? [r.clip[0], r.clip[1]] : [Math.max(0, Math.min(op - 8, inn.delay ?? 0)), op];
  return {
    ...DEFAULT_SEL,
    ...r,
    clip,
    in: inn,
    loop: { ...DEFAULT_SEL.loop, ...r.loop ?? {} },
    out: { ...DEFAULT_SEL.out, ...r.out ?? {} }
  };
}
var ease = (n) => ({
  i: { x: Array(n).fill(0.4), y: Array(n).fill(1) },
  o: { x: Array(n).fill(0.6), y: Array(n).fill(0) }
});
var kf = (dims, t, s) => ({ ...ease(dims), t: Math.round(t * 10) / 10, s });
var R = (v) => Math.round(v * 10) / 10;
function prop(dims, kfs, staticVal) {
  if (kfs.length < 2) {
    return { a: 0, k: dims === 1 ? staticVal[0] : staticVal };
  }
  const k = kfs.map((x, i) => i < kfs.length - 1 ? x : { t: x.t, s: x.s });
  return { a: 1, k };
}
var DIR = {
  2: [0, 1],
  3: [0, -1],
  4: [-1, 0],
  5: [1, 0]
};
function animSpans(sel, op = CUSTOM_OP) {
  const rawA = sel.clip?.[0] ?? 0;
  const rawB = sel.clip?.[1] ?? op;
  const clipA = Math.max(0, Math.min(op - 8, rawA));
  const clipB = Math.max(clipA + 8, Math.min(op, rawB));
  const inOn = sel.in.type > 0;
  const outOn = sel.out.type > 0;
  const outDur = outOn ? Math.max(4, Math.min(clipB - clipA - 4, sel.out.dur)) : 0;
  const outStart = clipB - outDur;
  const inDur = inOn ? Math.max(4, Math.min(outStart - clipA, sel.in.dur)) : 0;
  return { clipA, clipB, inStart: clipA, inEnd: clipA + inDur, outStart };
}
function buildAnimKs(sel, base, op = CUSTOM_OP) {
  const { clipA, clipB, inStart, inEnd, outStart } = animSpans(sel, op);
  const [bx, by] = base;
  const P = (dx, dy) => [R(bx + dx), R(by + dy), 0];
  const maxO = Math.max(0, Math.min(100, sel.opacity));
  const inT = sel.in.type;
  const loopT = sel.loop.type;
  const outT = sel.out.type;
  const dist = Math.max(4, Math.min(600, sel.in.dist));
  const outDist = Math.max(4, Math.min(600, sel.out.dist));
  const midA = inEnd;
  const midB = outStart;
  const midLen = Math.max(0, midB - midA);
  const period = Math.max(12, Math.min(op, sel.loop.period));
  const nCyc = loopT && midLen >= 12 ? Math.max(1, Math.round(midLen / period)) : 0;
  const cyc = nCyc ? midLen / nCyc : 0;
  const pk = [];
  const dirIn = DIR[inT];
  const dirOut = DIR[outT];
  if (dirIn || inT === 7) {
    const [dx, dy] = inT === 7 ? [0, -1] : dirIn;
    const off = inT === 7 ? Math.max(dist, 120) : dist;
    pk.push(kf(3, inStart, P(dx * off, dy * off)));
    if (inT === 7) {
      const d = inEnd - inStart;
      pk.push(kf(3, inStart + d * 0.55, P(0, 0)));
      pk.push(kf(3, inStart + d * 0.8, P(0, -off * 0.16)));
      pk.push(kf(3, inEnd, P(0, 0)));
    } else if (sel.in.bounce) {
      pk.push(kf(3, inStart + (inEnd - inStart) * 0.72, P(-dx * dist * 0.08, -dy * dist * 0.08)));
      pk.push(kf(3, inEnd, P(0, 0)));
    } else {
      pk.push(kf(3, inEnd, P(0, 0)));
    }
  }
  if (nCyc && (loopT === 1 || loopT === 3 || loopT === 5)) {
    const amt = Math.max(2, Math.min(300, sel.loop.amount));
    if (!pk.length) {
      if (midA > clipA) pk.push(kf(3, clipA, P(0, 0)));
      pk.push(kf(3, midA, P(0, 0)));
    } else if (pk[pk.length - 1].t < midA) {
      pk.push(kf(3, midA, P(0, 0)));
    }
    for (let i = 0; i < nCyc; i++) {
      const t0 = midA + i * cyc;
      if (loopT === 1) {
        pk.push(kf(3, t0 + cyc * 0.25, P(0, -amt / 2)));
        pk.push(kf(3, t0 + cyc * 0.5, P(0, 0)));
        pk.push(kf(3, t0 + cyc * 0.75, P(0, amt / 2)));
        pk.push(kf(3, t0 + cyc, P(0, 0)));
      } else if (loopT === 3) {
        pk.push(kf(3, t0 + cyc * 0.25, P(-amt / 2, 0)));
        pk.push(kf(3, t0 + cyc * 0.75, P(amt / 2, 0)));
        pk.push(kf(3, t0 + cyc, P(0, 0)));
      } else {
        pk.push(kf(3, t0 + cyc * 0.4, P(0, -amt)));
        pk.push(kf(3, t0 + cyc * 0.8, P(0, 0)));
        pk.push(kf(3, t0 + cyc, P(0, 0)));
      }
    }
  }
  if (dirOut) {
    const [dx, dy] = dirOut;
    if (!pk.length || pk[pk.length - 1].t < outStart) pk.push(kf(3, outStart, P(0, 0)));
    if (sel.out.bounce) {
      pk.push(kf(3, outStart + (clipB - outStart) * 0.3, P(-dx * outDist * 0.08, -dy * outDist * 0.08)));
    }
    pk.push(kf(3, clipB, P(dx * outDist, dy * outDist)));
  } else if (pk.length && pk[pk.length - 1].t < clipB) {
    pk.push(kf(3, clipB, pk[pk.length - 1].s));
  }
  const sk = [];
  const S = (v) => [R(v), R(v), 100];
  if (inT === 6) {
    sk.push(kf(3, inStart, S(0)));
    if (sel.in.bounce) sk.push(kf(3, inStart + (inEnd - inStart) * 0.7, S(112)));
    sk.push(kf(3, inEnd, S(100)));
  }
  if (nCyc && loopT === 2) {
    const amt = Math.max(1, Math.min(100, sel.loop.amount));
    if (!sk.length) {
      if (midA > clipA) sk.push(kf(3, clipA, S(100)));
      sk.push(kf(3, midA, S(100)));
    } else if (sk[sk.length - 1].t < midA) {
      sk.push(kf(3, midA, S(100)));
    }
    for (let i = 0; i < nCyc; i++) {
      const t0 = midA + i * cyc;
      sk.push(kf(3, t0 + cyc * 0.5, S(100 + amt)));
      sk.push(kf(3, t0 + cyc, S(100)));
    }
  }
  if (outT === 6) {
    if (!sk.length || sk[sk.length - 1].t < outStart) sk.push(kf(3, outStart, S(100)));
    if (sel.out.bounce) sk.push(kf(3, outStart + (clipB - outStart) * 0.3, S(112)));
    sk.push(kf(3, clipB, S(0)));
  } else if (sk.length && sk[sk.length - 1].t < clipB) {
    sk.push(kf(3, clipB, sk[sk.length - 1].s));
  }
  const ok = [];
  if (inT > 0) {
    ok.push(kf(1, inStart, [0]));
    ok.push(kf(1, inStart + (inEnd - inStart) * 0.8, [maxO]));
  }
  if (outT > 0) {
    if (!ok.length || ok[ok.length - 1].t < outStart) ok.push(kf(1, outStart, [maxO]));
    ok.push(kf(1, clipB, [0]));
  } else if (ok.length && ok[ok.length - 1].t < clipB) {
    ok.push(kf(1, clipB, [maxO]));
  }
  const rot = sel.rotation;
  let r = { a: 0, k: rot };
  if (nCyc && loopT === 4) {
    const lin = { i: { x: [0.833], y: [0.833] }, o: { x: [0.167], y: [0.167] } };
    const rk = [];
    if (midA > clipA) rk.push({ ...ease(1), t: clipA, s: [rot] }, { ...lin, t: midA, s: [rot] });
    else rk.push({ ...lin, t: midA, s: [rot] });
    if (midB < clipB) {
      rk.push({ ...ease(1), t: midB, s: [rot + 360 * nCyc] });
      rk.push({ t: clipB, s: [rot + 360 * nCyc] });
    } else {
      rk.push({ t: midB, s: [rot + 360 * nCyc] });
    }
    r = { a: 1, k: rk };
  }
  return {
    o: prop(1, ok, [maxO]),
    r,
    p: prop(3, pk, [bx, by, 0]),
    s: prop(3, sk, [100, 100, 100])
  };
}
function buildCustomLayer(payload, sel, base, nm, assetId, op = CUSTOM_OP) {
  const anim = buildAnimKs(sel, base, op);
  const ks = { ...anim, a: { a: 0, k: [0, 0, 0] } };
  const { clipA, clipB } = animSpans(sel, op);
  const common = {
    ddd: 0,
    sr: 1,
    ao: 0,
    ip: clipA,
    op: clipB,
    st: 0,
    bm: 0,
    nm,
    xsel: structuredClone(sel),
    xbase: [...base]
  };
  const [afx, afy] = sel.anchor ?? [0.5, 0.5];
  if (payload.kind === "image") {
    const { w, h } = fitImageSize(payload.image, sel.size);
    const asset = {
      id: assetId,
      w,
      h,
      u: "",
      p: payload.image.dataUri,
      e: 1,
      nw: payload.image.w,
      nh: payload.image.h
    };
    return {
      layer: {
        ...common,
        ty: 2,
        ind: 1,
        refId: assetId,
        ks: { ...ks, a: { a: 0, k: [w * afx, h * afy, 0] } }
      },
      asset
    };
  }
  const group = wrapToFit(payload.graphic, sel.size);
  group.bboxMax = Math.max(payload.graphic.bbox.w, payload.graphic.bbox.h);
  group.bboxW = payload.graphic.bbox.w;
  group.bboxH = payload.graphic.bbox.h;
  const sc = sel.size / Math.max(payload.graphic.bbox.w, payload.graphic.bbox.h);
  const gw = payload.graphic.bbox.w * sc;
  const gh = payload.graphic.bbox.h * sc;
  return {
    layer: {
      ...common,
      ty: 4,
      ind: 1,
      ks: { ...ks, a: { a: 0, k: [(afx - 0.5) * gw, (afy - 0.5) * gh, 0] } },
      shapes: [group],
      // 업로드 원문 SVG 내장 — 프로젝트 파일이 자립적이 되도록 (재생기는 무시)
      ...payload.graphic.svgText ? { xsrc: payload.graphic.svgText } : {}
    }
  };
}
function buildCustomDoc(payload, sel, base, nm) {
  const { layer, asset } = buildCustomLayer(payload, sel, base, nm, `${CUSTOM_ASSET_PREFIX}_0`);
  return {
    v: "5.7.4",
    fr: 60,
    ip: 0,
    op: CUSTOM_OP,
    w: 512,
    h: 512,
    nm: "Custom",
    ddd: 0,
    assets: asset ? [asset] : [],
    layers: [layer]
  };
}
export {
  CUSTOM_ASSET_PREFIX,
  CUSTOM_OP,
  DEFAULT_SEL,
  IN_TYPES,
  LAYER_COLORS,
  LOOP_TYPES,
  OUT_TYPES,
  animSpans,
  buildAnimKs,
  buildCustomDoc,
  buildCustomLayer,
  layerColor,
  normSel,
  tint
};
