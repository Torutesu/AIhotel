"use client"

// フォームのインラインエラー表示（U-11）
// トーストだけに頼らず、どの入力が不正なのかを項目の直下に出す。

interface FormFieldErrorProps {
  message?: string
  /** 対応する入力の id（aria-describedby で参照させる） */
  id?: string
}

export function FormFieldError({ message, id }: FormFieldErrorProps) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}
