import { describe, it, expect } from 'vitest'
import { ridgeTrainer, standardize, solveLinearSystem } from './ridge.js'
import { gbmTrainer, buildTree, predictTree } from './gbm.js'
import { meanAbsoluteError } from '../evaluation.js'
import type { TrainingSample } from '../features.js'
import type { Trainer } from './types.js'

// 需要予測モデル（4E-2 — docs/ai-agent-design.md §2）
// 外部ライブラリ無しで実装しているため、「本当に学習できているか」を
// 既知の関数を当てさせて確認する。

const d = (dayOffset: number) => new Date(Date.UTC(2026, 0, 1 + dayOffset))

/** 決定的な擬似乱数。テストを再現可能にする（Math.randomは使わない） */
function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

/**
 * 既知の関数からサンプルを作る。
 * y = 0.3 + 0.4*x0 + 0.2*x1 （x2 は無関係なノイズ列）
 */
function makeLinearSamples(count: number, noise = 0): TrainingSample[] {
  const random = makeRandom(42)
  const samples: TrainingSample[] = []
  for (let i = 0; i < count; i += 1) {
    const x0 = random()
    const x1 = random()
    const x2 = random()
    samples.push({
      features: [x0, x1, x2],
      target: 0.3 + 0.4 * x0 + 0.2 * x1 + (random() - 0.5) * noise,
      stayDate: d(i),
    })
  }
  return samples
}

/** 非線形（しきい値で振る舞いが変わる）サンプル。木モデルが得意な形 */
function makeStepSamples(count: number): TrainingSample[] {
  const random = makeRandom(7)
  const samples: TrainingSample[] = []
  for (let i = 0; i < count; i += 1) {
    const x0 = random()
    const x1 = random()
    samples.push({
      features: [x0, x1, random()],
      target: x0 > 0.5 ? 0.85 : 0.35,
      stayDate: d(i),
    })
  }
  return samples
}

function split(samples: TrainingSample[]): { train: TrainingSample[]; validation: TrainingSample[] } {
  const cut = Math.floor(samples.length * 0.8)
  return { train: samples.slice(0, cut), validation: samples.slice(cut) }
}

function evaluate(trainer: Trainer, samples: TrainingSample[]): number {
  const { train, validation } = split(samples)
  const model = trainer.train(train, validation)
  if (!model) return Number.POSITIVE_INFINITY
  return meanAbsoluteError(
    validation.map((s) => trainer.predict(model, s.features)),
    validation.map((s) => s.target)
  )
}

describe('solveLinearSystem', () => {
  it('連立方程式を解く', () => {
    // 2x + y = 5, x + 3y = 10 → x=1, y=3
    const solution = solveLinearSystem(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10]
    )!
    expect(solution[0]).toBeCloseTo(1, 6)
    expect(solution[1]).toBeCloseTo(3, 6)
  })

  it('特異行列では null を返す（NaNを撒き散らさない）', () => {
    expect(
      solveLinearSystem(
        [
          [1, 2],
          [2, 4],
        ],
        [3, 6]
      )
    ).toBeNull()
  })
})

describe('standardize', () => {
  it('平均0・分散1にそろえる', () => {
    const { mean, std } = standardize([[1], [2], [3]])
    expect(mean[0]).toBeCloseTo(2, 6)
    expect(std[0]).toBeCloseTo(Math.sqrt(2 / 3), 6)
  })

  it('定数列は標準偏差1として扱う（0除算で壊さない）', () => {
    expect(standardize([[5], [5], [5]]).std[0]).toBe(1)
  })
})

describe('ridgeTrainer', () => {
  it('線形な関係を学習する', () => {
    // 真の関係 y = 0.3 + 0.4x0 + 0.2x1 を当てられれば誤差はほぼ0
    expect(evaluate(ridgeTrainer, makeLinearSamples(400))).toBeLessThan(0.02)
  })

  it('無関係な特徴量には小さい重みしか置かない', () => {
    const { train, validation } = split(makeLinearSamples(400))
    const model = ridgeTrainer.train(train, validation)!
    // x2 はターゲットに寄与しないので、寄与度が最下位になるはず
    const importance = model.featureImportance
    expect(importance[2]).toBeLessThan(importance[0])
    expect(importance[2]).toBeLessThan(importance[1])
  })

  it('サンプルが少なすぎれば学習せず null を返す（無理に当てにいかない）', () => {
    const few = makeLinearSamples(10)
    expect(ridgeTrainer.train(few, few)).toBeNull()
  })

  it('検証データが空なら null を返す（誤差0で最良と誤判定しないため）', () => {
    expect(ridgeTrainer.train(makeLinearSamples(100), [])).toBeNull()
  })
})

describe('gbmTrainer', () => {
  it('木を作って葉の値を返す', () => {
    const rows = [[0.1], [0.2], [0.8], [0.9]]
    const targets = [0, 0, 1, 1]
    // MIN_SAMPLES_LEAF に満たないので葉1つ（平均）になる
    expect(predictTree(buildTree(rows, targets), [0.1])).toBeCloseTo(0.5, 6)
  })

  it('しきい値で振る舞いが変わる関係を学習する（線形では表せない形）', () => {
    expect(evaluate(gbmTrainer, makeStepSamples(500))).toBeLessThan(0.05)
  })

  it('早期終了で木の本数を絞る（最大本数まで作りきらない）', () => {
    const { train, validation } = split(makeStepSamples(500))
    const model = gbmTrainer.train(train, validation)!
    const params = model.params as { trees: unknown[] }
    expect(params.trees.length).toBeGreaterThan(0)
    expect(params.trees.length).toBeLessThan(300)
  })

  it('分割に使った特徴量に寄与度が集まる', () => {
    const { train, validation } = split(makeStepSamples(500))
    const model = gbmTrainer.train(train, validation)!
    // x0 だけがターゲットを決めている
    expect(model.featureImportance[0]).toBeGreaterThan(0.5)
  })
})

describe('モデル選択（どちらが勝つかはデータ次第）', () => {
  it('線形な関係ではRidgeが勝つ', () => {
    const samples = makeLinearSamples(400)
    expect(evaluate(ridgeTrainer, samples)).toBeLessThan(evaluate(gbmTrainer, samples))
  })

  it('しきい値型の関係ではGBMが勝つ', () => {
    const samples = makeStepSamples(500)
    expect(evaluate(gbmTrainer, samples)).toBeLessThan(evaluate(ridgeTrainer, samples))
  })

  it('どちらも学習結果に validationMae を持ち、比較できる', () => {
    const { train, validation } = split(makeLinearSamples(400))
    for (const trainer of [ridgeTrainer, gbmTrainer]) {
      const model = trainer.train(train, validation)!
      expect(model.validationMae).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(model.validationMae)).toBe(true)
      expect(model.algorithm).toBe(trainer.algorithm)
    }
  })
})

describe('ノイズ耐性', () => {
  it('ノイズが乗っても真の関係の水準までしか誤差が悪化しない', () => {
    // ノイズ幅0.2（±0.1）の一様分布なので、理論上の下限MAEは0.05前後
    const mae = evaluate(ridgeTrainer, makeLinearSamples(400, 0.2))
    expect(mae).toBeLessThan(0.08)
  })
})
