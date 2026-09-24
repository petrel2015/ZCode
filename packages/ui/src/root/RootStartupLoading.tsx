import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <ZCodeStartupLogoBadge />
      {children}
    </div>
  );
}

/** 初始化与引导共用品牌图标，保持底色、描边、圆角和标志比例一致。 */
export function ZCodeStartupLogoBadge({ animated = true }: { animated?: boolean }) {
  return (
    <div className="relative flex size-24 items-center justify-center rounded-3xl bg-[linear-gradient(180deg,#000000_0%,#151718_100%)] text-[#ffffff] shadow-xl/20 before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-[rgba(255,255,255,0.1)] before:content-['']">
      <ZCodeStartupLogo className="h-auto w-14" animated={animated} />
    </div>
  );
}

function ZCodeStartupLogo({
  className,
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
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
      {animated ? (
        <animate
          attributeName="opacity"
          begin="3s"
          dur="1.8s"
          repeatCount="indefinite"
          values="1;0.4;1"
        />
      ) : null}
      {/* 战损 Z（叛忍刀痕简化版）：几何取自 build/logo/standalone-mark-small.svg，切缝与刀痕用 mask 挖空，
          与 ZCodeAboutLogo 共用同一份路径数据（spec 品牌渲染点登记表的 inline glyph 单一来源）。 */}
      <mask
        id="zcode-battle-z-cutouts-startup"
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
      <g transform="translate(-63,-82) scale(0.373)" mask="url(#zcode-battle-z-cutouts-startup)">
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
