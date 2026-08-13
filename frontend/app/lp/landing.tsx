"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  BarChart3,
  BellRing,
  BookOpenCheck,
  Bot,
  Brain,
  Building2,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Database,
  GraduationCap,
  LineChart,
  Lock,
  MessageSquareText,
  RefreshCcw,
  Server,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCog,
  Zap,
} from "lucide-react"

// ============================================================
// ユーティリティフック
// ============================================================

/** ビューポート進入で .lp-visible を付与する（スクロールリビール共通） */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("lp-visible")
            observer.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return ref
}

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  const ref = useReveal<HTMLDivElement>()
  return (
    <div ref={ref} className={`lp-reveal ${className}`} style={{ "--lp-delay": `${delay}ms` } as React.CSSProperties}>
      {children}
    </div>
  )
}

/** ビューポート進入時に数値をカウントアップ表示する */
function CountUp({
  to,
  prefix = "",
  suffix = "",
  duration = 1600,
}: {
  to: number
  prefix?: string
  suffix?: string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [value, setValue] = useState(0)
  const started = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || started.current) return
        started.current = true
        if (reduced) {
          setValue(to)
          return
        }
        const start = performance.now()
        const tick = (now: number) => {
          const p = Math.min((now - start) / duration, 1)
          const eased = 1 - Math.pow(1 - p, 3)
          setValue(Math.round(to * eased))
          if (p < 1) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      },
      { threshold: 0.4 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [to, duration])

  return (
    <span ref={ref}>
      {prefix}
      {value.toLocaleString("ja-JP")}
      {suffix}
    </span>
  )
}

/** 文字列を1文字ずつタイプ表示し、完了後に次の文へループする */
function Typewriter({ lines }: { lines: string[] }) {
  const [text, setText] = useState("")
  const [lineIndex, setLineIndex] = useState(0)

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reduced) {
      setText(lines[0])
      return
    }
    const line = lines[lineIndex % lines.length]
    let i = 0
    let deleteTimer: ReturnType<typeof setTimeout>
    const typeTimer = setInterval(() => {
      i += 1
      setText(line.slice(0, i))
      if (i >= line.length) {
        clearInterval(typeTimer)
        deleteTimer = setTimeout(() => {
          setText("")
          setLineIndex((v) => v + 1)
        }, 3200)
      }
    }, 45)
    return () => {
      clearInterval(typeTimer)
      clearTimeout(deleteTimer)
    }
  }, [lineIndex, lines])

  return <span className="lp-caret">{text}</span>
}

// ============================================================
// パーツ
// ============================================================

function SectionHeading({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string
  title: React.ReactNode
  lead?: string
}) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      <p className="mb-3 text-sm font-semibold tracking-[0.2em] text-[var(--lp-accent-3)]">{eyebrow}</p>
      <h2 className="text-balance text-3xl font-bold leading-tight md:text-5xl">{title}</h2>
      {lead ? <p className="mt-5 text-pretty text-base leading-relaxed text-[var(--lp-muted)] md:text-lg">{lead}</p> : null}
    </Reveal>
  )
}

const RANK_CELLS = [
  { day: "金", rank: "S28", color: "bg-rose-500/80" },
  { day: "土", rank: "S31", color: "bg-rose-400/80" },
  { day: "日", rank: "S17", color: "bg-amber-400/80" },
  { day: "月", rank: "S09", color: "bg-emerald-400/70" },
  { day: "火", rank: "S08", color: "bg-emerald-400/70" },
  { day: "水", rank: "S11", color: "bg-teal-400/70" },
  { day: "木", rank: "S14", color: "bg-sky-400/70" },
]

/** ヒーローに浮かぶプロダクト風ダッシュボードモックアップ（CSS/SVG製） */
function DashboardMockup() {
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    el.style.setProperty("--ry", `${px * 10}deg`)
    el.style.setProperty("--rx", `${8 - py * 10}deg`)
  }, [])

  const handleLeave = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    el.style.setProperty("--ry", "0deg")
    el.style.setProperty("--rx", "8deg")
  }, [])

  return (
    <div className="lp-mockup-wrap" onMouseMove={handleMove} onMouseLeave={handleLeave}>
      <div
        ref={wrapRef}
        className="lp-mockup lp-visible mx-auto w-full max-w-4xl rounded-2xl border border-white/10 bg-[#0c0f1a]/90 shadow-[0_40px_120px_-30px_rgba(91,140,255,0.35)] backdrop-blur"
      >
        {/* ウィンドウバー */}
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-3">
          <span className="h-3 w-3 rounded-full bg-rose-400/80" />
          <span className="h-3 w-3 rounded-full bg-amber-400/80" />
          <span className="h-3 w-3 rounded-full bg-emerald-400/80" />
          <span className="ml-3 text-xs text-[var(--lp-muted)]">AIレベニューツール — メインダッシュボード</span>
          <span className="ml-auto hidden items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] text-emerald-300 sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            SC自動連携中
          </span>
        </div>

        <div className="grid gap-4 p-5 md:grid-cols-[1.5fr_1fr] md:p-6">
          {/* 左: KPI + チャート */}
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "稼働率", value: <CountUp to={92} suffix="%" />, diff: "+8.2pt" },
                { label: "ADR", value: <CountUp to={18400} prefix="¥" />, diff: "+12.4%" },
                { label: "RevPAR", value: <CountUp to={16928} prefix="¥" />, diff: "+15.1%" },
              ].map((kpi) => (
                <div key={kpi.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-[10px] text-[var(--lp-muted)] md:text-xs">{kpi.label}</p>
                  <p className="mt-1 text-sm font-bold tabular-nums md:text-lg">{kpi.value}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] text-emerald-400">
                    <TrendingUp className="h-3 w-3" />
                    {kpi.diff}
                  </p>
                </div>
              ))}
            </div>

            {/* 需要予測チャート */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium">需要予測（180日先まで）</p>
                <span className="rounded-full bg-[var(--lp-accent)]/15 px-2 py-0.5 text-[10px] text-[#7ea7ff]">
                  毎日 06:00 更新
                </span>
              </div>
              <svg viewBox="0 0 320 96" className="lp-spark h-24 w-full" aria-hidden="true">
                <defs>
                  <linearGradient id="lp-spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#5b8cff" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#5b8cff" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3].map((i) => (
                  <line key={i} x1="0" x2="320" y1={24 * i + 4} y2={24 * i + 4} stroke="rgba(255,255,255,0.06)" />
                ))}
                <path
                  d="M0,72 C24,66 40,58 56,60 C76,62 88,44 108,40 C128,36 140,52 160,48 C184,44 196,22 216,18 C236,14 248,30 268,26 C288,22 304,12 320,10 L320,96 L0,96 Z"
                  fill="url(#lp-spark-fill)"
                />
                <path
                  className="lp-spark-line"
                  d="M0,72 C24,66 40,58 56,60 C76,62 88,44 108,40 C128,36 140,52 160,48 C184,44 196,22 216,18 C236,14 248,30 268,26 C288,22 304,12 320,10"
                  fill="none"
                  stroke="#7ea7ff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
              {/* 稼働バー */}
              <div className="mt-2 flex h-10 items-end gap-1.5">
                {[35, 55, 42, 70, 62, 88, 96, 78, 58, 66, 84, 92, 74, 60].map((h, i) => (
                  <div
                    key={i}
                    className="lp-bar flex-1 rounded-sm bg-gradient-to-t from-[#5b8cff]/30 to-[#8b5cf6]/70"
                    style={{ height: `${h}%`, "--lp-delay": `${i * 60}ms` } as React.CSSProperties}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 右: 価格ランク + AIコメント */}
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium">今週の価格ランク</p>
                <span className="text-[10px] text-[var(--lp-muted)]">40段階 / 100円単位</span>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {RANK_CELLS.map((cell, i) => (
                  <div key={cell.day} className="text-center">
                    <p className="mb-1 text-[9px] text-[var(--lp-muted)]">{cell.day}</p>
                    <div
                      className={`lp-rank-cell rounded-md py-1.5 text-[9px] font-bold text-slate-900 md:text-[10px] ${cell.color}`}
                      style={{ "--lp-delay": `${i * 220}ms` } as React.CSSProperties}
                    >
                      {cell.rank}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-[var(--lp-accent)]/25 bg-[var(--lp-accent)]/10 px-3 py-2">
                <p className="text-[10px] text-[#a5c1ff]">土曜 S29→S31 への変更提案</p>
                <span className="flex gap-1.5">
                  <span className="rounded bg-emerald-400/90 px-2 py-0.5 text-[9px] font-bold text-slate-900">承認</span>
                  <span className="rounded border border-white/20 px-2 py-0.5 text-[9px] text-[var(--lp-muted)]">否認</span>
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <Bot className="h-3.5 w-3.5 text-[var(--lp-accent-3)]" />
                AI要因コメント
              </p>
              <p className="min-h-[72px] text-[11px] leading-relaxed text-[var(--lp-muted)]">
                <Typewriter
                  lines={[
                    "11/22(土)は近隣で大規模コンサートが開催予定。競合3施設は既に平均+18%の価格改定済みです。ランクS31への引き上げを推奨します。",
                    "台風接近によりレジャー需要の減速を検知。直前予約の歩留まりを考慮し、11/5(水)はランク据え置きが妥当と判断しました。",
                    "先週の否認操作を学習しました。日曜夜の値付けは御館の方針に合わせ、控えめなランク提案に調整しています。",
                  ]}
                />
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const DATA_SOURCES = [
  "PMSデータ",
  "競合ホテル価格",
  "OTA販促情報",
  "イベント情報",
  "天候データ",
  "航空路線",
  "JNTO統計",
  "経済動向",
  "SNSトレンド",
  "交通情報",
]

const PROBLEMS = [
  {
    icon: UserCog,
    title: "価格設定が「あの人」にしかできない",
    body: "料金判断が担当者の経験と勘に依存。異動や退職のたびに、積み上げたノウハウがゼロに戻ってしまう。",
    tag: "属人化",
  },
  {
    icon: RefreshCcw,
    title: "データ集計と手動更新に忙殺される",
    body: "競合・OTA・天候・イベント……見るべきデータは膨大。分析しても、サイトコントローラーへの反映はまた手作業。",
    tag: "工数過多",
  },
  {
    icon: LineChart,
    title: "需要のピークを取りこぼしている",
    body: "粗い料金ランクと後手に回る値付けでは、繁忙日の単価も閑散日の稼働も最大化できず、RevPARが伸び悩む。",
    tag: "機会損失",
  },
]

const AGENTS = [
  {
    icon: BarChart3,
    name: "需要予測エージェント",
    body: "時系列予測モデルで180日先までの日次需要・稼働率を毎日再学習・再予測。",
    color: "from-sky-400/20 to-sky-400/0 text-sky-300",
  },
  {
    icon: Zap,
    name: "価格決定エージェント",
    body: "需要予測と外部要因から、40段階・100円単位の最適な価格ランクを算出。",
    color: "from-violet-400/20 to-violet-400/0 text-violet-300",
  },
  {
    icon: MessageSquareText,
    name: "要因解説エージェント",
    body: "予実乖離の理由を分析し、事実・予測コメントと具体的な改善策を日本語で提示。",
    color: "from-cyan-400/20 to-cyan-400/0 text-cyan-300",
  },
  {
    icon: GraduationCap,
    name: "学習エージェント",
    body: "承認・否認の操作ログからホテル固有の価格感応度を学習し、提案を継続的に調整。",
    color: "from-emerald-400/20 to-emerald-400/0 text-emerald-300",
  },
]

const FEATURES = [
  { icon: BellRing, title: "毎日アラート", body: "稼働進捗と価格適正化のためのアラートを毎朝自動発信。始業前に最新の提案が届く。" },
  { icon: CalendarRange, title: "180日カレンダー", body: "180日先までの価格ランク・稼働率・売上をひと目で。需要レベルはA〜Eの5段階表示。" },
  { icon: CheckCircle2, title: "ワンクリック承認", body: "AIの変更提案は承認・否認ボタンひとつ。承認済みランクはSCへ自動書き込み。" },
  { icon: MessageSquareText, title: "AI要因コメント", body: "「なぜこの価格か」を事実コメント・予測コメントで説明。ブラックボックスにしない。" },
  { icon: Brain, title: "学習モニタリング", body: "オペレーターとの思考差異とAIの学習進捗を可視化。ホテル独自の戦略が育つ過程が見える。" },
  { icon: ShieldCheck, title: "権限管理（RBAC）", body: "誰が承認し、誰の判断を学習の正とするかをロールベースで制御。" },
]

const STEPS = [
  {
    step: "STEP 1",
    title: "初期設定",
    period: "導入時",
    body: "PMS連携とデータ項目をヒアリングのうえ設定。ホテル側のポート開放や追加開発は不要です。",
  },
  {
    step: "STEP 2",
    title: "並走学習期",
    period: "〜6ヶ月",
    body: "AIとオペレーターが並行して価格決定の「答え合わせ」を実施。承認・否認のたびに、AIが御館の戦略を学習します。",
  },
  {
    step: "STEP 3",
    title: "自律運用",
    period: "6ヶ月〜",
    body: "基本業務はAIが自律実行。オペレーターは提案の根拠をチェックし、最終承認のみを担当するマネジメント業務へ。",
  },
]

const SECURITY = [
  { icon: Lock, title: "個人情報を保持しない設計", body: "PMSからの取得段階で個人情報を除外。氏名・住所・電話番号などは一切保管しません。" },
  { icon: Server, title: "国内データセンター", body: "データはAWS東京リージョンに保管。通信はTLS暗号化、ホテル→クラウドの一方向のみ。" },
  { icon: Database, title: "テナント分離", body: "テナントIDによる論理分離で他社データと完全に隔離。第三者不可視がデフォルトです。" },
  { icon: ShieldCheck, title: "AIへの二次利用防止", body: "外部AIエンジン利用時も、ホテル独自データが一般公開モデルの学習に使われない設定を適用。" },
]

const FAQS = [
  {
    q: "どのPMSに対応していますか？",
    a: "NEHOPS等のPMS連携に対応しています。専用の自動取得アプリがRPA型のブラウザ操作でデータを取得するため、PMS側の改修や追加費用は原則不要です。対応可否は個別にご確認ください。",
  },
  {
    q: "導入してすぐに精度は出ますか？",
    a: "稼働開始から3ヶ月程度は学習期間となり、オペレーターによる確認の比重を高めた運用を推奨しています。ホテル固有データを十分に学習した定常状態（目安6ヶ月〜1年）で、需要予測誤差±10%以内を目標としています。",
  },
  {
    q: "価格は最終的に誰が決めるのですか？",
    a: "最終的な承認権限は常にオペレーターにあります。またAI提案には確信度スコアが付与され、異常値検知時など確信度が低い場合は自動書き込みを保留し、確認を求める半自動モードに切り替わります。",
  },
  {
    q: "サイトコントローラーへの反映はどう行われますか？",
    a: "SC側にAPIがある場合はAPI経由、無い場合もRPA型の自動操作で書き込みます。書き込み失敗時は該当日程のみ自動再試行し、他日程の処理は継続します。",
  },
  {
    q: "宿泊者の個人情報は扱われますか？",
    a: "扱いません。PMSからのデータ取得時に個人情報を除外する設定を事前に行い、システム側でも一切保持しない設計です。クレジットカード情報も同様に保有しません。",
  },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="lp-card group px-6 py-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium [&::-webkit-details-marker]:hidden">
        <span className="text-pretty">{q}</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-[var(--lp-muted)] transition-transform duration-300 group-open:rotate-180" />
      </summary>
      <p className="mt-4 text-sm leading-relaxed text-[var(--lp-muted)]">{a}</p>
    </details>
  )
}

// ============================================================
// ページ本体
// ============================================================

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement | null>(null)

  // ヒーローのマウス追従グロー + スクロールプログレス
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const onMove = (e: MouseEvent) => {
      root.style.setProperty("--mx", `${e.clientX}px`)
      root.style.setProperty("--my", `${e.clientY}px`)
    }
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      root.style.setProperty("--lp-scroll", `${max > 0 ? window.scrollY / max : 0}`)
    }
    window.addEventListener("mousemove", onMove, { passive: true })
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  return (
    <div ref={rootRef} className="lp-root min-h-screen font-sans">
      {/* ================= ナビ ================= */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#06070c]/70 backdrop-blur-xl">
        <div className="lp-progress absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#5b8cff] via-[#8b5cf6] to-[#22d3ee]" />
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <a href="#top" className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#5b8cff] to-[#8b5cf6]">
              <Sparkles className="h-4 w-4 text-white" />
            </span>
            AIレベニューツール
          </a>
          <div className="hidden items-center gap-7 text-sm text-[var(--lp-muted)] md:flex">
            <a href="#problem" className="transition-colors hover:text-white">課題</a>
            <a href="#how" className="transition-colors hover:text-white">仕組み</a>
            <a href="#features" className="transition-colors hover:text-white">機能</a>
            <a href="#steps" className="transition-colors hover:text-white">導入の流れ</a>
            <a href="#security" className="transition-colors hover:text-white">セキュリティ</a>
            <a href="#faq" className="transition-colors hover:text-white">FAQ</a>
          </div>
          <a
            href="#cta"
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7ea7ff]"
          >
            お問い合わせ
          </a>
        </nav>
      </header>

      {/* ================= ヒーロー ================= */}
      <section id="top" className="relative overflow-hidden pt-32 pb-20 md:pt-40 md:pb-28">
        <div className="lp-grid-bg absolute inset-0" aria-hidden="true" />
        <div className="lp-hero-glow pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
        <div className="lp-blob left-[-10%] top-[-10%] h-[480px] w-[480px] bg-[#5b8cff]/40" aria-hidden="true" />
        <div className="lp-blob right-[-15%] top-[20%] h-[520px] w-[520px] bg-[#8b5cf6]/30 [animation-delay:-6s]" aria-hidden="true" />
        <div className="lp-blob bottom-[-30%] left-[30%] h-[420px] w-[420px] bg-[#22d3ee]/20 [animation-delay:-12s]" aria-hidden="true" />

        <div className="relative z-10 mx-auto max-w-6xl px-5 text-center">
          <div className="lp-hero-in mx-auto mb-6 flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs text-[var(--lp-muted)] md:text-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--lp-accent-3)]" />
            宿泊施設のための自律型AIレベニューマネジメント
          </div>

          <h1 className="lp-hero-in text-balance text-4xl font-bold leading-[1.15] md:text-7xl" style={{ "--lp-delay": "120ms" } as React.CSSProperties}>
            価格決定を、
            <br className="md:hidden" />
            <span className="lp-shimmer">AIの仕事</span>に。
          </h1>

          <p className="lp-hero-in mx-auto mt-6 max-w-2xl text-pretty text-base leading-relaxed text-[var(--lp-muted)] md:text-lg" style={{ "--lp-delay": "240ms" } as React.CSSProperties}>
            PMSと外部データから180日先の需要を毎日予測し、最適な料金ランクを自動算出。
            承認ひとつでサイトコントローラーへ自動反映。
            属人化していたレベニューマネジメントを、AIが引き継ぎます。
          </p>

          <div className="lp-hero-in mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row" style={{ "--lp-delay": "360ms" } as React.CSSProperties}>
            <a
              href="#cta"
              className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-[#5b8cff] to-[#8b5cf6] px-7 py-3.5 font-semibold text-white shadow-[0_10px_40px_-10px_rgba(91,140,255,0.6)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7ea7ff]"
            >
              資料請求・お問い合わせ
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href="#how"
              className="rounded-full border border-white/20 px-7 py-3.5 font-semibold text-white/90 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7ea7ff]"
            >
              仕組みを見る
            </a>
          </div>

          <div className="lp-hero-in mt-16" style={{ "--lp-delay": "500ms" } as React.CSSProperties}>
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* ================= データソース マーキー ================= */}
      <section className="border-y border-white/5 bg-[var(--lp-bg-soft)] py-8">
        <p className="mb-5 text-center text-xs tracking-[0.25em] text-[var(--lp-muted)]">
          AIが毎日集約・分析するデータソース
        </p>
        <div className="lp-marquee overflow-hidden">
          <div className="lp-marquee-track gap-4 pr-4">
            {[...DATA_SOURCES, ...DATA_SOURCES].map((s, i) => (
              <span
                key={i}
                className="flex items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 text-sm text-[var(--lp-muted)]"
              >
                <Database className="h-3.5 w-3.5 text-[var(--lp-accent)]" />
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ================= 課題 ================= */}
      <section id="problem" className="mx-auto max-w-6xl scroll-mt-24 px-5 py-24 md:py-32">
        <SectionHeading
          eyebrow="PROBLEM"
          title={<>レベニュー業務は、<span className="lp-gradient-text">限界</span>を迎えている</>}
          lead="担当者の頑張りに支えられた価格運用は、もう続かない。多くの宿泊施設が同じ壁に直面しています。"
        />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {PROBLEMS.map((p, i) => (
            <Reveal key={p.title} delay={i * 120}>
              <div className="lp-card lp-card-hover h-full p-7">
                <div className="mb-5 flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#5b8cff]/25 to-transparent">
                    <p.icon className="h-6 w-6 text-[#7ea7ff]" />
                  </span>
                  <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-xs text-rose-300">
                    {p.tag}
                  </span>
                </div>
                <h3 className="text-lg font-bold leading-snug">{p.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[var(--lp-muted)]">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= 仕組み（フロー） ================= */}
      <section id="how" className="relative scroll-mt-24 border-y border-white/5 bg-[var(--lp-bg-soft)] py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHeading
            eyebrow="HOW IT WORKS"
            title={<>データ収集から反映まで、<span className="lp-gradient-text">全自動</span></>}
            lead="人が介在するのは「承認」だけ。データの取得・分析・価格算出・SC書き込みまで、システムが自律的に回し続けます。"
          />

          <Reveal className="mt-14">
            <div className="relative grid gap-4 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
              {/* 入力 */}
              <div className="space-y-3">
                {[
                  { icon: Building2, title: "PMS内部データ", body: "予約・残室・販売状況を毎日自動取得。個人情報は除外。" },
                  { icon: Database, title: "外部要因データ", body: "競合・イベント・天候・航空・SNSなど10種以上を収集。" },
                ].map((n) => (
                  <div key={n.title} className="lp-card p-5">
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <n.icon className="h-4 w-4 text-[var(--lp-accent-3)]" />
                      {n.title}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--lp-muted)]">{n.body}</p>
                  </div>
                ))}
              </div>

              {/* 矢印 */}
              <div className="hidden items-center md:flex" aria-hidden="true">
                <svg width="48" height="24" viewBox="0 0 48 24">
                  <path className="lp-flow-line" d="M0,12 H40" stroke="#5b8cff" strokeWidth="2" fill="none" />
                  <path d="M40,6 L48,12 L40,18 Z" fill="#5b8cff" />
                </svg>
              </div>

              {/* AIエンジン */}
              <div className="lp-flow-node rounded-2xl border border-[var(--lp-accent)]/40 bg-gradient-to-b from-[#5b8cff]/15 to-[#8b5cf6]/10 p-6">
                <p className="flex items-center gap-2 font-bold">
                  <Brain className="h-5 w-5 text-[#a78bfa]" />
                  マルチエージェントAIエンジン
                </p>
                <p className="mt-2 text-xs leading-relaxed text-[var(--lp-muted)]">
                  役割分担された4つのAIが協調し、需要予測 → 価格決定 → 根拠説明 → 学習のサイクルを毎日実行。
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {AGENTS.map((a) => (
                    <span key={a.name} className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-2 text-[10px] text-[var(--lp-muted)]">
                      <a.icon className="h-3 w-3 shrink-0 text-[#7ea7ff]" />
                      {a.name.replace("エージェント", "")}
                    </span>
                  ))}
                </div>
              </div>

              <div className="hidden items-center md:flex" aria-hidden="true">
                <svg width="48" height="24" viewBox="0 0 48 24">
                  <path className="lp-flow-line" d="M0,12 H40" stroke="#8b5cf6" strokeWidth="2" fill="none" />
                  <path d="M40,6 L48,12 L40,18 Z" fill="#8b5cf6" />
                </svg>
              </div>

              {/* 出力 */}
              <div className="space-y-3">
                <div className="lp-card p-5">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    価格ランク提案 → 承認
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--lp-muted)]">
                    180日各日の適正ランクを毎朝提示。オペレーターは承認・否認するだけ。
                  </p>
                </div>
                <div className="lp-card p-5">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <Zap className="h-4 w-4 text-amber-300" />
                    SCへ自動書き込み
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--lp-muted)]">
                    承認済みランクをサイトコントローラーへ自動反映。失敗時は該当日のみ再試行。
                  </p>
                </div>
              </div>
            </div>

            {/* 学習ループ */}
            <div className="mx-auto mt-8 flex w-fit items-center gap-3 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-6 py-3 text-sm text-emerald-300">
              <RefreshCcw className="h-4 w-4 animate-[spin_6s_linear_infinite]" />
              承認・否認の判断はAIへフィードバックされ、ホテル独自のノウハウとして自動蓄積
            </div>
          </Reveal>

          {/* 4エージェント詳細 */}
          <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {AGENTS.map((a, i) => (
              <Reveal key={a.name} delay={i * 100}>
                <div className="lp-card lp-card-hover h-full p-6">
                  <span className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${a.color}`}>
                    <a.icon className="h-5 w-5" />
                  </span>
                  <h3 className="text-sm font-bold">{a.name}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--lp-muted)]">{a.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= 数字 ================= */}
      <section className="mx-auto max-w-6xl px-5 py-24 md:py-32">
        <SectionHeading
          eyebrow="IMPACT"
          title={<>成果は<span className="lp-gradient-text">数字</span>で語る</>}
          lead="システムがホテル固有データを学習した定常運用状態での目標値です。"
        />
        <div className="mt-14 grid grid-cols-2 gap-5 lg:grid-cols-4">
          {[
            { value: <CountUp to={180} suffix="日" />, label: "先までの需要を毎日予測", note: "日次で再学習・再予測" },
            { value: <CountUp to={15} prefix="+" suffix="%" />, label: "売上向上（目標）", note: "詳細な価格設定とランク最適化" },
            { value: <CountUp to={50} prefix="−" suffix="%" />, label: "運用コスト削減（目標）", note: "人件費・労働時間の効率化" },
            { value: <CountUp to={10} prefix="±" suffix="%" />, label: "需要予測誤差（目標）", note: "定常運用時の精度基準" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 120}>
              <div className="lp-card lp-card-hover h-full p-7 text-center">
                <p className="lp-gradient-text text-4xl font-bold tabular-nums md:text-5xl">{s.value}</p>
                <p className="mt-3 text-sm font-medium">{s.label}</p>
                <p className="mt-1.5 text-xs text-[var(--lp-muted)]">{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}>
          <p className="mt-6 text-center text-xs text-[var(--lp-muted)]">
            ※ 数値はフル稼働から十分な学習データが蓄積された定常状態を前提とした目標値であり、成果を保証するものではありません。
          </p>
        </Reveal>
      </section>

      {/* ================= 機能 ================= */}
      <section id="features" className="scroll-mt-24 border-y border-white/5 bg-[var(--lp-bg-soft)] py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHeading
            eyebrow="FEATURES"
            title={<>毎日の運用を支える<span className="lp-gradient-text">主要機能</span></>}
            lead="「AIに任せる」と「人が納得して決める」を両立するための機能群。"
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 100}>
                <div className="lp-card lp-card-hover group h-full p-7">
                  <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors group-hover:border-[#7ea7ff]/40 group-hover:bg-[#5b8cff]/15">
                    <f.icon className="h-6 w-6 text-[#7ea7ff]" />
                  </span>
                  <h3 className="font-bold">{f.title}</h3>
                  <p className="mt-2.5 text-sm leading-relaxed text-[var(--lp-muted)]">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= 導入ステップ ================= */}
      <section id="steps" className="mx-auto max-w-5xl scroll-mt-24 px-5 py-24 md:py-32">
        <SectionHeading
          eyebrow="ONBOARDING"
          title={<>AIは<span className="lp-gradient-text">御館の戦略</span>を学びながら育つ</>}
          lead="導入初日から完全自動ではなく、並走期間でホテル独自の判断基準を学習。だから現場が納得して任せられます。"
        />
        <div className="mt-14 space-y-0">
          {STEPS.map((s, i) => (
            <Reveal key={s.step} delay={i * 120}>
              <div className="relative flex gap-6 pb-10 last:pb-0 md:gap-10">
                <div className="flex flex-col items-center">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[#7ea7ff]/40 bg-[#5b8cff]/15 text-sm font-bold text-[#7ea7ff]">
                    {i + 1}
                  </span>
                  {i < STEPS.length - 1 && <span className="lp-step-line mt-2 w-px flex-1" aria-hidden="true" />}
                </div>
                <div className="lp-card lp-card-hover mb-2 flex-1 p-7">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-lg font-bold">{s.title}</h3>
                    <span className="rounded-full border border-white/15 bg-white/5 px-3 py-0.5 text-xs text-[var(--lp-muted)]">
                      {s.period}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--lp-muted)]">{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= セキュリティ ================= */}
      <section id="security" className="scroll-mt-24 border-y border-white/5 bg-[var(--lp-bg-soft)] py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHeading
            eyebrow="SECURITY"
            title={<>宿泊業の商用データを<span className="lp-gradient-text">預かる設計</span></>}
            lead="24時間365日提供・稼働率99%以上のSLA。セキュリティは仕様として定義されています。"
          />
          <div className="mt-14 grid gap-5 sm:grid-cols-2">
            {SECURITY.map((s, i) => (
              <Reveal key={s.title} delay={(i % 2) * 120}>
                <div className="lp-card lp-card-hover flex h-full gap-5 p-7">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400/20 to-transparent">
                    <s.icon className="h-6 w-6 text-emerald-300" />
                  </span>
                  <div>
                    <h3 className="font-bold">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--lp-muted)]">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-5 py-24 md:py-32">
        <SectionHeading eyebrow="FAQ" title="よくあるご質問" />
        <div className="mt-12 space-y-4">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 80}>
              <FaqItem q={f.q} a={f.a} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section id="cta" className="relative scroll-mt-24 overflow-hidden px-5 py-24 md:py-32">
        <div className="lp-blob left-[10%] top-[0%] h-[400px] w-[400px] bg-[#5b8cff]/30" aria-hidden="true" />
        <div className="lp-blob right-[5%] bottom-[0%] h-[400px] w-[400px] bg-[#8b5cf6]/25 [animation-delay:-8s]" aria-hidden="true" />
        <Reveal className="relative z-10 mx-auto max-w-4xl">
          <div className="rounded-3xl border border-[#7ea7ff]/25 bg-gradient-to-b from-[#5b8cff]/15 via-[#0b0d16] to-[#0b0d16] p-10 text-center md:p-16">
            <BookOpenCheck className="mx-auto mb-6 h-10 w-10 text-[#7ea7ff]" />
            <h2 className="text-balance text-3xl font-bold leading-tight md:text-5xl">
              まずは自社の数字で、
              <br />
              <span className="lp-shimmer">AIの提案</span>を見てください。
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-[var(--lp-muted)]">
              デモ環境のご案内、仕様書のご提供、PMS対応可否のご確認など、お気軽にお問い合わせください。
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="mailto:info@example.com?subject=AIレベニューツール%20資料請求"
                className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-[#5b8cff] to-[#8b5cf6] px-8 py-4 font-semibold text-white shadow-[0_10px_40px_-10px_rgba(91,140,255,0.6)] transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7ea7ff]"
              >
                資料請求・お問い合わせ
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ================= フッター ================= */}
      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 text-sm text-[var(--lp-muted)] md:flex-row">
          <p className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-[#5b8cff] to-[#8b5cf6]">
              <Sparkles className="h-3 w-3 text-white" />
            </span>
            AIレベニューツール
          </p>
          <p>© {new Date().getFullYear()} 株式会社アコモス</p>
          <p className="text-xs">※ 本サービス名は仮称です。記載の仕様・数値は予告なく変更される場合があります。</p>
        </div>
      </footer>
    </div>
  )
}
