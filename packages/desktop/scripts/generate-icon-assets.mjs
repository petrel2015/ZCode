// 从 build/logo/ 下的 SVG 源重生成全部品牌资产（macOS 工具链：Chrome headless 渲染 + sips 缩放 + iconutil）。
// 仅在更新 logo 源时手动运行；CI 与打包流程直接消费静态资产，不在构建期生成。
//
// 变体规则（见 docs/specs/standalone-identity-branding.md）：
// - standalone-mark.svg：完整战损版，用于 ≥128px 的所有场景；
// - standalone-mark-small.svg：简化版（无战损细节、短横道），用于 ≤64px，保证小尺寸可辨。
//
// 覆盖范围（对应 spec 的品牌渲染点登记表）：
// - build/icon.*、icon_installer.*、icon_windows.png、build/icons/：打包用 app/安装器图标；
// - build/dmg_background.png / dmg_background@2x.png：DMG 安装背景，源自 build/logo/dmg_background.svg；
// - 仓库根 public/icon_512@2x.png：更新对话框 Dock 图标（1024×1024）；
// - 仓库根 public/logo/icons/：静态存档镜像，与 build/ 产物保持一致；
// - packages/web/public/favicon.ico：Web favicon（多尺寸 ICO，≤64px 尺寸用简化变体；dist/ 下同名产物属构建输出，不手改）。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const logoFull = join(desktopRoot, "build", "logo", "standalone-mark.svg");
const logoSmall = join(desktopRoot, "build", "logo", "standalone-mark-small.svg");
const dmgBackground = join(desktopRoot, "build", "logo", "dmg_background.svg");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

function resolveChrome() {
  const fromEnv = process.env.ZCODE_ICON_RENDER_BROWSER?.trim();
  const candidates = fromEnv ? [fromEnv, ...CHROME_CANDIDATES] : CHROME_CANDIDATES;
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error(`找不到可用的 SVG 渲染浏览器，尝试过: ${candidates.join(", ")}`);
  return found;
}

function run(cmd, args, options = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...options });
}

function renderSvgToPng(chrome, svgPath, outPath, width = 1024, height = 1024) {
  run(chrome, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    `--screenshot=${outPath}`,
    `--window-size=${width},${height}`,
    `file://${svgPath}`,
  ]);
}

// sips 缩放：保持 alpha 通道。
function resizePng(source, target, size) {
  run("sips", ["-z", String(size), String(size), source, "--out", target]);
}

function variantForSize(size) {
  return size <= 64 ? logoSmall : logoFull;
}

function buildIconset(workDir, sizes, iconsetDir) {
  rmSync(iconsetDir, { recursive: true, force: true });
  mkdirSync(iconsetDir, { recursive: true });
  const entries = [
    ["icon_16x16.png", 16],
    ["icon_16x16@2x.png", 32],
    ["icon_32x32.png", 32],
    ["icon_32x32@2x.png", 64],
    ["icon_128x128.png", 128],
    ["icon_128x128@2x.png", 256],
    ["icon_256x256.png", 256],
    ["icon_256x256@2x.png", 512],
    ["icon_512x512.png", 512],
    ["icon_512x512@2x.png", 1024],
  ];
  for (const [name, size] of entries) {
    resizePng(sizes.get(size), join(iconsetDir, name), size);
  }
}

function buildIco(sizes, outPath) {
  // PNG-in-ICO（Vista+ 通用）：ICONDIR + ICONDIRENTRY + 各尺寸 PNG 原始字节。
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const images = icoSizes.map((size) => ({
    size,
    data: readFileSync(sizes.get(size)),
  }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let dataOffset = 6 + 16 * images.length;
  images.forEach((image, index) => {
    const base = index * 16;
    const dimension = image.size >= 256 ? 0 : image.size;
    entries.writeUInt8(dimension, base);
    entries.writeUInt8(dimension, base + 1);
    entries.writeUInt8(0, base + 2); // palette
    entries.writeUInt8(0, base + 3);
    entries.writeUInt16LE(1, base + 4); // color planes
    entries.writeUInt16LE(32, base + 6); // bits
    entries.writeUInt32LE(image.data.length, base + 8);
    entries.writeUInt32LE(dataOffset, base + 12);
    dataOffset += image.data.length;
  });
  writeFileSync(outPath, Buffer.concat([header, entries, ...images.map((image) => image.data)]));
}

function main() {
  const chrome = resolveChrome();
  const workDir = join(tmpdir(), "zcode-icon-assets");
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // 每个 (变体, 尺寸) 只渲一次 1024 基图，再统一缩放，避免重复渲染。
  const baseFull = join(workDir, "base-full.png");
  const baseSmall = join(workDir, "base-small.png");
  renderSvgToPng(chrome, logoFull, baseFull);
  renderSvgToPng(chrome, logoSmall, baseSmall);

  const allSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
  const sizeToFile = new Map();
  for (const size of allSizes) {
    const file = join(workDir, `icon-${size}.png`);
    resizePng(size <= 64 ? baseSmall : baseFull, file, size);
    sizeToFile.set(size, file);
  }

  const buildDir = join(desktopRoot, "build");

  // 1) macOS icns（app 与安装器各一份，内容一致、按用途命名）
  const appIconset = join(workDir, "app.iconset");
  buildIconset(workDir, sizeToFile, appIconset);
  run("iconutil", ["-c", "icns", appIconset, "-o", join(buildDir, "icon.icns")]);
  run("iconutil", ["-c", "icns", appIconset, "-o", join(buildDir, "icon_installer.icns")]);

  // 2) Windows ICO（app 与安装器）
  buildIco(sizeToFile, join(buildDir, "icon.ico"));
  buildIco(sizeToFile, join(buildDir, "icon_installer.ico"));

  // 3) 通用 PNG：app 主图标、Windows 运行时图标、安装器 PNG、Linux hicolor 全尺寸
  run("cp", [sizeToFile.get(1024), join(buildDir, "icon.png")]);
  run("cp", [sizeToFile.get(1024), join(buildDir, "icon_windows.png")]);
  run("cp", [sizeToFile.get(1024), join(buildDir, "icon_installer.png")]);
  for (const size of allSizes) {
    run("cp", [sizeToFile.get(size), join(buildDir, "icons", `${size}x${size}.png`)]);
  }

  // 4) DMG 安装背景：SVG 源按 1080x760 渲染出 @2x，再缩放出 540x380 @1x（白底不透明，无 alpha 要求）
  const dmg2x = join(workDir, "dmg-background-2x.png");
  renderSvgToPng(chrome, dmgBackground, dmg2x, 1080, 760);
  run("cp", [dmg2x, join(buildDir, "dmg_background@2x.png")]);
  run("sips", ["-z", "380", "540", dmg2x, "--out", join(buildDir, "dmg_background.png")]);

  // 5) 仓库根 public/ 静态存档：更新对话框 Dock 图标 + logo/icons 全套镜像（与 build/ 产物一致）
  const publicIconsDir = join(repoRoot, "public", "logo", "icons");
  mkdirSync(publicIconsDir, { recursive: true });
  run("cp", [sizeToFile.get(1024), join(repoRoot, "public", "icon_512@2x.png")]);
  run("cp", [join(buildDir, "icon.icns"), join(publicIconsDir, "icon.icns")]);
  run("cp", [join(buildDir, "icon.ico"), join(publicIconsDir, "icon.ico")]);
  for (const size of allSizes) {
    run("cp", [sizeToFile.get(size), join(publicIconsDir, `${size}x${size}.png`)]);
  }

  // 6) Web favicon：多尺寸 ICO，尺寸集与 build/icon.ico 一致（≤64px 来自简化变体）
  buildIco(sizeToFile, join(repoRoot, "packages", "web", "public", "favicon.ico"));

  rmSync(workDir, { recursive: true, force: true });
  console.log("[icon-assets] 全部图标已重新生成");
}

main();
