/**
 * RollingToolbarLabel 的布局契约：单行与截断由组件自身保证，调用方不通过
 * [&>span>span] 深层选择器干预内部 DOM。
 *
 * 此前静态（reduced-motion）分支缺少 flex/nowrap 容器，调用方的
 * [&>span>span]:block [&>span>span]:truncate 会分别命中 prefix/value 两个 span，
 * 把它们变成独立 block 盒而折成两行；改为两条渲染路径共享本模块的同一结构。
 */

export const ROLLING_TOOLBAR_LABEL_ROOT_CLASS_NAME =
  "relative inline-flex h-[1.3em] min-w-0 max-w-full items-center overflow-hidden leading-[1.25]";

/**
 * text-overflow 只作用于 block 容器：截断时内层退化为 block 单行盒；
 * 未截断时保持 inline-flex，与既有滚动动画布局一致。
 */
export function rollingToolbarLabelInnerClassName(truncate?: boolean): string {
  return truncate
    ? "block max-w-full truncate min-w-0 leading-[1.25]"
    : "inline-flex min-w-0 whitespace-nowrap leading-[1.25]";
}
