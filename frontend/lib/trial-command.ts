// トライアル管理の「文章で指示」（運営）。
//
// 「○○販売店に30日のIDを発行」「△△ホテルを2週間延長」「○○販売店を停止」のような短い日本語を、
// 決まった言い回しの規則で操作に読み替える（AI の API は使わないので費用はかからない）。
// 読み替えた結果は画面に出して、運営が確認してから実行する。

import { TRIAL_KIND_LABELS, type TrialKind, type TrialSummary } from "@shared/types"

export const TRIAL_COMMAND_MAX_DAYS = 90
const DEFAULT_DAYS = 30

export type TrialCommand =
  | { type: "create"; name: string; kind: TrialKind; days: number }
  | { type: "extend"; trial: TrialSummary; days: number }
  | { type: "suspend" | "resume" | "reset" | "delete"; trial: TrialSummary }

export type TrialCommandResult = { ok: true; command: TrialCommand; summary: string } | { ok: false; message: string }

const KANJI_DIGITS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 「三」「十」「二十」「十五」「三十」程度の漢数字を読む */
function kanjiNumber(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text)
  const match = text.match(/^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/)
  if (!match || text === "") return null
  const [, tens, ten, ones] = match
  if (!ten) return tens && !ones ? KANJI_DIGITS[tens] : null
  return (tens ? KANJI_DIGITS[tens] : 1) * 10 + (ones ? KANJI_DIGITS[ones] : 0)
}

const DURATION = /(\d+|[一二三四五六七八九十]+)\s*(日間|日|週間|週|ヶ月|ケ月|か月|カ月|ヵ月|箇月|月)/

/** 文中の期間を日数にする（1か月は30日、1週間は7日）。無ければ null */
export function parseDays(text: string): number | null {
  const match = text.match(DURATION)
  if (!match) return null
  const count = kanjiNumber(match[1])
  if (count === null) return null
  const unit = match[2]
  if (unit.startsWith("日")) return count
  if (unit.startsWith("週")) return count * 7
  return count * 30
}

const INTENTS = {
  delete: /削除|消して|消す|消去/,
  reset: /パスワード.*(再発行|リセット|変更|作り直|新しく|忘れ)|(再発行|リセット).*パスワード/,
  resume: /再開|解除|有効に|復活|戻して/,
  suspend: /停止|止め|とめて|無効/,
  extend: /延長|延ば|伸ば|のばし/,
  create: /発行|作成|作って|作る|追加|新規|用意|ください|ほしい|欲しい/,
}

// 渡し先の名前を取り出すときに消す言葉
const NOISE = [
  new RegExp(DURATION.source, "g"),
  /(トライアル|デモ)?(用)?(の)?(ログイン\s*)?(ID|アカウント|ＩＤ)/gi,
  /を?(発行|作成|作って|作る|追加|新規|用意)(して|する)?(ください|下さい|お願い(します|いたします)?)?/g,
  /(トライアル|デモ|有効期限|期限|期間)/g,
  /(ください|下さい|お願い(します|いたします)?|ほしい|欲しい)/g,
  /[、。，．,.!！?？]/g,
]

/** 新規発行の渡し先名。「」で囲めばそのまま使う */
function extractName(text: string): string {
  const quoted = text.match(/[「『"“](.+?)[」』"”]/)
  if (quoted) return quoted[1].trim()
  let rest = text
  for (const pattern of NOISE) rest = rest.replace(pattern, " ")
  const beforeParticle = rest.match(/^\s*(.+?)(?:さん|様|さま)?\s*(?:に|へ|用|向け|むけ)/)
  const name = (beforeParticle ? beforeParticle[1] : rest).replace(/\s+/g, " ").trim()
  return name.replace(/(の|を|で|は|が|さん|様|さま)$/, "").trim()
}

function kindOf(text: string): TrialKind {
  if (/営業先/.test(text)) return "PROSPECT_HOTEL"
  return /販売店|代理店|ディーラー|販社|パートナー/.test(text) ? "DEALER" : "PROSPECT_HOTEL"
}

/** 文中に名前（またはログイン ID）が出てくるトライアル。いちばん長く一致したもの */
function findTarget(text: string, trials: TrialSummary[]): TrialSummary | null {
  const lower = text.toLowerCase()
  let best: { trial: TrialSummary; length: number } | null = null
  for (const trial of trials) {
    for (const key of [trial.name, trial.loginEmail ?? ""]) {
      if (key && lower.includes(key.toLowerCase()) && (!best || key.length > best.length)) best = { trial, length: key.length }
    }
  }
  return best?.trial ?? null
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })

export function parseTrialCommand(input: string, trials: TrialSummary[]): TrialCommandResult {
  const text = input.normalize("NFKC").trim()
  if (!text) return { ok: false, message: "指示を入力してください" }

  const days = parseDays(text)
  if (days !== null && (days < 1 || days > TRIAL_COMMAND_MAX_DAYS)) {
    return { ok: false, message: `期間は1〜${TRIAL_COMMAND_MAX_DAYS}日で指定してください` }
  }

  const target = findTarget(text, trials)
  if (target) {
    const label = `「${target.name}」`
    if (INTENTS.delete.test(text)) {
      return { ok: true, command: { type: "delete", trial: target }, summary: `${label}を削除します（元に戻せません）` }
    }
    if (INTENTS.reset.test(text)) {
      return {
        ok: true,
        command: { type: "reset", trial: target },
        summary: `${label}のパスワードを再発行します（今のパスワードは使えなくなります）`,
      }
    }
    if (INTENTS.resume.test(text)) {
      return { ok: true, command: { type: "resume", trial: target }, summary: `${label}を再開します` }
    }
    if (INTENTS.suspend.test(text)) {
      return { ok: true, command: { type: "suspend", trial: target }, summary: `${label}を停止します（ログインできなくなります）` }
    }
    if (INTENTS.extend.test(text)) {
      if (days === null) return { ok: false, message: "何日延長するかも書いてください（例: 30日延長、2週間延長、1か月延長）" }
      return {
        ok: true,
        command: { type: "extend", trial: target, days },
        summary: `${label}の期限を${days}日延長します（今の期限: ${formatDate(target.expiresAt)}）`,
      }
    }
  } else if (!INTENTS.create.test(text) && Object.values(INTENTS).some((pattern) => pattern.test(text))) {
    return { ok: false, message: "対象のトライアルが見つかりません。一覧にある渡し先の名前を入れてください" }
  }

  const name = extractName(text)
  if (!name) return { ok: false, message: "渡し先の名前が読み取れません。「○○販売店」のように「」で囲んでください" }
  if (name.length > 100) return { ok: false, message: "渡し先の名前は100文字以内にしてください" }
  const kind = kindOf(text)
  const createDays = days ?? DEFAULT_DAYS
  return {
    ok: true,
    command: { type: "create", name, kind, days: createDays },
    summary: `「${name}」（${TRIAL_KIND_LABELS[kind]}）にトライアルの ID を発行します（期限: ${createDays}日間）`,
  }
}
