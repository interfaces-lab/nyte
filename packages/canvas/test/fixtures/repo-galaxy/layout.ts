import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { GRAPH, LAYERS } from "./graph.ts";

type Body = SimulationNodeDatum & { readonly id: number; readonly layer: number };

type Spring = SimulationLinkDatum<Body> & { readonly strength: number };

/** World units per d3-force unit. */
const SCALE = 0.042;

/** The galaxy's layout: one xyz triple per star in `position`, which `step` advances by one tick until the simulation cools. */
export type Layout = {
  readonly position: Float32Array;
  step(): boolean;
  settle(): void;
};

/**
 * Lays the stars out with d3-force in the galaxy's plane: modules repel,
 * imports pull like springs (type-only and package imports barely), and each
 * layer gathers at its own point on a ring. A star's height above the plane
 * comes from its layer, so the disc reads in depth as the camera orbits.
 * d3-force seeds its own randomness, so every load forms the same galaxy.
 */
export function createLayout(): Layout {
  const anchors = LAYERS.map((_, index) => {
    const ring = 120 + (index % 3) * 46;

    return { x: Math.cos(index * 2.4) * ring, y: Math.sin(index * 2.4) * ring };
  });
  const bodies: Body[] = GRAPH.stars.map((star) => ({ id: star.id, layer: star.layer }));
  const springs: Spring[] = GRAPH.imports.map((edge) => ({
    source: edge.from,
    target: edge.to,
    strength: GRAPH.stars[edge.to]?.path === null ? 0.004 : edge.typeOnly ? 0.03 : 0.07,
  }));
  const simulation = forceSimulation(bodies)
    .force("charge", forceManyBody<Body>().strength(-70).distanceMax(420))
    .force(
      "link",
      forceLink<Body, Spring>(springs)
        .id((body) => body.id)
        .distance(44)
        .strength((spring) => spring.strength),
    )
    .force("x", forceX<Body>((body) => anchors[body.layer]?.x ?? 0).strength(0.05))
    .force("y", forceY<Body>((body) => anchors[body.layer]?.y ?? 0).strength(0.05))
    .force(
      "collide",
      forceCollide<Body>((body) => (GRAPH.stars[body.id]?.radius ?? 0.2) / SCALE + 3),
    )
    .alphaDecay(0.014)
    .stop();
  const position = new Float32Array(bodies.length * 3);
  const middle = (LAYERS.length - 1) / 2;

  const write = (): void => {
    for (const body of bodies)
      position.set(
        [
          (body.x ?? 0) * SCALE,
          (body.layer - middle) * 0.45 + Math.sin(body.id * 1.7) * 0.6,
          (body.y ?? 0) * SCALE,
        ],
        body.id * 3,
      );
  };

  write();

  return {
    position,
    step() {
      if (simulation.alpha() < simulation.alphaMin()) return false;
      simulation.tick();
      write();

      return true;
    },
    settle() {
      while (simulation.alpha() >= simulation.alphaMin()) simulation.tick();
      write();
    },
  };
}
