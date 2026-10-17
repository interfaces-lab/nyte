import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  LineBasicMaterial,
  LineSegments,
  NormalBlending,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from "three";
import { GRAPH, VALUE_IMPORTS } from "./graph.ts";
import type { Import, Star } from "./graph.ts";

export type Rgb = readonly [number, number, number];

export type Palette = {
  readonly layers: readonly Rgb[];
  readonly ink: Rgb;
  readonly dark: boolean;
};

/** An orbit around the origin. */
export type Orbit = { yaw: number; pitch: number; distance: number };

export const HOME: Orbit = { yaw: 0.6, pitch: 0.5, distance: 29 };

const FIELD_OF_VIEW = 38;

/** What one frame draws: the layout's positions, each star's emphasis from 0 to 1, and the star under the pointer. */
export type Frame = {
  readonly orbit: Orbit;
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
  readonly time: number;
  readonly palette: Palette;
  readonly position: Float32Array;
  readonly emphasis: Float32Array;
  readonly focus: number | null;
};

/** A star on screen: its pixel position in the stage and its distance from the camera. */
export type Projected = { readonly x: number; readonly y: number; readonly w: number };

/** The galaxy's three.js scene, drawn into the stage's canvas. */
export type Galaxy = {
  readonly detail: string;
  draw(frame: Frame): void;
  project(frame: Frame, id: number): Projected;
  screenRadius(frame: Frame, star: Star, w: number): number;
  dispose(): void;
};

const POINT_VERTEX = `
attribute vec4 tint;
attribute float size;
uniform float scale;
varying vec4 vTint;
varying float vFog;
void main() {
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = max(size * scale / -view.z, 2.0);
  vFog = clamp(1.4 - -view.z / 45.0, 0.35, 1.0);
  vTint = tint;
}`;

const STAR_FRAGMENT = `
uniform float glow;
varying vec4 vTint;
varying float vFog;
void main() {
  vec2 p = (gl_PointCoord * 2.0 - 1.0) * 1.4;
  float r = length(p);
  float edge = fwidth(r);
  float core = 1.0 - smoothstep(1.0 - edge, 1.0 + edge, r);
  vec3 normal = vec3(p, sqrt(max(0.0, 1.0 - dot(p, p))));
  float light = 0.62 + 0.38 * max(dot(normal, normalize(vec3(-0.45, 0.55, 0.7))), 0.0);
  float rim = pow(1.0 - normal.z, 3.0) * 0.35;
  float halo = exp(-r * r * 1.4) * glow * (1.0 - core);
  float a = (core + halo * 0.55) * vTint.a * vFog;
  gl_FragColor = vec4(mix(vTint.rgb, vTint.rgb * light + rim, core) * a, a);
}`;

const SPARK_FRAGMENT = `
varying vec4 vTint;
varying float vFog;
void main() {
  float dot = 1.0 - smoothstep(0.2, 1.0, length(gl_PointCoord * 2.0 - 1.0));
  float a = vTint.a * dot * vFog;
  gl_FragColor = vec4(vTint.rgb * a, a);
}`;

const SPARKS = 2;

/** A points cloud whose positions, tints and sizes the frame rewrites. */
function createCloud(count: number, fragmentShader: string, additive: boolean) {
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(count * 3), 3);
  const tint = new BufferAttribute(new Float32Array(count * 4), 4);
  const size = new BufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute("position", position);
  geometry.setAttribute("tint", tint);
  geometry.setAttribute("size", size);
  const uniforms = { scale: { value: 1 }, glow: { value: 1 } };
  const material = new ShaderMaterial({
    vertexShader: POINT_VERTEX,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    premultipliedAlpha: true,
    blending: additive ? AdditiveBlending : NormalBlending,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;

  return { points, geometry, material, uniforms, position, tint, size };
}

function edgeColor(frame: Frame, edge: Import): readonly [number, number, number, number] {
  const { palette, emphasis, focus } = frame;
  const shown = Math.min(emphasis[edge.from] ?? 0, emphasis[edge.to] ?? 0);
  const rgb = palette.layers[GRAPH.stars[edge.from]?.layer ?? 0] ?? palette.ink;

  if (focus !== null && (edge.from === focus || edge.to === focus)) return [...rgb, 0.95];

  return [...rgb, (edge.typeOnly ? 0.07 : 0.2) * (focus === null ? 1 : 0.35) * shown];
}

/** Builds the scene, or throws when the browser has no WebGL2 for three.js. */
export function createGalaxy(canvas: HTMLCanvasElement): Galaxy {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 0.5, 120);
  const lineGeometry = new BufferGeometry();
  const linePosition = new BufferAttribute(new Float32Array(GRAPH.imports.length * 6), 3);
  const lineColor = new BufferAttribute(new Float32Array(GRAPH.imports.length * 8), 4);
  lineGeometry.setAttribute("position", linePosition);
  lineGeometry.setAttribute("color", lineColor);
  const lineMaterial = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const lines = new LineSegments(lineGeometry, lineMaterial);
  lines.frustumCulled = false;
  const sparks = createCloud(VALUE_IMPORTS.length * SPARKS, SPARK_FRAGMENT, true);
  const stars = createCloud(GRAPH.stars.length, STAR_FRAGMENT, false);
  scene.add(lines, sparks.points, stars.points);
  const context = renderer.getContext();
  const debug = context.getExtension("WEBGL_debug_renderer_info");
  const point = new Vector3();
  const eye = new Vector3();

  const aim = (frame: Frame): void => {
    const { yaw, pitch, distance } = frame.orbit;
    camera.position.set(
      Math.cos(pitch) * Math.sin(yaw) * distance,
      Math.sin(pitch) * distance,
      Math.cos(pitch) * Math.cos(yaw) * distance,
    );
    camera.lookAt(0, 0, 0);
    camera.aspect = frame.width / frame.height;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };

  const at = (frame: Frame, id: number): readonly number[] =>
    Array.from(frame.position.subarray(id * 3, id * 3 + 3));

  return {
    detail: debug === null ? "WebGL2" : String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
    draw(frame) {
      const { palette } = frame;
      renderer.setPixelRatio(frame.ratio);
      renderer.setSize(frame.width, frame.height, false);
      aim(frame);

      GRAPH.imports.forEach((edge, index) => {
        const color = edgeColor(frame, edge);
        linePosition.array.set([...at(frame, edge.from), ...at(frame, edge.to)], index * 6);
        lineColor.array.set([...color, ...color], index * 8);
      });
      linePosition.needsUpdate = true;
      lineColor.needsUpdate = true;

      VALUE_IMPORTS.forEach((edge, index) => {
        const [red, green, blue, alpha] = edgeColor(frame, edge);
        const from = at(frame, edge.from);
        const to = at(frame, edge.to);
        const span = Math.max(
          Math.hypot(...to.map((value, axis) => value - (from[axis] ?? 0))),
          0.5,
        );
        const strength = Math.min(1, alpha * (palette.dark ? 3.2 : 2.4));

        for (let spark = 0; spark < SPARKS; spark += 1) {
          const slot = index * SPARKS + spark;
          const t = (((index * 0.618 + spark / SPARKS + (frame.time * 0.9) / span) % 1) + 1) % 1;
          sparks.position.array.set(
            from.map((value, axis) => value + ((to[axis] ?? 0) - value) * t),
            slot * 3,
          );
          sparks.tint.array.set([red, green, blue, strength * Math.sin(t * Math.PI)], slot * 4);
          sparks.size.array[slot] = 0.09;
        }
      });
      sparks.material.blending = palette.dark ? AdditiveBlending : NormalBlending;

      const order = GRAPH.stars
        .map((star) => star.id)
        .toSorted(
          (left, right) =>
            eye.fromArray(at(frame, right)).distanceToSquared(camera.position) -
            point.fromArray(at(frame, left)).distanceToSquared(camera.position),
        );

      order.forEach((id, slot) => {
        const star = GRAPH.stars[id];

        if (star === undefined) return;
        stars.position.array.set(at(frame, id), slot * 3);
        stars.tint.array.set(
          [...(palette.layers[star.layer] ?? palette.ink), frame.emphasis[id] ?? 0],
          slot * 4,
        );
        stars.size.array[slot] = star.radius * 2.8;
      });

      const scale = (frame.height * frame.ratio) / (2 * Math.tan((FIELD_OF_VIEW * Math.PI) / 360));

      for (const cloud of [sparks, stars]) {
        cloud.position.needsUpdate = true;
        cloud.tint.needsUpdate = true;
        cloud.size.needsUpdate = true;
        cloud.uniforms.scale.value = scale;
      }

      stars.uniforms.glow.value = palette.dark ? 1 : 0.45;
      renderer.render(scene, camera);
    },
    project(frame, id) {
      aim(frame);
      point.fromArray(at(frame, id)).applyMatrix4(camera.matrixWorldInverse);
      const w = -point.z;
      point.applyMatrix4(camera.projectionMatrix);

      return {
        x: ((point.x + 1) / 2) * frame.width,
        y: ((1 - point.y) / 2) * frame.height,
        w,
      };
    },
    screenRadius(frame, star, w) {
      return (star.radius * frame.height) / (2 * Math.tan((FIELD_OF_VIEW * Math.PI) / 360)) / w;
    },
    dispose() {
      for (const disposable of [
        lineGeometry,
        lineMaterial,
        sparks.geometry,
        sparks.material,
        stars.geometry,
        stars.material,
      ])
        disposable.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
