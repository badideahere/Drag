// js/game/race.js
// Staging, the Christmas tree, the timing system and the timeslip.
//
// Timing follows real drag-racing practice:
//   * the ET clock starts when the car rolls out of the stage beam, NOT when
//     the tree goes green;
//   * reaction time is (stage-beam exit) - (green), so a perfect light is 0.000
//     on a pro tree and anything negative is a red light;
//   * trap speed is the average speed over the last 66 ft before the stripe,
//     which is why trap speed and finish-line speed are not the same number.

import { FT_TO_M, M_TO_FT, MPS_TO_MPH, fmtTime } from '../sim/util.js';

export const DISTANCES = [
  { id: 'eighth', label: '1/8 Mile', feet: 660 },
  { id: 'thousand', label: '1000 ft', feet: 1000 },
  { id: 'quarter', label: '1/4 Mile', feet: 1320 },
];

export const TREE_TYPES = {
  pro: { id: 'pro', name: 'Pro Tree', label: 'all three ambers at once, 0.400 s to green' },
  sportsman: { id: 'sportsman', name: 'Sportsman Tree', label: 'ambers 0.500 s apart' },
};

const SPLITS = [
  { ft: 60, key: 'sixty' },
  { ft: 330, key: 'threeThirty' },
  { ft: 594, key: 'trap8Entry', silent: true },
  { ft: 660, key: 'eighth' },
  { ft: 1000, key: 'thousand' },
  { ft: 1254, key: 'trap4Entry', silent: true },
  { ft: 1320, key: 'quarter' },
];

/** Per-lane timing. One of these exists for the player and for each opponent. */
export class LaneTiming {
  constructor(distanceFt) {
    this.distanceFt = distanceFt;
    this.reset();
  }

  reset() {
    this.preStaged = false;
    this.staged = false;
    this.launchTime = null;    // when the car left the stage beam
    this.foul = false;
    this.splits = {};
    this.speeds = {};
    this.finished = false;
    this.finishTime = null;
    this.eighthMph = 0;
    this.quarterMph = 0;
    this.trapMph = 0;
    this.et = 0;
    this.reaction = null;
    this.peakMph = 0;
    this.nextSplit = 0;
    this._lastPos = -10;
  }

  /**
   * @param {number} posFt distance from the stage beam, in feet
   * @param {number} speedMph
   * @param {number} t race clock
   * @param {number|null} greenTime
   */
  update(posFt, speedMph, t, greenTime) {
    this.peakMph = Math.max(this.peakMph, speedMph);

    if (this.launchTime == null && posFt > 0 && this._lastPos <= 0) {
      this.launchTime = t;
      if (greenTime == null) {
        this.foul = true;             // left before the tree was even lit
        this.reaction = null;
      } else {
        this.reaction = t - greenTime;
        if (this.reaction < 0) this.foul = true;
      }
    }
    this._lastPos = posFt;
    if (this.launchTime == null) return;

    const et = t - this.launchTime;
    while (this.nextSplit < SPLITS.length) {
      const s = SPLITS[this.nextSplit];
      if (posFt < s.ft) break;
      this.splits[s.key] = et;
      this.speeds[s.key] = speedMph;
      this.nextSplit++;
    }

    if (!this.finished && posFt >= this.distanceFt) {
      this.finished = true;
      this.finishTime = t;
      this.et = et;
      this.computeTraps();
    }
  }

  computeTraps() {
    // Average speed over the last 66 ft: 66 ft / (t_exit - t_entry).
    const trap = (entryKey, exitKey) => {
      const a = this.splits[entryKey], b = this.splits[exitKey];
      if (a == null || b == null || b <= a) return 0;
      return (66 * FT_TO_M) / (b - a) * MPS_TO_MPH;
    };
    this.eighthMph = trap('trap8Entry', 'eighth');
    this.quarterMph = trap('trap4Entry', 'quarter');
    this.trapMph = this.distanceFt >= 1320 ? this.quarterMph
      : this.distanceFt >= 1000 ? (this.speeds.thousand || 0)
        : this.eighthMph;
  }

  /** Everything the timeslip prints. */
  slip() {
    return {
      reaction: this.reaction,
      foul: this.foul,
      sixty: this.splits.sixty ?? null,
      threeThirty: this.splits.threeThirty ?? null,
      eighthEt: this.splits.eighth ?? null,
      eighthMph: this.eighthMph || null,
      thousandEt: this.splits.thousand ?? null,
      quarterEt: this.splits.quarter ?? null,
      quarterMph: this.quarterMph || null,
      et: this.finished ? this.et : null,
      trapMph: this.trapMph || null,
      peakMph: this.peakMph,
      distanceFt: this.distanceFt,
      finished: this.finished,
    };
  }
}

/**
 * A single run down the track. Owns the tree, both lanes' timing and the
 * win/lose decision (including bracket breakout rules).
 */
export class RaceSession {
  /**
   * @param {object} cfg {
   *   distanceFt, tree: 'pro'|'sportsman', mode, autoStage,
   *   playerDial, opponentDial   (bracket racing, in seconds)
   * }
   */
  constructor(cfg = {}) {
    this.cfg = {
      distanceFt: 1320,
      tree: 'pro',
      mode: 'test',
      autoStage: false,
      playerDial: null,
      opponentDial: null,
      ...cfg,
    };
    this.player = new LaneTiming(this.cfg.distanceFt);
    this.opponent = new LaneTiming(this.cfg.distanceFt);
    this.hasOpponent = this.cfg.mode !== 'test' && this.cfg.mode !== 'free';
    this.reset();
  }

  reset() {
    this.time = 0;
    this.state = 'staging';     // staging -> countdown -> running -> finished
    this.player.reset();
    this.opponent.reset();
    this.treeLights = {
      preStage: false, stage: false,
      preStageOpp: false, stageOpp: false,
      amber1: false, amber2: false, amber3: false,
      green: false, red: false,
      greenOpp: false, redOpp: false,
    };
    this.greenTime = null;
    this.greenTimeOpp = null;
    this.sequenceStart = null;
    this.handicap = 0;          // seconds the quicker car is held back
    this.winner = null;
    this.message = 'STAGE THE CAR';
    this.events = [];
    this.finishedAt = null;
    this._bothStagedAt = null;
    this._lastTreeT = -1;

    if (this.cfg.mode === 'bracket' && this.cfg.playerDial && this.cfg.opponentDial) {
      this.handicap = Math.abs(this.cfg.playerDial - this.cfg.opponentDial);
      this.slowerLane = this.cfg.playerDial > this.cfg.opponentDial ? 'player' : 'opponent';
    } else {
      this.slowerLane = null;
    }
  }

  emit(e) { this.events.push(e); }
  drainEvents() { const e = this.events; this.events = []; return e; }

  get running() { return this.state === 'running' || this.state === 'countdown'; }

  /**
   * @param {number} dt
   * @param {object} lanes { player: Vehicle, opponent: Vehicle|null }
   */
  update(dt, lanes) {
    this.time += dt;
    const pv = lanes.player;
    const ov = lanes.opponent || null;

    const pFt = pv.position * M_TO_FT;
    const oFt = ov ? ov.position * M_TO_FT : -99;

    // ---------------------------------------------------------- staging
    if (this.state === 'staging') {
      this.updateStageBeams(pv, ov);
      const pOk = this.player.staged;
      const oOk = !this.hasOpponent || this.opponent.staged;
      if (pOk && oOk) {
        if (this._bothStagedAt == null) this._bothStagedAt = this.time;
        // Real starters wait a moment, and not always the same moment.
        const delay = 0.55 + Math.random() * 0.85;
        if (this.time - this._bothStagedAt > delay) {
          this.state = 'countdown';
          this.sequenceStart = this.time;
          this.message = '';
          this.emit({ type: 'sequence' });
        }
      } else {
        this._bothStagedAt = null;
        this.message = this.player.preStaged
          ? (this.player.staged ? 'WAITING ON THE OTHER LANE' : 'ROLL IN TO STAGE')
          : 'ROLL FORWARD TO PRE-STAGE';
      }
    }

    // --------------------------------------------------------- the tree
    if (this.state === 'countdown') {
      this.updateTree();
      if (this.greenTime != null && (!this.hasOpponent || this.greenTimeOpp != null)
        && this.time > Math.max(this.greenTime, this.greenTimeOpp ?? 0)) {
        this.state = 'running';
      }
    }

    // ---------------------------------------------------- foul detection
    if (this.state === 'countdown' || this.state === 'running') {
      if (!this.player.foul && this.player.launchTime == null && pFt > 0
        && (this.greenTime == null || this.time < this.greenTime)) {
        // handled inside LaneTiming, but the tree needs to show red
      }
    }

    // ------------------------------------------------------------ timing
    const wasFoulP = this.player.foul;
    this.player.update(pFt, pv.speed * MPS_TO_MPH, this.time, this.greenTime);
    if (this.player.foul && !wasFoulP) {
      this.treeLights.red = true;
      this.message = 'RED LIGHT — FOUL START';
      this.emit({ type: 'foul', lane: 'player' });
    }
    if (ov) {
      const wasFoulO = this.opponent.foul;
      this.opponent.update(oFt, ov.speed * MPS_TO_MPH, this.time, this.greenTimeOpp);
      if (this.opponent.foul && !wasFoulO) {
        this.treeLights.redOpp = true;
        this.emit({ type: 'foul', lane: 'opponent' });
      }
    }

    // ------------------------------------------------------------ finish
    if (this.state === 'running' || this.state === 'countdown') {
      const pDone = this.player.finished;
      const oDone = !this.hasOpponent || !ov || this.opponent.finished;
      if (pDone && this.finishedAt == null) this.emit({ type: 'playerFinish' });
      if (pDone && oDone) {
        this.state = 'finished';
        this.finishedAt = this.time;
        this.decide();
        this.emit({ type: 'finished' });
      } else if (pDone && this.time - (this.player.finishTime || 0) > 6) {
        // Opponent broke or gave up; do not hang the screen forever.
        this.state = 'finished';
        this.finishedAt = this.time;
        this.decide();
        this.emit({ type: 'finished' });
      }
    }
  }

  updateStageBeams(pv, ov) {
    const pFt = pv.position * M_TO_FT;
    const pre = -1.8, stg = -0.6;    // feet relative to the stage beam
    const wasPre = this.player.preStaged;
    const wasStg = this.player.staged;
    this.player.preStaged = pFt > pre;
    this.player.staged = pFt > stg && Math.abs(pv.speed) < 1.2;
    this.treeLights.preStage = this.player.preStaged;
    this.treeLights.stage = this.player.staged;
    if (this.player.preStaged && !wasPre) this.emit({ type: 'bulb' });
    if (this.player.staged && !wasStg) this.emit({ type: 'bulb' });

    if (ov) {
      const oFt = ov.position * M_TO_FT;
      this.opponent.preStaged = oFt > pre;
      this.opponent.staged = oFt > stg && Math.abs(ov.speed) < 1.2;
      this.treeLights.preStageOpp = this.opponent.preStaged;
      this.treeLights.stageOpp = this.opponent.staged;
    }
  }

  updateTree() {
    const t = this.time - this.sequenceStart;
    const pro = this.cfg.tree === 'pro';
    const L = this.treeLights;

    // In a bracket race the quicker car is held on the line by the difference
    // in dial-ins. Both trees run the same sequence, just offset in time.
    const offP = this.slowerLane === 'player' ? 0 : this.handicap;
    const offO = this.slowerLane === 'opponent' ? 0 : this.handicap;

    const seq = (elapsed) => {
      if (pro) {
        return {
          a1: elapsed >= 0, a2: elapsed >= 0, a3: elapsed >= 0,
          green: elapsed >= 0.4,
        };
      }
      return {
        a1: elapsed >= 0,
        a2: elapsed >= 0.5,
        a3: elapsed >= 1.0,
        green: elapsed >= 1.5,
      };
    };

    const sp = seq(t - offP);
    L.amber1 = sp.a1 && !sp.green;
    L.amber2 = sp.a2 && !sp.green;
    L.amber3 = sp.a3 && !sp.green;
    if (sp.green && this.greenTime == null) {
      this.greenTime = this.sequenceStart + offP + (pro ? 0.4 : 1.5);
      this.emit({ type: 'green', lane: 'player' });
    }
    L.green = !!sp.green && !L.red;

    if (this.hasOpponent) {
      const so = seq(t - offO);
      if (so.green && this.greenTimeOpp == null) {
        this.greenTimeOpp = this.sequenceStart + offO + (pro ? 0.4 : 1.5);
        this.emit({ type: 'green', lane: 'opponent' });
      }
      L.greenOpp = !!so.green && !L.redOpp;
    } else {
      this.greenTimeOpp = this.greenTime;
    }

    // Amber ticks for audio
    const ticks = pro ? [0] : [0, 0.5, 1.0];
    for (const tick of ticks) {
      const at = tick + offP;
      if (this._lastTreeT < at && t >= at) this.emit({ type: 'amber' });
    }
    this._lastTreeT = t;
  }

  /** Work out who actually won, applying foul and breakout rules. */
  decide() {
    const p = this.player, o = this.opponent;
    if (!this.hasOpponent) {
      this.winner = p.finished && !p.foul ? 'player' : null;
      this.message = p.foul ? 'FOUL START' : 'RUN COMPLETE';
      return;
    }

    const bracket = this.cfg.mode === 'bracket'
      && this.cfg.playerDial != null && this.cfg.opponentDial != null;

    const pBreakout = bracket && p.finished && p.et < this.cfg.playerDial - 0.0005;
    const oBreakout = bracket && o.finished && o.et < this.cfg.opponentDial - 0.0005;

    const pDead = p.foul || !p.finished;
    const oDead = o.foul || !o.finished;

    // Fouls lose first, then breakouts, then the stripe.
    if (pDead && oDead) { this.winner = null; this.message = 'DOUBLE DISQUALIFICATION'; return; }
    if (pDead) { this.winner = 'opponent'; this.message = p.foul ? 'RED LIGHT — YOU LOSE' : 'DID NOT FINISH'; return; }
    if (oDead) { this.winner = 'player'; this.message = o.foul ? 'OPPONENT RED-LIT — YOU WIN' : 'OPPONENT DID NOT FINISH'; return; }

    if (pBreakout && oBreakout) {
      // Both broke out: the one who broke out by less wins.
      const pm = this.cfg.playerDial - p.et;
      const om = this.cfg.opponentDial - o.et;
      this.winner = pm < om ? 'player' : 'opponent';
      this.message = 'DOUBLE BREAKOUT — CLOSEST TO THE DIAL WINS';
      return;
    }
    if (pBreakout) { this.winner = 'opponent'; this.message = 'BROKE OUT — YOU LOSE'; return; }
    if (oBreakout) { this.winner = 'player'; this.message = 'OPPONENT BROKE OUT — YOU WIN'; return; }

    // Package racing: the winner is whoever crosses the stripe first in real
    // time, which includes reaction time and any handicap.
    const pFinish = p.finishTime ?? Infinity;
    const oFinish = o.finishTime ?? Infinity;
    if (Math.abs(pFinish - oFinish) < 0.0005) { this.winner = null; this.message = 'DEAD HEAT'; return; }
    this.winner = pFinish < oFinish ? 'player' : 'opponent';
    const margin = Math.abs(pFinish - oFinish);
    this.message = this.winner === 'player'
      ? `WIN — BY ${margin.toFixed(3)} s`
      : `LOSS — BY ${margin.toFixed(3)} s`;
  }

  /** Margin of victory in seconds, for the timeslip. */
  margin() {
    if (!this.hasOpponent) return null;
    const a = this.player.finishTime, b = this.opponent.finishTime;
    if (a == null || b == null) return null;
    return Math.abs(a - b);
  }

  /** Full timeslip data for the result screen and for the server. */
  timeslip() {
    return {
      mode: this.cfg.mode,
      distanceFt: this.cfg.distanceFt,
      tree: this.cfg.tree,
      winner: this.winner,
      message: this.message,
      margin: this.margin(),
      playerDial: this.cfg.playerDial,
      opponentDial: this.cfg.opponentDial,
      player: this.player.slip(),
      opponent: this.hasOpponent ? this.opponent.slip() : null,
    };
  }
}

/** Formats one lane of a timeslip for display. */
export function slipRows(slip, distanceFt) {
  const rows = [
    ['REACTION', slip.foul && slip.reaction == null ? 'FOUL' : slip.reaction == null ? '—' : fmtTime(slip.reaction, 3)],
    ['60 FT', slip.sixty == null ? '—' : fmtTime(slip.sixty, 3)],
    ['330 FT', slip.threeThirty == null ? '—' : fmtTime(slip.threeThirty, 3)],
  ];
  if (distanceFt >= 660) {
    rows.push(['1/8 ET', slip.eighthEt == null ? '—' : fmtTime(slip.eighthEt, 3)]);
    rows.push(['1/8 MPH', slip.eighthMph ? slip.eighthMph.toFixed(2) : '—']);
  }
  if (distanceFt >= 1000) {
    rows.push(['1000 FT', slip.thousandEt == null ? '—' : fmtTime(slip.thousandEt, 3)]);
  }
  if (distanceFt >= 1320) {
    rows.push(['1/4 ET', slip.quarterEt == null ? '—' : fmtTime(slip.quarterEt, 3)]);
    rows.push(['1/4 MPH', slip.quarterMph ? slip.quarterMph.toFixed(2) : '—']);
  } else {
    rows.push(['ET', slip.et == null ? '—' : fmtTime(slip.et, 3)]);
    rows.push(['TRAP MPH', slip.trapMph ? slip.trapMph.toFixed(2) : '—']);
  }
  return rows;
}
