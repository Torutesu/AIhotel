"use client"

// 描画済みSVGのPNG書き出し（U-10）
//
// グラフの線色は `var(--chart-N)` や `currentColor` で指定されているが、
// SVGを単体の画像として書き出すと参照元のCSS変数が存在せず、線が黒く出たり
// 消えたりする。書き出し前に計算済みの実色へ置き換えてから直列化する。

const VAR_PATTERN = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g

/** 色を持つSVGの表示属性 */
const COLOR_ATTRIBUTES = [
  "fill",
  "stroke",
  "color",
  "stop-color",
  "flood-color",
  "lighting-color",
] as const

/** `var(--x)` を :root の計算済みの値へ置き換える（入れ子のフォールバックにも対応） */
function resolveCssVars(value: string, rootStyles: CSSStyleDeclaration): string {
  let result = value
  // フォールバックが入れ子になっている場合に備えて、変化が止まるまで繰り返す
  for (let i = 0; i < 5 && result.includes("var("); i++) {
    result = result.replace(VAR_PATTERN, (_match, name: string, fallback?: string) => {
      const resolved = rootStyles.getPropertyValue(name).trim()
      if (resolved) return resolved
      return (fallback ?? "").trim()
    })
  }
  return result
}

/**
 * SVGを複製し、CSS変数・currentColor を実色に解決した複製を返す。
 * 元のSVGは変更しない。
 */
export function cloneSvgWithResolvedColors(source: SVGSVGElement): SVGSVGElement {
  const clone = source.cloneNode(true) as SVGSVGElement
  const rootStyles = window.getComputedStyle(document.documentElement)

  const sourceElements: Element[] = [source, ...Array.from(source.querySelectorAll("*"))]
  const cloneElements: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))]

  cloneElements.forEach((element, index) => {
    const original = sourceElements[index]
    const currentColor = original
      ? window.getComputedStyle(original).color || "#000000"
      : "#000000"

    for (const attribute of COLOR_ATTRIBUTES) {
      const raw = element.getAttribute(attribute)
      if (!raw) continue
      let next = raw.includes("var(") ? resolveCssVars(raw, rootStyles) : raw
      if (next.trim() === "currentColor") next = currentColor
      if (!next.trim()) next = currentColor
      if (next !== raw) element.setAttribute(attribute, next)
    }

    const style = element.getAttribute("style")
    if (style && (style.includes("var(") || style.includes("currentColor"))) {
      element.setAttribute(
        "style",
        resolveCssVars(style, rootStyles).split("currentColor").join(currentColor),
      )
    }
  })

  return clone
}

/**
 * 描画済みSVGをPNGのBlobに変換する。
 * 透過だと貼り付け先で見えなくなるため白地を敷き、資料用に2倍解像度で書き出す。
 */
export function svgToPngBlob(source: SVGSVGElement, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const { width, height } = source.getBoundingClientRect()
    if (width === 0 || height === 0) {
      reject(new Error("グラフが描画されていません"))
      return
    }

    const clone = cloneSvgWithResolvedColors(source)
    clone.setAttribute("width", String(width))
    clone.setAttribute("height", String(height))
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg")
    clone.style.background = "#ffffff"

    const serialized = new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([serialized], { type: "image/svg+xml;charset=utf-8" }))

    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = width * scale
      canvas.height = height * scale
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error("canvas を初期化できません"))
        return
      }
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error("PNGへの変換に失敗しました"))
      }, "image/png")
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("SVGの読み込みに失敗しました"))
    }
    image.src = url
  })
}
