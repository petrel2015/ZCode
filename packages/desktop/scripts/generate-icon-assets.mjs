// 从 build/logo/ 下的 SVG 源重生成全部打包图标资产（macOS 工具链：Chrome headless 渲染 + sips 缩放 + iconutil）。
// 仅在更新 logo 源时手动运行；CI 与打包流程直接消费 build/ 下的静态资产，不在构建期生成。
//
// 变体规则（见 docs/specs/standalone-identity-branding.md）：
// - standalone-mark.svg：完整战损版，用于 ≥128px 的所有场景；
// - standalone-mark-small.svg：简化版（无战损细节、短横道），用于 ≤64px，保证小尺寸可辨。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const desktopRoot = resolve(import.meta.dirname, "..");
const logoFull = join(desktopRoot, "build", "logo", "standalone-mark.svg");
const logoSmall = join(desktopRoot, "build", "logo", "standalone-mark-small.svg");

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

function renderSvgToPng(chrome, svgPath, outPath) {
  run(chrome, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--default-background-color=00000000",
    `--screenshot=${outPath}`,
    "--window-size=1024,1024",
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

  rmSync(workDir, { recursive: true, force: true });
  console.log("[icon-assets] 全部图标已重新生成");
}

main();
