// supabase/functions/_shared/tuning.ts
//
// A direct port of sanitizeTuning() from js/sim/build.js.
//
// The browser clamps tuning values so the sliders behave. That is a convenience,
// not a defence — anyone can POST whatever they like to this endpoint. So the
// server clamps them AGAIN here, using the base ratios and rpm limits read out
// of car_definitions, and stores only what comes out of this function.
//
// If you change TUNING_LIMITS in js/sim/build.js, change it here too.

export interface CarBase {
  base_ratios: number[];
  base_final_drive: number;
  base_front_psi: number;
  base_rear_psi: number;
  idle_rpm: number;
  redline_rpm: number;
  limiter_rpm: number;
  float_rpm: number;
}

export interface Tuning {
  finalDrive: number;
  gearRatios: number[];
  frontPsi: number;
  rearPsi: number;
  launchRpm: number;
  shiftRpm: number;
  boostTargetKpa: number;
  throttleMap: string;
  clutchEngageSpeed: number;
}

export const TUNING_LIMITS = {
  finalDrive: { min: 2.5, max: 6.2 },
  gearRatio: { min: 0.45, max: 5.0 },
  pressurePsi: { min: 8, max: 55 },
  launchRpm: { min: 800, max: 9500 },
  shiftRpm: { min: 1500, max: 9800 },
  boostTargetKpa: { min: 0, max: 320 },
  clutchEngageSpeed: { min: 0.3, max: 4.0 },
  throttleMap: ['linear', 'progressive', 'aggressive'],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function defaultTuning(car: CarBase): Tuning {
  return {
    finalDrive: Number(car.base_final_drive),
    gearRatios: (car.base_ratios || []).map(Number),
    frontPsi: Number(car.base_front_psi),
    rearPsi: Number(car.base_rear_psi),
    launchRpm: Math.max(Number(car.idle_rpm), Math.round(Number(car.redline_rpm) * 0.42)),
    shiftRpm: Math.round(Number(car.redline_rpm) * 0.96),
    boostTargetKpa: 0,
    throttleMap: 'linear',
    clutchEngageSpeed: 1.6,
  };
}

export function sanitizeTuning(car: CarBase, tuning: Record<string, unknown> = {}): Tuning {
  const base = defaultTuning(car);
  const L = TUNING_LIMITS;
  const t = (tuning && typeof tuning === 'object') ? tuning as Record<string, any> : {};
  const out: Tuning = { ...base };

  out.finalDrive = clamp(Number(t.finalDrive) || base.finalDrive, L.finalDrive.min, L.finalDrive.max);

  const given = Array.isArray(t.gearRatios) ? t.gearRatios : base.gearRatios;
  // The gear COUNT comes from the car definition, never from the request: you
  // do not get a nine-speed by asking for one.
  out.gearRatios = base.gearRatios.map((def, i) => {
    const v = Number(given[i]);
    if (!Number.isFinite(v)) return def;
    return clamp(v, L.gearRatio.min, L.gearRatio.max);
  });
  for (let i = 1; i < out.gearRatios.length; i++) {
    if (out.gearRatios[i] >= out.gearRatios[i - 1]) {
      out.gearRatios[i] = out.gearRatios[i - 1] * 0.92;
    }
  }
  out.gearRatios = out.gearRatios.map((v) => Math.round(v * 1000) / 1000);

  out.frontPsi = clamp(Number(t.frontPsi) || base.frontPsi, L.pressurePsi.min, L.pressurePsi.max);
  out.rearPsi = clamp(Number(t.rearPsi) || base.rearPsi, L.pressurePsi.min, L.pressurePsi.max);
  out.launchRpm = clamp(Number(t.launchRpm) || base.launchRpm, L.launchRpm.min, Number(car.limiter_rpm));
  out.shiftRpm = clamp(Number(t.shiftRpm) || base.shiftRpm, L.shiftRpm.min, Number(car.float_rpm));
  out.boostTargetKpa = clamp(Number(t.boostTargetKpa) || 0, L.boostTargetKpa.min, L.boostTargetKpa.max);
  out.throttleMap = L.throttleMap.includes(String(t.throttleMap)) ? String(t.throttleMap) : 'linear';
  out.clutchEngageSpeed = clamp(
    Number(t.clutchEngageSpeed) || 1.6, L.clutchEngageSpeed.min, L.clutchEngageSpeed.max);

  out.finalDrive = Math.round(out.finalDrive * 1000) / 1000;
  out.frontPsi = Math.round(out.frontPsi * 10) / 10;
  out.rearPsi = Math.round(out.rearPsi * 10) / 10;
  out.launchRpm = Math.round(out.launchRpm);
  out.shiftRpm = Math.round(out.shiftRpm);
  out.boostTargetKpa = Math.round(out.boostTargetKpa);
  out.clutchEngageSpeed = Math.round(out.clutchEngageSpeed * 10) / 10;

  return out;
}
