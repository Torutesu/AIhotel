import type { Metadata } from "next"
import { LandingPage } from "./landing"
import "./lp.css"

export const metadata: Metadata = {
  title: "AIレベニューツール | 価格決定を、AIの仕事に。",
  description:
    "宿泊施設向けの自律型AIレベニューマネジメント。PMSと外部データから180日先の需要を毎日予測し、最適な料金ランクを自動算出。承認ひとつでサイトコントローラーへ自動反映します。",
  openGraph: {
    type: "website",
    title: "AIレベニューツール | 価格決定を、AIの仕事に。",
    description:
      "属人化していたレベニューマネジメントを、自律型AIが引き継ぐ。180日先の需要予測・価格ランク自動算出・サイトコントローラー自動連携。",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
    title: "AIレベニューツール | 価格決定を、AIの仕事に。",
    description:
      "属人化していたレベニューマネジメントを、自律型AIが引き継ぐ。180日先の需要予測・価格ランク自動算出・サイトコントローラー自動連携。",
  },
}

export default function LpPage() {
  return <LandingPage />
}
