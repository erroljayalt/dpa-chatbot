"use client";

// Three.js background: a sphere of data points inside a gold protective shell, with orbit rings.
// Spins faster while the chatbot is searching/answering.

import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function DataCore({ busy }: { busy: boolean }) {
  const mount = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const el = mount.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // WebGL unavailable — page still works without the 3D scene
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 9);
    const core = new THREE.Group();
    scene.add(core);
    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

    // Inner sphere of points = personal data
    const pts: number[] = [];
    for (let i = 0; i < 1400; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pts.push(1.55 * s * Math.cos(t), 1.55 * u, 1.55 * s * Math.sin(t));
    }
    const sphereGeo = track(new THREE.BufferGeometry());
    sphereGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    core.add(new THREE.Points(sphereGeo, track(new THREE.PointsMaterial({ color: 0x9fb6ff, size: 0.028, transparent: true, opacity: 0.85 }))));

    // Protective shell = the law
    const shell = new THREE.LineSegments(
      track(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(2.25, 1))),
      track(new THREE.LineBasicMaterial({ color: 0xf0b84a, transparent: true, opacity: 0.55 }))
    );
    core.add(shell);

    // Orbit rings
    const rings: THREE.Mesh[] = [];
    ([[2.9, 0.4], [3.3, -0.7], [3.7, 1.2]] as const).forEach(([r, tilt], i) => {
      const ring = new THREE.Mesh(
        track(new THREE.TorusGeometry(r, 0.008, 6, 160)),
        track(new THREE.MeshBasicMaterial({ color: i === 1 ? 0xf0b84a : 0x5d74b8, transparent: true, opacity: 0.5 }))
      );
      ring.rotation.x = Math.PI / 2 + tilt;
      ring.rotation.y = tilt * 0.6;
      core.add(ring);
      rings.push(ring);
    });

    // Background dust
    const dust: number[] = [];
    for (let i = 0; i < 600; i++) dust.push((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 24, -Math.random() * 20 - 4);
    const dustGeo = track(new THREE.BufferGeometry());
    dustGeo.setAttribute("position", new THREE.Float32BufferAttribute(dust, 3));
    scene.add(new THREE.Points(dustGeo, track(new THREE.PointsMaterial({ color: 0x4b5c8c, size: 0.05 }))));

    const layout = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Desktop: upper-left, behind the title, clear of the "Try asking" list. Phone: dim, behind the header.
      if (w > 820) { core.position.set(-5.6, 2.2, -5); core.scale.setScalar(0.7); }
      else { core.position.set(0, 3.2, -3); core.scale.setScalar(0.6); }
    };
    layout();
    window.addEventListener("resize", layout);

    let mx = 0, my = 0, spin = 1, raf = 0;
    const onMove = (e: PointerEvent) => { mx = e.clientX / window.innerWidth - 0.5; my = e.clientY / window.innerHeight - 0.5; };
    window.addEventListener("pointermove", onMove);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const tick = () => {
      spin += ((busyRef.current ? 6 : 1) - spin) * 0.05;
      const d = still ? 0 : 0.003 * spin;
      core.rotation.y += d;
      shell.rotation.x -= d * 0.6;
      rings.forEach((r, i) => (r.rotation.z += d * (i + 1) * 0.7));
      core.rotation.x += (my * 0.4 - core.rotation.x) * 0.04;
      camera.position.x += (mx * 0.8 - camera.position.x) * 0.04;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", layout);
      window.removeEventListener("pointermove", onMove);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div id="stage" ref={mount} aria-hidden="true" />;
}
