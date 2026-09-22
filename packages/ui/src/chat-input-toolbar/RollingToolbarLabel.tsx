import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/components/lib/utils.js";
import {
  ROLLING_TOOLBAR_LABEL_ROOT_CLASS_NAME,
  rollingToolbarLabelInnerClassName,
} from "./rollingToolbarLabelClasses.js";

const LABEL_ROLL_TRANSITION = {
  duration: 0.2,
  ease: [0.4, 0, 0.2, 1],
} as const;

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setPrefersReducedMotion(query.matches);
    };
    update();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", update);
      return () => {
        query.removeEventListener("change", update);
      };
    }

    query.addListener(update);
    return () => {
      query.removeListener(update);
    };
  }, []);

  return prefersReducedMotion;
}

export function RollingToolbarLabel({
  label,
  className,
  prefix,
  prefixClassName,
  value,
  truncate,
}: {
  label: string;
  className?: string;
  prefix?: string;
  prefixClassName?: string;
  value?: string;
  truncate?: boolean;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const content =
    prefix !== undefined && value !== undefined ? (
      <>
        <span className={prefixClassName}>{prefix}</span>
        <span>{value}</span>
      </>
    ) : (
      label
    );
  const innerClassName = rollingToolbarLabelInnerClassName(truncate);

  return (
    <span className={cn(ROLLING_TOOLBAR_LABEL_ROOT_CLASS_NAME, className)}>
      {reducedMotion ? (
        <span className={innerClassName}>{content}</span>
      ) : (
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={label}
            className={innerClassName}
            initial={{ y: "0.75em", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "-0.75em", opacity: 0 }}
            transition={LABEL_ROLL_TRANSITION}
          >
            {content}
          </motion.span>
        </AnimatePresence>
      )}
    </span>
  );
}
