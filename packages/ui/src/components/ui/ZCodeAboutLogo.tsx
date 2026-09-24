import { cn } from "@/components/lib/utils.js";

// 战损 Z（叛忍刀痕简化版）：几何取自 packages/desktop/build/logo/standalone-mark-small.svg（≤64px 专用变体），
// 用 mask 把两道解构切缝与横贯刀痕从 Z 本体挖空，透明底 + currentColor 使其在任意壳底色/文字色下成立。
// 坐标系为 1024 源坐标，经 translate(-63,-82) scale(0.373) 铺满原版 256×218 viewBox，保持组件渲染尺寸不变。
export function ZCodeAboutLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="118"
      height="100"
      fill="none"
      viewBox="0 0 256 218"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      <mask
        id="zcode-battle-z-cutouts"
        maskUnits="userSpaceOnUse"
        x="0"
        y="0"
        width="1024"
        height="1024"
      >
        <rect x="0" y="0" width="1024" height="1024" fill="white" />
        <g transform="translate(512,512) skewX(-12) translate(-280,-280)">
          <rect
            x="70"
            y="121"
            width="660"
            height="18"
            fill="black"
            transform="rotate(-37.97 400 130)"
          />
          <rect
            x="-170"
            y="421"
            width="660"
            height="18"
            fill="black"
            transform="rotate(-37.97 160 430)"
          />
        </g>
        <g transform="translate(512,500) rotate(-6)">
          <path
            d="M-310,-29 L220,-29 L310,0 L-220,29 L-258,9 L-214,2 L-284,-2 L-304,7 L-294,0 Z"
            fill="black"
            stroke="black"
            strokeWidth="60"
          />
        </g>
      </mask>
      <g transform="translate(-63,-82) scale(0.373)" mask="url(#zcode-battle-z-cutouts)">
        <g transform="translate(512,512) skewX(-12) translate(-280,-280)">
          <path
            fill="currentColor"
            d="M0,0 L560,0 L560,120 L150,440 L560,440 L560,560 L0,560 L0,440 L410,120 L0,120 Z"
          />
        </g>
      </g>
    </svg>
  );
}
