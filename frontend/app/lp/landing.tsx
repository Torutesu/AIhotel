"use client"

import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
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
  Menu,
  MessageSquareText,
  RefreshCcw,
  Server,
  ShieldCheck,
  TrendingUp,
  UserCog,
  X,
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

/** モデルバッジ風グラデーションサムネイル（唯一の above-fold カラー） */
function GradientBadge({ label, size = "h-6 w-6 text-[10px]" }: { label: string; size?: string }) {
  return (
    <span
      className={`lp-featured flex shrink-0 items-center justify-center font-semibold text-white ${size}`}
      style={{ borderRadius: 6 }}
    >
      {label}
    </span>
  )
}

function SectionHeading({ title, lead }: { title: React.ReactNode; lead?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <h2 className="lp-display text-balance">{title}</h2>
      {lead ? <p className="mt-3 text-pretty text-base leading-relaxed text-[var(--color-ash-gray)]">{lead}</p> : null}
    </Reveal>
  )
}

/* 価格ランク: 彩度を使わず明度で需要の高低を表現する */
const RANK_CELLS = [
  { day: "金", rank: "S28", cls: "bg-[#282828] text-white" },
  { day: "土", rank: "S31", cls: "bg-[#000000] text-white" },
  { day: "日", rank: "S17", cls: "bg-[#5d5d5d] text-white" },
  { day: "月", rank: "S09", cls: "bg-[#ededed] text-[#181818]" },
  { day: "火", rank: "S08", cls: "bg-[#f3f3f3] text-[#181818]" },
  { day: "水", rank: "S11", cls: "bg-[#ededed] text-[#181818]" },
  { day: "木", rank: "S14", cls: "bg-[#8f8f8f] text-white" },
]

/** ヒーロー下のプロダクト風ダッシュボードモックアップ（CSS/SVG製・ライトUI） */
function DashboardMockup() {
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const handleMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = wrapRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    el.style.setProperty("--ry", `${px * 4}deg`)
    el.style.setProperty("--rx", `${3 - py * 4}deg`)
  }, [])

  const handleLeave = useCallback(() => {
    const el = wrapRef.current
    if (!el) return
    el.style.setProperty("--ry", "0deg")
    el.style.setProperty("--rx", "3deg")
  }, [])

  return (
    <div className="lp-mockup-wrap" onMouseMove={handleMove} onMouseLeave={handleLeave}>
      <div
        ref={wrapRef}
        className="lp-mockup lp-visible mx-auto w-full max-w-4xl rounded-lg border border-[var(--color-mist-gray)] bg-white"
        style={{ boxShadow: "var(--shadow-subtle)" }}
      >
        {/* ウィンドウバー */}
        <div className="flex items-center gap-2 border-b border-[var(--color-mist-gray)] px-5 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ededed]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ededed]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ededed]" />
          <span className="ml-3 text-xs text-[var(--color-smoke)]">AIレベニューツール — メインダッシュボード</span>
          <span className="ml-auto hidden items-center gap-1.5 rounded-full border border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--color-graphite)] sm:flex">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#181818]" />
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
                <div key={kpi.label} className="rounded-lg border border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] p-3">
                  <p className="text-[10px] text-[var(--color-smoke)] md:text-xs">{kpi.label}</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-[var(--color-carbon)] md:text-lg">{kpi.value}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-[var(--color-graphite)]">
                    <TrendingUp className="h-3 w-3" strokeWidth={1.5} />
                    {kpi.diff}
                  </p>
                </div>
              ))}
            </div>

            {/* 需要予測チャート（スパークラインのみ、モデルバッジと同系のグラデーション） */}
            <div className="rounded-lg border border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--color-carbon)]">需要予測（180日先まで）</p>
                <span className="rounded-full border border-[var(--color-mist-gray)] bg-white px-2 py-0.5 text-[10px] text-[var(--color-ash-gray)]">
                  毎日 06:00 更新
                </span>
              </div>
              <svg viewBox="0 0 320 96" className="lp-spark h-24 w-full" aria-hidden="true">
                <defs>
                  <linearGradient id="lp-spark-stroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#6366f1" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                  <linearGradient id="lp-spark-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[0, 1, 2, 3].map((i) => (
                  <line key={i} x1="0" x2="320" y1={24 * i + 4} y2={24 * i + 4} stroke="#ededed" />
                ))}
                <path
                  d="M0,72 C24,66 40,58 56,60 C76,62 88,44 108,40 C128,36 140,52 160,48 C184,44 196,22 216,18 C236,14 248,30 268,26 C288,22 304,12 320,10 L320,96 L0,96 Z"
                  fill="url(#lp-spark-fill)"
                />
                <path
                  className="lp-spark-line"
                  d="M0,72 C24,66 40,58 56,60 C76,62 88,44 108,40 C128,36 140,52 160,48 C184,44 196,22 216,18 C236,14 248,30 268,26 C288,22 304,12 320,10"
                  fill="none"
                  stroke="url(#lp-spark-stroke)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              {/* 稼働バー（明度スケール） */}
              <div className="mt-2 flex h-10 items-end gap-1.5">
                {[35, 55, 42, 70, 62, 88, 96, 78, 58, 66, 84, 92, 74, 60].map((h, i) => (
                  <div
                    key={i}
                    className={`lp-bar flex-1 rounded-sm ${h >= 84 ? "bg-[#282828]" : h >= 60 ? "bg-[#8f8f8f]" : "bg-[#dcdcdc]"}`}
                    style={{ height: `${h}%`, "--lp-delay": `${i * 60}ms` } as React.CSSProperties}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 右: 価格ランク + AIコメント */}
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--color-carbon)]">今週の価格ランク</p>
                <span className="text-[10px] text-[var(--color-smoke)]">40段階 / 100円単位</span>
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {RANK_CELLS.map((cell, i) => (
                  <div key={cell.day} className="text-center">
                    <p className="mb-1 text-[9px] text-[var(--color-smoke)]">{cell.day}</p>
                    <div
                      className={`lp-rank-cell rounded-md py-1.5 text-[9px] font-semibold md:text-[10px] ${cell.cls}`}
                      style={{ "--lp-delay": `${i * 260}ms` } as React.CSSProperties}
                    >
                      {cell.rank}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-[var(--color-mist-gray)] bg-white px-3 py-2">
                <p className="text-[10px] text-[var(--color-ash-gray)]">土曜 S29→S31 への変更提案</p>
                <span className="flex shrink-0 gap-1.5">
                  <span className="rounded-full bg-[#000000] px-2.5 py-0.5 text-[9px] font-medium text-white">承認</span>
                  <span className="rounded-full border border-[var(--color-mist-gray)] px-2.5 py-0.5 text-[9px] text-[var(--color-ash-gray)]">
                    否認
                  </span>
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--color-carbon)]">
                <Bot className="h-3.5 w-3.5 text-[var(--color-graphite)]" strokeWidth={1.5} />
                AI要因コメント
              </p>
              <p className="min-h-[72px] text-[11px] leading-relaxed text-[var(--color-ash-gray)]">
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
  },
  {
    icon: Zap,
    name: "価格決定エージェント",
    body: "需要予測と外部要因から、40段階・100円単位の最適な価格ランクを算出。",
  },
  {
    icon: MessageSquareText,
    name: "要因解説エージェント",
    body: "予実乖離の理由を分析し、事実・予測コメントと具体的な改善策を日本語で提示。",
  },
  {
    icon: GraduationCap,
    name: "学習エージェント",
    body: "承認・否認の操作ログからホテル固有の価格感応度を学習し、提案を継続的に調整。",
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
    title: "初期設定",
    period: "導入時",
    body: "PMS連携とデータ項目をヒアリングのうえ設定。ホテル側のポート開放や追加開発は不要です。",
  },
  {
    title: "並走学習期",
    period: "〜6ヶ月",
    body: "AIとオペレーターが並行して価格決定の「答え合わせ」を実施。承認・否認のたびに、AIが御館の戦略を学習します。",
  },
  {
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
    <details className="group rounded-lg border border-[var(--color-mist-gray)] bg-white px-6 py-5 transition-colors hover:bg-[var(--color-fog-white)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-base font-medium text-[var(--color-carbon)] [&::-webkit-details-marker]:hidden">
        <span className="text-pretty">{q}</span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-[var(--color-smoke)] transition-transform duration-300 group-open:rotate-180"
          strokeWidth={1.5}
        />
      </summary>
      <p className="mt-4 text-sm leading-relaxed text-[var(--color-ash-gray)]">{a}</p>
    </details>
  )
}

const NAV_LINKS = [
  { href: "#problem", label: "課題" },
  { href: "#how", label: "仕組み" },
  { href: "#features", label: "機能" },
  { href: "#steps", label: "導入の流れ" },
  { href: "#security", label: "セキュリティ" },
  { href: "#faq", label: "FAQ" },
]

// ============================================================
// ページ本体
// ============================================================

export function LandingPage() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  // スクロールプログレス
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      root.style.setProperty("--lp-scroll", `${max > 0 ? window.scrollY / max : 0}`)
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div ref={rootRef} className="lp-root min-h-screen">
      {/* ================= ナビ ================= */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[var(--color-mist-gray)] bg-white/90 backdrop-blur-md">
        <div className="lp-progress absolute inset-x-0 top-0 h-0.5 bg-[#181818]" />
        <nav className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-5">
          <a href="#top" className="flex items-center gap-2 text-[15px] font-semibold text-[var(--color-ink)]">
            <GradientBadge label="AI" />
            AIレベニューツール
          </a>
          <div className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className="lp-btn-ghost">
                {l.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <a
              href="#cta"
              className="lp-btn-dark hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#181818] focus-visible:ring-offset-2 sm:inline-block"
            >
              お問い合わせ
            </a>
            <button
              type="button"
              aria-label={menuOpen ? "メニューを閉じる" : "メニューを開く"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="lp-btn-ghost lg:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" strokeWidth={1.5} /> : <Menu className="h-5 w-5" strokeWidth={1.5} />}
            </button>
          </div>
        </nav>
        {/* モバイルメニュー */}
        <div className={`lp-mobile-menu border-[var(--color-mist-gray)] lg:hidden ${menuOpen ? "lp-open border-t" : ""}`}>
          <div>
            <div className="flex flex-col gap-1 bg-white px-5 py-3">
              {NAV_LINKS.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setMenuOpen(false)} className="lp-btn-ghost">
                  {l.label}
                </a>
              ))}
              <a href="#cta" onClick={() => setMenuOpen(false)} className="lp-btn-dark mt-2 text-center sm:hidden">
                お問い合わせ
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* ================= ヒーロー ================= */}
      <section id="top" className="px-5 pt-32 pb-16 md:pt-40 md:pb-20">
        <div className="mx-auto max-w-[1200px] text-center">
          <div className="lp-hero-in mx-auto mb-6 flex w-fit items-center gap-2.5 rounded-full border border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] py-1 pl-1 pr-4 text-sm text-[var(--color-ash-gray)]">
            <GradientBadge label="AI" size="h-6 w-6 text-[10px]" />
            宿泊施設のための自律型AIレベニューマネジメント
          </div>

          <h1 className="lp-hero-in lp-display mx-auto max-w-2xl text-balance" style={{ "--lp-delay": "100ms" } as React.CSSProperties}>
            価格決定を、AIの仕事に。
          </h1>

          <p
            className="lp-hero-in mx-auto mt-3 max-w-xl text-pretty text-base leading-relaxed text-[var(--color-ash-gray)]"
            style={{ "--lp-delay": "200ms" } as React.CSSProperties}
          >
            PMSと外部データから180日先の需要を毎日予測し、最適な料金ランクを自動算出。
            承認ひとつでサイトコントローラーへ自動反映します。
          </p>

          <div
            className="lp-hero-in mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row"
            style={{ "--lp-delay": "300ms" } as React.CSSProperties}
          >
            <a
              href="#cta"
              className="lp-btn-dark flex items-center gap-1.5 px-5 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#181818] focus-visible:ring-offset-2"
            >
              資料請求・お問い合わせ
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </a>
            <a href="#how" className="lp-arrow-link">
              仕組みを見る
              <ArrowUpRight className="h-4 w-4" strokeWidth={1.5} />
            </a>
          </div>

          <div className="lp-hero-in mt-16" style={{ "--lp-delay": "420ms" } as React.CSSProperties}>
            <DashboardMockup />
          </div>
        </div>
      </section>

      {/* ================= データソース マーキー ================= */}
      <section className="border-y border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] py-8">
        <p className="mb-5 text-center text-xs text-[var(--color-smoke)]">AIが毎日集約・分析するデータソース</p>
        <div className="lp-marquee overflow-hidden">
          <div className="lp-marquee-track gap-3 pr-3">
            {[...DATA_SOURCES, ...DATA_SOURCES].map((s, i) => (
              <span
                key={i}
                className="flex items-center gap-2 whitespace-nowrap rounded-full border border-[var(--color-mist-gray)] bg-white px-4 py-1.5 text-sm text-[var(--color-ash-gray)]"
              >
                <Database className="h-3.5 w-3.5 text-[var(--color-graphite)]" strokeWidth={1.5} />
                {s}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ================= 課題 ================= */}
      <section id="problem" className="mx-auto max-w-[1200px] scroll-mt-20 px-5 py-16 md:py-24">
        <SectionHeading
          title="レベニュー業務は、限界を迎えている"
          lead="担当者の頑張りに支えられた価格運用は、もう続かない。多くの宿泊施設が同じ壁に直面しています。"
        />
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {PROBLEMS.map((p, i) => (
            <Reveal key={p.title} delay={i * 100}>
              <div className="lp-card lp-card-hover h-full p-6">
                <div className="mb-4 flex items-center justify-between">
                  <p.icon className="h-5 w-5 text-[var(--color-graphite)]" strokeWidth={1.5} />
                  <span className="rounded-full border border-[var(--color-mist-gray)] bg-white px-3 py-0.5 text-xs text-[var(--color-ash-gray)]">
                    {p.tag}
                  </span>
                </div>
                <h3 className="text-base font-medium leading-snug text-[var(--color-carbon)]">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ash-gray)]">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= 仕組み（フロー） ================= */}
      <section id="how" className="border-y border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] py-16 scroll-mt-14 md:py-24">
        <div className="mx-auto max-w-[1200px] px-5">
          <SectionHeading
            title="データ収集から反映まで、全自動"
            lead="人が介在するのは「承認」だけ。データの取得・分析・価格算出・SC書き込みまで、システムが自律的に回し続けます。"
          />

          <Reveal className="mt-12">
            <div className="relative grid gap-4 md:grid-cols-[1fr_auto_1.2fr_auto_1fr]">
              {/* 入力 */}
              <div className="space-y-3">
                {[
                  { icon: Building2, title: "PMS内部データ", body: "予約・残室・販売状況を毎日自動取得。個人情報は除外。" },
                  { icon: Database, title: "外部要因データ", body: "競合・イベント・天候・航空・SNSなど10種以上を収集。" },
                ].map((n) => (
                  <div key={n.title} className="rounded-lg border border-[var(--color-mist-gray)] bg-white p-5">
                    <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-carbon)]">
                      <n.icon className="h-4 w-4 text-[var(--color-graphite)]" strokeWidth={1.5} />
                      {n.title}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-[var(--color-ash-gray)]">{n.body}</p>
                  </div>
                ))}
              </div>

              {/* 矢印 */}
              <div className="hidden items-center md:flex" aria-hidden="true">
                <svg width="40" height="24" viewBox="0 0 40 24">
                  <path className="lp-flow-line" d="M0,12 H32" stroke="#8f8f8f" strokeWidth="1.5" fill="none" />
                  <path d="M32,7 L40,12 L32,17 Z" fill="#8f8f8f" />
                </svg>
              </div>

              {/* AIエンジン（フィーチャードグラデーションタイル） */}
              <div className="lp-featured p-6">
                <p className="flex items-center gap-2 text-base font-medium">
                  <Brain className="h-5 w-5" strokeWidth={1.5} />
                  マルチエージェントAIエンジン
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/85">
                  役割分担された4つのAIが協調し、需要予測 → 価格決定 → 根拠説明 → 学習のサイクルを毎日実行。
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {AGENTS.map((a) => (
                    <span
                      key={a.name}
                      className="flex items-center gap-1.5 rounded-md bg-white/15 px-2.5 py-2 text-[11px] text-white"
                    >
                      <a.icon className="h-3 w-3 shrink-0" strokeWidth={1.5} />
                      {a.name.replace("エージェント", "")}
                    </span>
                  ))}
                </div>
              </div>

              <div className="hidden items-center md:flex" aria-hidden="true">
                <svg width="40" height="24" viewBox="0 0 40 24">
                  <path className="lp-flow-line" d="M0,12 H32" stroke="#8f8f8f" strokeWidth="1.5" fill="none" />
                  <path d="M32,7 L40,12 L32,17 Z" fill="#8f8f8f" />
                </svg>
              </div>

              {/* 出力 */}
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--color-mist-gray)] bg-white p-5">
                  <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-carbon)]">
                    <CheckCircle2 className="h-4 w-4 text-[var(--color-graphite)]" strokeWidth={1.5} />
                    価格ランク提案 → 承認
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-ash-gray)]">
                    180日各日の適正ランクを毎朝提示。オペレーターは承認・否認するだけ。
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--color-mist-gray)] bg-white p-5">
                  <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-carbon)]">
                    <Zap className="h-4 w-4 text-[var(--color-graphite)]" strokeWidth={1.5} />
                    SCへ自動書き込み
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-ash-gray)]">
                    承認済みランクをサイトコントローラーへ自動反映。失敗時は該当日のみ再試行。
                  </p>
                </div>
              </div>
            </div>

            {/* 学習ループ */}
            <div className="mx-auto mt-8 flex w-fit items-center gap-3 rounded-full border border-[var(--color-mist-gray)] bg-white px-5 py-2.5 text-center text-sm text-[var(--color-ash-gray)]">
              <RefreshCcw className="h-4 w-4 shrink-0 animate-[spin_8s_linear_infinite] text-[var(--color-graphite)]" strokeWidth={1.5} />
              承認・否認の判断はAIへフィードバックされ、ホテル独自のノウハウとして自動蓄積
            </div>
          </Reveal>

          {/* 4エージェント詳細 */}
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {AGENTS.map((a, i) => (
              <Reveal key={a.name} delay={i * 80}>
                <div className="lp-card lp-card-hover h-full bg-white p-6">
                  <a.icon className="mb-4 h-5 w-5 text-[var(--color-graphite)]" strokeWidth={1.5} />
                  <h3 className="text-sm font-medium text-[var(--color-carbon)]">{a.name}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-ash-gray)]">{a.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= 数字 ================= */}
      <section className="mx-auto max-w-[1200px] px-5 py-16 md:py-24">
        <SectionHeading title="成果は数字で語る" lead="システムがホテル固有データを学習した定常運用状態での目標値です。" />
        <div className="mt-12 grid grid-cols-2 gap-5 lg:grid-cols-4">
          {[
            { value: <CountUp to={180} suffix="日" />, label: "先までの需要を毎日予測", note: "日次で再学習・再予測" },
            { value: <CountUp to={15} prefix="+" suffix="%" />, label: "売上向上（目標）", note: "詳細な価格設定とランク最適化" },
            { value: <CountUp to={50} prefix="−" suffix="%" />, label: "運用コスト削減（目標）", note: "人件費・労働時間の効率化" },
            { value: <CountUp to={10} prefix="±" suffix="%" />, label: "需要予測誤差（目標）", note: "定常運用時の精度基準" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 100}>
              <div className="lp-card lp-card-hover h-full p-6 text-center">
                <p className="lp-display tabular-nums">{s.value}</p>
                <p className="mt-2 text-sm font-medium text-[var(--color-carbon)]">{s.label}</p>
                <p className="mt-1 text-xs text-[var(--color-smoke)]">{s.note}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={200}>
          <p className="mt-6 text-center text-xs text-[var(--color-smoke)]">
            ※ 数値はフル稼働から十分な学習データが蓄積された定常状態を前提とした目標値であり、成果を保証するものではありません。
          </p>
        </Reveal>
      </section>

      {/* ================= 機能 ================= */}
      <section id="features" className="scroll-mt-14 border-y border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] py-16 md:py-24">
        <div className="mx-auto max-w-[1200px] px-5">
          <SectionHeading
            title="毎日の運用を支える主要機能"
            lead="「AIに任せる」と「人が納得して決める」を両立するための機能群。"
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 80}>
                <div className="lp-card lp-card-hover h-full bg-white p-6">
                  <f.icon className="mb-4 h-5 w-5 text-[var(--color-graphite)]" strokeWidth={1.5} />
                  <h3 className="text-base font-medium text-[var(--color-carbon)]">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-ash-gray)]">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= 導入ステップ ================= */}
      <section id="steps" className="mx-auto max-w-4xl scroll-mt-20 px-5 py-16 md:py-24">
        <SectionHeading
          title="AIは御館の戦略を学びながら育つ"
          lead="導入初日から完全自動ではなく、並走期間でホテル独自の判断基準を学習。だから現場が納得して任せられます。"
        />
        <div className="mt-12">
          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={i * 100}>
              <div className="relative flex gap-5 pb-8 last:pb-0 md:gap-8">
                <div className="flex flex-col items-center">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] text-sm font-semibold text-[var(--color-carbon)]">
                    {i + 1}
                  </span>
                  {i < STEPS.length - 1 && <span className="mt-2 w-px flex-1 bg-[var(--color-mist-gray)]" aria-hidden="true" />}
                </div>
                <div className="lp-card lp-card-hover mb-2 flex-1 p-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="lp-heading">{s.title}</h3>
                    <span className="rounded-full border border-[var(--color-mist-gray)] bg-white px-3 py-0.5 text-xs text-[var(--color-ash-gray)]">
                      {s.period}
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm leading-relaxed text-[var(--color-ash-gray)]">{s.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= セキュリティ ================= */}
      <section id="security" className="scroll-mt-14 border-y border-[var(--color-mist-gray)] bg-[var(--color-fog-white)] py-16 md:py-24">
        <div className="mx-auto max-w-[1200px] px-5">
          <SectionHeading
            title="宿泊業の商用データを預かる設計"
            lead="24時間365日提供・稼働率99%以上のSLA。セキュリティは仕様として定義されています。"
          />
          <div className="mt-12 grid gap-5 sm:grid-cols-2">
            {SECURITY.map((s, i) => (
              <Reveal key={s.title} delay={(i % 2) * 100}>
                <div className="lp-card lp-card-hover flex h-full gap-4 bg-white p-6">
                  <s.icon className="h-5 w-5 shrink-0 text-[var(--color-graphite)]" strokeWidth={1.5} />
                  <div>
                    <h3 className="text-base font-medium text-[var(--color-carbon)]">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[var(--color-ash-gray)]">{s.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-5 py-16 md:py-24">
        <SectionHeading title="よくあるご質問" />
        <div className="mt-10 space-y-3">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={i * 60}>
              <FaqItem q={f.q} a={f.a} />
            </Reveal>
          ))}
        </div>
      </section>

      {/* ================= CTA（ダークサーフェス） ================= */}
      <section id="cta" className="scroll-mt-14 bg-[#181818] px-5 py-16 md:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="lp-display text-balance !text-white">
            まずは自社の数字で、AIの提案を見てください。
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-base leading-relaxed text-white/70">
            デモ環境のご案内、仕様書のご提供、PMS対応可否のご確認など、お気軽にお問い合わせください。
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="mailto:info@example.com?subject=AIレベニューツール%20資料請求"
              className="flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#0d0d0d] transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#181818]"
            >
              資料請求・お問い合わせ
              <ArrowRight className="h-4 w-4" strokeWidth={1.5} />
            </a>
          </div>
        </Reveal>
      </section>

      {/* ================= フッター ================= */}
      <footer className="border-t border-[var(--color-mist-gray)] py-8">
        <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-3 px-5 text-sm text-[var(--color-ash-gray)] md:flex-row">
          <p className="flex items-center gap-2 font-medium text-[var(--color-ink)]">
            <GradientBadge label="AI" />
            AIレベニューツール
          </p>
          <p>© {new Date().getFullYear()} 株式会社アコモス</p>
          <p className="text-xs text-[var(--color-smoke)]">
            ※ 本サービス名は仮称です。記載の仕様・数値は予告なく変更される場合があります。
          </p>
        </div>
      </footer>
    </div>
  )
}
