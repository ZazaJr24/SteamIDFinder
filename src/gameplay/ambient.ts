/** Ambient block effects near the player: torch flames and smoke. */
import { BLOCKS } from '../world/blocks/blocks';
import { rotationForFacing, transformPoint } from '../world/blocks/models';
import type { World } from '../world/world';
import type { ParticleSystem } from '../render/effects';

interface Emitter {
  x: number;
  y: number;
  z: number;
  glut: boolean;
}

const RADIUS = 14;
const VERTICAL = 10;

export class AmbientEffects {
  private emitters: Emitter[] = [];
  private scanTimer = 0;
  private readonly torch = BLOCKS.get('torch');
  private readonly glutTorch = BLOCKS.get('glutstein_torch');
  private readonly tip: number[] = [0, 0, 0];

  constructor(
    private readonly particles: ParticleSystem,
    private readonly layers: { flame: number; glutFlame: number; smoke: number },
  ) {}

  update(dt: number, world: World, px: number, py: number, pz: number): void {
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = 0.5;
      this.scan(world, Math.floor(px), Math.floor(py), Math.floor(pz));
    }
    for (const e of this.emitters) {
      if (Math.random() < dt * 5) {
        this.particles.spawn({
          x: e.x + (Math.random() - 0.5) * 0.04,
          y: e.y,
          z: e.z + (Math.random() - 0.5) * 0.04,
          vx: 0,
          vy: 0.05,
          vz: 0,
          layer: e.glut ? this.layers.glutFlame : this.layers.flame,
          size: 0.07 + Math.random() * 0.03,
          life: 0.25 + Math.random() * 0.2,
          brightness: 1,
          gravity: -0.4,
        });
      }
      if (!e.glut && Math.random() < dt * 1.2) {
        this.particles.spawn({
          x: e.x,
          y: e.y + 0.05,
          z: e.z,
          vx: (Math.random() - 0.5) * 0.1,
          vy: 0.35,
          vz: (Math.random() - 0.5) * 0.1,
          layer: this.layers.smoke,
          size: 0.08 + Math.random() * 0.05,
          life: 1 + Math.random() * 0.8,
          brightness: 0.7,
          gravity: -0.3,
        });
      }
    }
  }

  private scan(world: World, cx: number, cy: number, cz: number): void {
    const found: Emitter[] = [];
    const t0 = this.torch.firstState;
    const t1 = t0 + this.torch.stateCount;
    const g0 = this.glutTorch.firstState;
    const g1 = g0 + this.glutTorch.stateCount;
    for (let y = Math.max(0, cy - VERTICAL); y <= Math.min(255, cy + VERTICAL); y++)
      for (let z = cz - RADIUS; z <= cz + RADIUS; z++)
        for (let x = cx - RADIUS; x <= cx + RADIUS; x++) {
          const s = world.getBlock(x, y, z);
          const glut = s >= g0 && s < g1;
          if (!glut && !(s >= t0 && s < t1)) continue;
          const facing = BLOCKS.propsOf(s).facing as string;
          if (facing === 'floor') {
            found.push({ x: x + 0.5, y: y + 0.72, z: z + 0.5, glut });
          } else {
            transformPoint({ rotateY: rotationForFacing(facing) }, 3.9, 13.4, 8, this.tip);
            found.push({
              x: x + this.tip[0]! / 16,
              y: y + this.tip[1]! / 16,
              z: z + this.tip[2]! / 16,
              glut,
            });
          }
        }
    this.emitters = found;
  }
}
