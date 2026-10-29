'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

function fatLine(
  geometry: LineGeometry | LineSegmentsGeometry,
  color: string,
  linewidth: number,
  opacity = 0.92,
) {
  const material = new LineMaterial({ color, linewidth, transparent: true, opacity, fog: true });
  return new LineSegments2(geometry, material);
}

function rod(from: THREE.Vector3, to: THREE.Vector3, color = '#c6a15b', linewidth = 4) {
  const geometry = new LineSegmentsGeometry().setPositions([from.x, from.y, from.z, to.x, to.y, to.z]);
  return fatLine(geometry, color, linewidth);
}

function circle(radius: number, x: number, y: number, z: number) {
  const positions: number[] = [];
  for (let index = 0; index <= 96; index += 1) {
    const angle = (index / 96) * Math.PI * 2;
    positions.push(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius);
  }
  return fatLine(new LineGeometry().setPositions(positions), '#e2c47e', 2.5);
}

export function HeroScene() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let renderer: THREE.WebGLRenderer | null = null;
    let frame = 0;
    let disposed = false;
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog('#10172a', 7, 15);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    camera.position.set(0, 0.18, 6.9);
    const sculpture = new THREE.Group();
    scene.add(sculpture);

    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor('#10172a', 0);
      sculpture.scale.setScalar(1.13);

      sculpture.add(rod(new THREE.Vector3(0, -2.15, 0), new THREE.Vector3(0, 1.95, 0)));
      sculpture.add(rod(new THREE.Vector3(-2.55, 1.17, 0), new THREE.Vector3(2.55, 1.17, 0)));
      sculpture.add(rod(new THREE.Vector3(0, 1.95, 0), new THREE.Vector3(-0.42, 1.32, 0), '#e2c47e'));
      sculpture.add(rod(new THREE.Vector3(0, 1.95, 0), new THREE.Vector3(0.42, 1.32, 0), '#e2c47e'));
      sculpture.add(rod(new THREE.Vector3(-2.38, 1.17, 0), new THREE.Vector3(-2.38, -0.22, 0)));
      sculpture.add(rod(new THREE.Vector3(2.38, 1.17, 0), new THREE.Vector3(2.38, -0.22, 0)));
      sculpture.add(circle(0.91, -2.38, -0.24, 0));
      sculpture.add(circle(0.91, 2.38, -0.24, 0));
      sculpture.add(
        rod(new THREE.Vector3(-0.55, -2.15, 0), new THREE.Vector3(0.55, -2.15, 0), '#c6a15b', 4.5),
      );

      const accent = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12, 0),
        new THREE.MeshBasicMaterial({ color: '#4f46e5' }),
      );
      accent.position.set(0, 1.96, 0.02);
      sculpture.add(accent);

      const resize = () => {
        if (!renderer || !host) return;
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        scene.traverse((object) => {
          if (object instanceof LineSegments2) object.material.resolution.set(width, height);
        });
        renderer.render(scene, camera);
      };
      const onPointerMove = (event: PointerEvent) => {
        const rect = host.getBoundingClientRect();
        targetY = ((event.clientX - rect.left) / rect.width - 0.5) * 0.28;
        targetX = ((event.clientY - rect.top) / rect.height - 0.5) * 0.2;
      };
      const onPointerLeave = () => {
        targetX = 0;
        targetY = 0;
      };
      window.addEventListener('resize', resize);
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerleave', onPointerLeave);
      resize();

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (!reducedMotion.matches) {
        let previous = 0;
        const animate = (time: number) => {
          if (disposed || !renderer) return;
          const delta = previous ? Math.min((time - previous) / 1000, 0.05) : 0;
          previous = time;
          pointerX += (targetX - pointerX) * 0.035;
          pointerY += (targetY - pointerY) * 0.035;
          sculpture.rotation.x = pointerX;
          sculpture.rotation.y += delta * 0.12 + (targetY - pointerY) * 0.015;
          sculpture.rotation.z = pointerY;
          renderer.render(scene, camera);
          frame = window.requestAnimationFrame(animate);
        };
        frame = window.requestAnimationFrame(animate);
      }

      return () => {
        disposed = true;
        window.cancelAnimationFrame(frame);
        window.removeEventListener('resize', resize);
        host.removeEventListener('pointermove', onPointerMove);
        host.removeEventListener('pointerleave', onPointerLeave);
        scene.traverse((object) => {
          if (object instanceof THREE.Mesh || object instanceof LineSegments2) {
            object.geometry.dispose();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => material.dispose());
          }
        });
        renderer?.dispose();
        renderer = null;
      };
    } catch {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof LineSegments2) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer?.dispose();
      renderer = null;
      setFallback(true);
    }
  }, []);

  return (
    <div className="landing-scene" ref={hostRef}>
      {fallback && <img className="landing-scene-fallback" src="/brand/legal-scales.jpg" alt="" />}
      <canvas ref={canvasRef} aria-hidden="true" />
      <div className="landing-scene-caption" aria-hidden="true">
        <span /> GROUNDED IN THE RECORD
      </div>
    </div>
  );
}
