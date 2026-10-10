import { M_PER_DEG, haversineM } from '@perspice/shared';

export interface MobileOptions {
  center: { lat: number; lng: number };
  radiusKm: number;
}

export interface MobileFix {
  lat: number;
  lng: number;
  /** km/h; 0 while parked. */
  speed: number;
  heading: number;
  /** metres */
  acc: number;
}

const between = (rand: () => number, a: number, b: number) => a + (b - a) * rand();
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * A vehicle that drives (25–70 km/h, wandering heading, turning back at the edge of its area)
 * for 3–15 minutes, then parks for 6–20 minutes with a few metres of GPS jitter. Each call is
 * one fix, `intervalS` after the previous one.
 */
export function mobileRoute(opts: MobileOptions, intervalS: number, rand: () => number = Math.random): () => MobileFix {
  const radiusM = opts.radiusKm * 1000;
  // Start somewhere inside the area.
  const r = Math.sqrt(rand()) * radiusM * 0.8;
  const a = rand() * 2 * Math.PI;
  let pos = { lat: opts.center.lat + (r * Math.cos(a)) / M_PER_DEG, lng: opts.center.lng + (r * Math.sin(a)) / (M_PER_DEG * Math.cos((opts.center.lat * Math.PI) / 180)) };
  let heading = rand() * 360;
  let parked = rand() < 0.5;
  let phaseLeftS = parked ? between(rand, 360, 1200) : between(rand, 180, 900);
  let speed = between(rand, 25, 70);
  const parkedAt = { ...pos };

  return () => {
    phaseLeftS -= intervalS;
    if (phaseLeftS <= 0) {
      parked = !parked;
      phaseLeftS = parked ? between(rand, 360, 1200) : between(rand, 180, 900);
      speed = between(rand, 25, 70);
      if (parked) Object.assign(parkedAt, pos);
    }
    if (parked) {
      // GPS jitter around the parked spot.
      const j = () => (rand() * 2 - 1) * 4;
      const fix = { lat: parkedAt.lat + j() / M_PER_DEG, lng: parkedAt.lng + j() / (M_PER_DEG * Math.cos((parkedAt.lat * Math.PI) / 180)) };
      return { lat: round6(fix.lat), lng: round6(fix.lng), speed: 0, heading: Math.round(heading) % 360, acc: 5 };
    }
    heading = (heading + (rand() * 2 - 1) * 20 + 360) % 360;
    speed = Math.min(70, Math.max(25, speed + (rand() * 2 - 1) * 5));
    const stepM = (speed / 3.6) * intervalS;
    const rad = (heading * Math.PI) / 180;
    let next = {
      lat: pos.lat + (stepM * Math.cos(rad)) / M_PER_DEG,
      lng: pos.lng + (stepM * Math.sin(rad)) / (M_PER_DEG * Math.cos((pos.lat * Math.PI) / 180)),
    };
    if (haversineM(opts.center, next) > radiusM) {
      // Turn back towards the centre.
      heading = ((Math.atan2(opts.center.lng - pos.lng, opts.center.lat - pos.lat) * 180) / Math.PI + 360) % 360;
      const back = (heading * Math.PI) / 180;
      next = {
        lat: pos.lat + (stepM * Math.cos(back)) / M_PER_DEG,
        lng: pos.lng + (stepM * Math.sin(back)) / (M_PER_DEG * Math.cos((pos.lat * Math.PI) / 180)),
      };
    }
    pos = next;
    return { lat: round6(pos.lat), lng: round6(pos.lng), speed: Math.round(speed * 10) / 10, heading: Math.round(heading) % 360, acc: 5 };
  };
}
