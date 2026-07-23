import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

// Where an agent stands (and what it faces) when working at a given prop.
const STATIONS = {
  whiteboard: { pos: [-3.6, -4.0], look: [-3.6, -6.4] },
  kanban: { pos: [4.4, -3.6], look: [5.8, -6.2] },
  vault: { pos: [-6.4, -1.4], look: [-8.4, -1.4] },
  desk: { pos: [-4.2, 3.0], look: [-4.2, 5.0], sit: true },
  lounge: { pos: [4.6, 3.2], look: [4.6, 5.2] },
  easel: { pos: [-1.0, -3.4], look: [-1.0, -5.4] },
};

export function createOffice(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf3f1ec);
  scene.fog = new THREE.Fog(0xf3f1ec, 36, 64);

  // ---- camera (isometric-ish orthographic) ----
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const setFrustum = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    const aspect = w / h;
    // Fit the room on any shape of screen (portrait phones included).
    const halfH = Math.max(10, 12 / Math.max(aspect, 0.34));
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    camera.zoom = aspect < 0.8 ? 1.25 : 1; // zoom in a bit on portrait
    camera.updateProjectionMatrix();
  };
  camera.position.set(16, 15, 16);
  setFrustum();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  Object.assign(labelRenderer.domElement.style, {
    position: "absolute",
    top: "0",
    left: "0",
    pointerEvents: "none", // let touches/clicks pass through to the canvas
  });
  container.appendChild(labelRenderer.domElement);

  // Controls MUST be attached to the canvas (the label layer ignores pointers).
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = 0.5;
  controls.maxPolarAngle = 1.15;
  controls.minZoom = 0.6;
  controls.maxZoom = 3;
  controls.target.set(0, 1, -0.5);
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };

  // ---- lighting ----
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d3c8, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(12, 20, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, far: 60 });
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbcd3ff, 0.4);
  fill.position.set(-10, 8, -6);
  scene.add(fill);

  buildRoom(scene);

  // ---------------------------------------------------------------
  // agents
  // ---------------------------------------------------------------
  const agents = {};

  function build(roster) {
    Object.values(agents).forEach((a) => scene.remove(a.group));
    for (const k in agents) delete agents[k];

    const list = [roster.manager, ...roster.specialists];
    list.forEach((meta, i) => {
      const a = makeAgent(new THREE.Color(meta.color));
      const t = list.length === 1 ? 0.5 : i / (list.length - 1);
      a.home = new THREE.Vector3(-4.5 + t * 9, 0, 1.4 + Math.sin(t * Math.PI) * -0.8);
      a.station = STATIONS[meta.station] || null;
      a.group.position.copy(a.home);
      a.baseTarget = a.home.clone();
      a.target = a.home.clone();
      a.wanderOffset = new THREE.Vector3();
      a.wanderTimer = Math.random() * 3;
      a.lookTarget = null;
      a.sitting = false;
      a.mode = "idle";
      a.meta = meta;
      a.phase = Math.random() * 6;

      const tag = document.createElement("div");
      tag.className = "agent-tag";
      tag.innerHTML = `<span class="dot" style="background:${meta.color}"></span>${meta.name}`;
      const tagObj = new CSS2DObject(tag);
      tagObj.position.set(0, 2.5, 0);
      a.group.add(tagObj);
      a.tagEl = tag;

      scene.add(a.group);
      agents[meta.id] = a;
    });
  }

  function goHome(a) {
    a.baseTarget.copy(a.home);
    a.lookTarget = null;
    a.sitting = false;
  }
  function goStation(a) {
    const s = a.station;
    if (!s) return goHome(a);
    a.baseTarget.set(s.pos[0], 0, s.pos[1]);
    a.lookTarget = new THREE.Vector3(s.look[0], 0, s.look[1]);
    a.sitting = !!s.sit;
  }

  function setStatus(id, status) {
    const a = agents[id];
    if (!a) return;
    a.mode = status || "idle";
    a.tagEl?.classList.toggle("active", status && status !== "idle" && status !== "done");
    if (status === "thinking" || status === "working" || status === "waiting") goStation(a);
    else goHome(a);
    a.wanderTimer = 0; // re-pick a wander target immediately
  }

  // flying "work packet"
  const packets = [];
  function sendPacket(fromId, toId) {
    const from = agents[fromId];
    const to = agents[toId];
    if (!from || !to) return;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.35, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x7c5cff, emissive: 0x7c5cff, emissiveIntensity: 0.5, roughness: 0.3 }),
    );
    mesh.castShadow = true;
    const start = from.group.position.clone().add(new THREE.Vector3(0, 1.6, 0));
    mesh.position.copy(start);
    scene.add(mesh);
    packets.push({ mesh, from: start, to: to.group.position.clone().add(new THREE.Vector3(0, 1.6, 0)), t: 0 });
  }

  function reset() {
    Object.values(agents).forEach((a) => {
      a.mode = "idle";
      goHome(a);
      a.tagEl?.classList.remove("active");
    });
  }

  // ---------------------------------------------------------------
  // animation
  // ---------------------------------------------------------------
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();

  function pickWander(a) {
    if (a.sitting) {
      a.wanderOffset.set(0, 0, 0);
      a.wanderTimer = 1;
      return;
    }
    let radius, time;
    if (a.mode === "working") { radius = 0.9; time = 1.6 + Math.random() * 1.2; } // pace around the station
    else if (a.mode === "idle" || a.mode === "done") { radius = 1.9; time = 3 + Math.random() * 4; } // wander the floor
    else { radius = 0.25; time = 2; } // thinking / waiting: mostly still
    const ang = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    a.wanderOffset.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    a.wanderTimer = time;
  }

  function animate() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    Object.values(agents).forEach((a) => {
      a.wanderTimer -= dt;
      if (a.wanderTimer <= 0) pickWander(a);

      a.target.copy(a.baseTarget).add(a.wanderOffset);
      // keep everyone on the floor
      a.target.x = THREE.MathUtils.clamp(a.target.x, -8, 8);
      a.target.z = THREE.MathUtils.clamp(a.target.z, -6, 5.5);

      tmp.copy(a.target).sub(a.group.position);
      tmp.y = 0;
      const dist = tmp.length();
      const moving = dist > 0.08;
      if (moving) {
        tmp.normalize();
        a.group.position.addScaledVector(tmp, Math.min(3.0 * dt, dist));
        a.group.rotation.y = lerpAngle(a.group.rotation.y, Math.atan2(tmp.x, tmp.z), 0.2);
      } else if (a.lookTarget) {
        const d = tmp.copy(a.lookTarget).sub(a.group.position);
        a.group.rotation.y = lerpAngle(a.group.rotation.y, Math.atan2(d.x, d.z), 0.15);
      }
      animateBody(a, t, moving, dist);
    });

    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      p.t += dt * 1.6;
      const k = Math.min(p.t, 1);
      p.mesh.position.lerpVectors(p.from, p.to, k);
      p.mesh.position.y += Math.sin(k * Math.PI) * 1.2;
      p.mesh.rotation.x += dt * 6;
      p.mesh.rotation.y += dt * 5;
      if (k >= 1) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        packets.splice(i, 1);
      }
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    requestAnimationFrame(animate);
  }
  animate();

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    labelRenderer.setSize(w, h);
    setFrustum();
  }
  window.addEventListener("resize", resize);
  // observe container size (mobile panels can change stage size without a window resize)
  if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
  resize();

  return { build, setStatus, sendPacket, reset };
}

// -----------------------------------------------------------------
// glossy little mascot with glowing eyes
// -----------------------------------------------------------------
function makeAgent(color) {
  const group = new THREE.Group();
  const gloss = new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.2 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.5, 6, 16), gloss);
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 24, 20), gloss);
  head.position.y = 1.75;
  head.scale.set(1, 0.92, 0.95);
  head.castShadow = true;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9fe8ff, emissiveIntensity: 1.6 });
  const eyeGeo = new THREE.SphereGeometry(0.09, 12, 12);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.16, 1.78, 0.4);
  eyeR.position.set(0.16, 1.78, 0.4);
  group.add(eyeL, eyeR);

  const limbGeo = new THREE.CapsuleGeometry(0.12, 0.4, 4, 8);
  const armL = new THREE.Mesh(limbGeo, gloss);
  const armR = new THREE.Mesh(limbGeo, gloss);
  armL.position.set(-0.5, 1.0, 0);
  armR.position.set(0.5, 1.0, 0);
  armL.castShadow = armR.castShadow = true;
  group.add(armL, armR);

  const legGeo = new THREE.CapsuleGeometry(0.14, 0.35, 4, 8);
  const legL = new THREE.Mesh(legGeo, gloss);
  const legR = new THREE.Mesh(legGeo, gloss);
  legL.position.set(-0.2, 0.35, 0);
  legR.position.set(0.2, 0.35, 0);
  legL.castShadow = legR.castShadow = true;
  group.add(legL, legR);

  return { group, parts: { body, head, armL, armR, legL, legR } };
}

function animateBody(a, t, moving, dist) {
  const { armL, armR, legL, legR, body, head } = a.parts;
  const p = t * 8 + a.phase;
  if (moving) {
    const s = Math.sin(p);
    legL.rotation.x = s * 0.7;
    legR.rotation.x = -s * 0.7;
    armL.rotation.x = -s * 0.6;
    armR.rotation.x = s * 0.6;
    body.position.y = 0.95 + Math.abs(Math.sin(p)) * 0.05;
    head.rotation.z = 0;
  } else if (a.mode === "working") {
    const s = Math.sin(t * 6 + a.phase);
    armR.rotation.x = -1.1 + s * 0.4;
    armL.rotation.x = s * 0.2;
    legL.rotation.x = legR.rotation.x = 0;
    body.position.y = 0.95 + Math.abs(s) * 0.04;
    head.rotation.z = s * 0.06;
  } else if (a.mode === "thinking" || a.mode === "waiting") {
    const s = Math.sin(t * 2 + a.phase);
    head.rotation.z = s * 0.12;
    armL.rotation.x = armR.rotation.x = 0;
    legL.rotation.x = legR.rotation.x = 0;
    body.position.y = 0.95;
  } else {
    const s = Math.sin(t * 1.6 + a.phase);
    body.position.y = 0.95 + s * 0.02;
    head.rotation.z = s * 0.04;
    armL.rotation.x = armR.rotation.x = 0;
    legL.rotation.x = legR.rotation.x = 0;
  }
  const seated = a.sitting && dist < 0.25;
  const targetY = seated ? 0.35 : 0;
  a.group.position.y += (targetY - a.group.position.y) * 0.15;
  if (seated) legL.rotation.x = legR.rotation.x = -1.2;
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// -----------------------------------------------------------------
// room + props
// -----------------------------------------------------------------
function label(text, sub, color) {
  const el = document.createElement("div");
  el.className = "prop-label";
  el.innerHTML =
    `<span class="dot" style="background:${color}"></span>` +
    `<span class="pl-main">${text}</span>` +
    (sub ? `<span class="pl-sub">${sub}</span>` : "");
  return new CSS2DObject(el);
}
function mkLabelChild(obj, x, y, z) {
  obj.position.set(x, y, z);
  return obj;
}

function buildRoom(scene) {
  const white = new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(19, 0.4, 15), white);
  floor.position.set(0, -0.2, -0.5);
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xecebe4, roughness: 1 });
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(19, 8, 0.3), wallMat);
  backWall.position.set(0, 3.8, -7.6);
  backWall.receiveShadow = true;
  scene.add(backWall);
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 15), wallMat);
  leftWall.position.set(-9.4, 3.8, -0.5);
  leftWall.receiveShadow = true;
  scene.add(leftWall);

  const wb = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 0.15), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }));
  wb.position.set(-3.6, 4.4, -7.4);
  wb.castShadow = true;
  scene.add(wb);
  wb.add(mkLabelChild(label("Whiteboard", "Ideas & Planning", "#f5c542"), 0, 1.7, 0.2));

  const kanban = new THREE.Group();
  kanban.position.set(5.4, 4.2, -7.2);
  kanban.add(new THREE.Mesh(new THREE.BoxGeometry(5.2, 3.4, 0.08), new THREE.MeshStandardMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.22, emissive: 0x3b82f6, emissiveIntensity: 0.5, roughness: 0.2 })));
  [0x8aa0b8, 0x3b82f6, 0xf5c542, 0x46c46e].forEach((c, i) => {
    for (let j = 0; j < 2; j++) {
      const card = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.05), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }));
      card.position.set(-1.9 + i * 1.25, 0.7 - j * 0.75, 0.1);
      kanban.add(card);
    }
  });
  scene.add(kanban);
  kanban.add(mkLabelChild(label("Kanban Wall", "Work Items · Active", "#3b82f6"), 0, 2.1, 0.2));

  const vault = new THREE.Group();
  vault.position.set(-8.6, 1.4, -1.4);
  const metal = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, metalness: 0.85, roughness: 0.35 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.6, 2.2), metal);
  box.castShadow = true;
  vault.add(box);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 1.9), new THREE.MeshStandardMaterial({ color: 0xd7dadd, metalness: 0.9, roughness: 0.3 }));
  door.position.set(0.9, 0, 0.9);
  door.rotation.y = -0.9;
  vault.add(door);
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 8, 20), metal);
  wheel.position.set(0.82, 0, 0);
  wheel.rotation.y = Math.PI / 2;
  vault.add(wheel);
  scene.add(vault);
  vault.add(mkLabelChild(label("Vault", "Secure Storage", "#46c46e"), 0, 1.9, 0));

  const desk = new THREE.Group();
  desk.position.set(-4.2, 0, 5.2);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.6 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.18, 1.5), wood);
  top.position.y = 1.1;
  top.castShadow = true;
  desk.add(top);
  [[-1.4, -0.6], [1.4, -0.6], [-1.4, 0.6], [1.4, 0.6]].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), wood);
    leg.position.set(x, 0.55, z);
    desk.add(leg);
  });
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a1830, emissive: 0x1f6feb, emissiveIntensity: 0.7 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
  for (const dx of [-0.75, 0.75]) {
    const mon = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.85, 0.08), frameMat);
    mon.position.set(dx, 1.85, -0.4);
    mon.rotation.x = -0.12;
    desk.add(mon);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.72), screenMat);
    scr.position.set(dx, 1.85, -0.355);
    scr.rotation.x = -0.12;
    desk.add(scr);
  }
  const chair = new THREE.Group();
  chair.position.set(-4.2, 0, 6.6);
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2f, roughness: 0.6 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.9), chairMat);
  seat.position.y = 0.9;
  chair.add(seat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.0, 0.15), chairMat);
  back.position.set(0, 1.4, 0.4);
  chair.add(back);
  scene.add(desk, chair);
  desk.add(mkLabelChild(label("Desk 01", "Active Compute", "#2f6bff"), 0, 2.7, 0));

  const sofa = new THREE.Group();
  sofa.position.set(4.8, 0, 5.4);
  const sofaMat = new THREE.MeshStandardMaterial({ color: 0xd9c9b0, roughness: 0.9 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 1.1), sofaMat);
  base.position.y = 0.5;
  base.castShadow = true;
  sofa.add(base);
  const bk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 0.3), sofaMat);
  bk.position.set(0, 0.9, 0.5);
  sofa.add(bk);
  scene.add(sofa);
  sofa.add(mkLabelChild(label("Lounge", "Drafting", "#14b8a6"), 0, 1.6, 0));

  const easel = new THREE.Group();
  easel.position.set(-1.0, 0, -5.6);
  const canvasM = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.7, 0.08), new THREE.MeshStandardMaterial({ color: 0xfff7ea, roughness: 0.6 }));
  canvasM.position.y = 1.8;
  canvasM.rotation.x = -0.12;
  canvasM.castShadow = true;
  easel.add(canvasM);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x9a6a3a });
  for (const dx of [-0.5, 0.5]) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2), legMat);
    l.position.set(dx, 1.1, 0.3);
    l.rotation.x = 0.2;
    easel.add(l);
  }
  scene.add(easel);
  easel.add(mkLabelChild(label("Easel", "Design", "#f97316"), 0, 1.4, 0));

  const gate = new THREE.Group();
  gate.position.set(1.8, 0, -1.2);
  const gm = new THREE.MeshStandardMaterial({ color: 0xb9bec4, metalness: 0.8, roughness: 0.35 });
  for (const dx of [-0.9, 0.9]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 0.9), gm);
    post.position.set(dx, 0.8, 0);
    post.castShadow = true;
    gate.add(post);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.7), new THREE.MeshStandardMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.3, emissive: 0x3b82f6, emissiveIntensity: 0.3 }));
    glass.position.set(dx + (dx < 0 ? 0.5 : -0.5), 0.9, 0);
    gate.add(glass);
  }
  scene.add(gate);
  gate.add(mkLabelChild(label("Security Gate", "Access Control", "#8aa0b8"), 0, 1.9, 0));

  scene.add(makePlant(-8.4, 5.6), makePlant(8.4, 5.6), makePlant(7.6, -6.0));

  const beam = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.5), new THREE.MeshBasicMaterial({ color: 0x9ad0ff, transparent: true, opacity: 0.18 }));
  beam.rotation.x = -Math.PI / 2;
  beam.position.set(-3.5, 0.02, -1.4);
  scene.add(beam);
}

function makePlant(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.28, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0xe6e2d8, roughness: 0.8 }));
  pot.position.y = 0.25;
  pot.castShadow = true;
  g.add(pot);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), new THREE.MeshStandardMaterial({ color: 0x4f8a5b, roughness: 0.7, flatShading: true }));
  leaves.position.y = 0.9;
  leaves.castShadow = true;
  g.add(leaves);
  return g;
}
