"use client"

// 描画時の例外を受け止める境界（#91）。
// 以前は1つのコンポーネントが描画中に例外を出すと画面全体が真っ白になった。
// タブごとに囲み、壊れたタブだけをエラー表示にして、ナビゲーションは使えるままにする。

import { Component, type ErrorInfo, type ReactNode } from "react"

import { ErrorCard } from "@/components/error-state"

interface ErrorBoundaryProps {
  children: ReactNode
  /** 画面に出す見出し（例: 「ダッシュボードを表示できませんでした」） */
  message?: string
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // エラートラッキングの導入（#49-6）までは、開発者ツールで追えるようにだけ残す
    console.error("画面の描画中にエラーが発生しました", error, info.componentStack)
  }

  private retry = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <div className="p-4">
          <ErrorCard
            message={this.props.message ?? "この画面を表示できませんでした。再試行しても直らない場合は再読み込みしてください。"}
            onRetry={this.retry}
          />
        </div>
      )
    }
    return this.props.children
  }
}
