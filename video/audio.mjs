// BGM をコードで合成する（外部の音源・ライセンス素材を使わない）。
// 落ち着いたパッド＋控えめなアルペジオ。差し替える場合は render.mjs の --no-audio で無音の MP4 を作り、
// 任意の音源を ffmpeg で重ねる（README 参照）。
const SR = 44100
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12)

// Am9 → Fmaj9 → Cmaj9 → G6（1小節ずつ）
const CHORDS = [
  { bass: 45, notes: [60, 64, 67, 71] },
  { bass: 41, notes: [57, 60, 64, 67] },
  { bass: 48, notes: [64, 67, 71, 74] },
  { bass: 43, notes: [62, 67, 69, 71] },
]

function hash(str) {
  let h = 2166136261
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return h >>> 0
}

/** @returns {Buffer} 16bit ステレオ WAV */
export function synthMusic(duration, { seed = '', bpm = 92, drive = String(seed).startsWith('launch') } = {}) {
  const n = Math.ceil(duration * SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const beat = 60 / bpm
  const bar = beat * 4
  const rot = hash(seed) % 4

  const add = (start, len, fn) => {
    const a = Math.max(0, Math.floor(start * SR))
    const b = Math.min(n, Math.floor((start + len) * SR))
    for (let i = a; i < b; i++) {
      const t = i / SR - start
      const [l, r] = fn(t)
      L[i] += l
      R[i] += r
    }
  }

  const bars = Math.ceil(duration / bar) + 1
  for (let k = 0; k < bars; k++) {
    const ch = CHORDS[(k + rot) % 4]
    const t0 = k * bar
    // パッド: ゆっくり立ち上がり、次の小節に少し重なる
    ch.notes.forEach((note, j) => {
      const f = midi(note)
      const pan = 0.5 + (j - 1.5) * 0.16
      add(t0, bar + 1.2, (t) => {
        const env = Math.min(1, t / 0.9) * Math.min(1, Math.max(0, (bar + 1.2 - t) / 1.2))
        const s = (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.004 * t + 1) + 0.18 * Math.sin(2 * Math.PI * f * 2 * t)) * env * 0.05
        return [s * (1 - pan), s * pan]
      })
    })
    // ベース
    const fb = midi(ch.bass)
    add(t0, bar, (t) => {
      const env = Math.min(1, t / 0.08) * Math.exp(-t * 0.55)
      const s = (Math.sin(2 * Math.PI * fb * t) + 0.25 * Math.sin(2 * Math.PI * fb * 2 * t)) * env * 0.16
      return [s, s]
    })
    // アルペジオ（8分音符。最初の2小節は休み）
    if (k >= 2) {
      const order = [0, 2, 1, 3, 2, 1, 3, 2]
      for (let s8 = 0; s8 < 8; s8++) {
        if ((s8 + k) % 8 === 5) continue // ところどころ休符
        const f = midi(ch.notes[order[(s8 + rot) % 8]] + 12)
        const pan = s8 % 2 === 0 ? 0.3 : 0.7
        for (const [delay, gain] of [[0, 1], [beat * 0.75, 0.38], [beat * 1.5, 0.16]]) {
          add(t0 + s8 * (beat / 2) + delay, 0.9, (t) => {
            const env = Math.min(1, t / 0.006) * Math.exp(-t * 7)
            const s = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) * env * 0.05 * gain
            const p = delay === 0 ? pan : 1 - pan
            return [s * (1 - p), s * p]
          })
        }
      }
    }
    // 控えめな拍（ローンチ動画のみ）
    if (drive && k >= 4) {
      for (const b of [0, 2]) {
        add(t0 + b * beat, 0.35, (t) => {
          const f = 48 + 70 * Math.exp(-t * 28)
          const s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 11) * 0.2
          return [s, s]
        })
      }
    }
  }

  // マスター: フェード＋ソフトクリップ
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const fade = Math.min(1, t / 1.5) * Math.min(1, Math.max(0, (duration - t) / 2.8))
    const l = Math.tanh(L[i] * 1.6) * 0.6 * fade
    const r = Math.tanh(R[i] * 1.6) * 0.6 * fade
    buf.writeInt16LE(Math.round(l * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(r * 32767), 46 + i * 4)
  }
  return buf
}
