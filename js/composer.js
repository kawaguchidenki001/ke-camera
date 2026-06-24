// js/composer.js
// 写真の上に工事黒板を焼き込む

/**
 * 写真と黒板を合成して Blob を返す
 * @param {ImageBitmap|HTMLCanvasElement|HTMLVideoElement|HTMLImageElement} source - 元写真
 * @param {object} board - { koujiMei, koushu, shikousha, naiyou, date, seq }
 * @param {object} opts  - { pos:'bottom'|'top', heightRatio:number, showSeq:boolean, jpegQuality:number }
 * @returns {Promise<{blob:Blob, dataUrl:string, width:number, height:number}>}
 */
export async function composePhoto(source, board, opts = {}) {
  const pos        = opts.pos || "bottom";
  const heightR    = clamp(opts.heightRatio ?? 0.28, 0.16, 0.45);
  const showSeq    = opts.showSeq !== false;
  const quality    = clamp(opts.jpegQuality ?? 0.92, 0.5, 1.0);

  // ソースのサイズ取得
  const sw = source.width  || source.videoWidth  || source.naturalWidth;
  const sh = source.height || source.videoHeight || source.naturalHeight;
  if (!sw || !sh) throw new Error("元画像のサイズが取得できません");

  const cnv = document.createElement("canvas");
  cnv.width = sw;
  cnv.height = sh;
  const ctx = cnv.getContext("2d");

  // 1) 元写真を描画
  ctx.drawImage(source, 0, 0, sw, sh);

  // 2) 黒板を描画
  const boardH = Math.round(sh * heightR);
  const boardY = (pos === "top") ? 0 : (sh - boardH);
  drawBoard(ctx, 0, boardY, sw, boardH, board, { showSeq });

  // 3) Blob 化(JPEG)
  const blob = await new Promise((resolve, reject) => {
    cnv.toBlob((b) => b ? resolve(b) : reject(new Error("画像の生成に失敗")), "image/jpeg", quality);
  });

  // プレビュー用に dataURL も(小さい場合のみ)
  const dataUrl = await blobToDataUrl(blob);

  return { blob, dataUrl, width: sw, height: sh };
}

/**
 * 黒板そのものを描画
 */
function drawBoard(ctx, x, y, w, h, board, { showSeq }) {
  // ----- 黒板背景(深緑、紙のような微妙なムラ感は省略しシンプルに) -----
  ctx.save();
  ctx.fillStyle = "#1e4d2b";
  ctx.fillRect(x, y, w, h);

  // 外側に細い影
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = -2;

  // 上端ハイライト(写真と黒板の境目をはっきりさせる)
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(x, y, w, 2);
  ctx.shadowColor = "transparent";

  // ----- フレーム(白) -----
  const fInset = Math.max(6, Math.round(w * 0.008));
  const fThick = Math.max(2, Math.round(w * 0.0025));
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = fThick;
  ctx.strokeRect(x + fInset, y + fInset, w - fInset * 2, h - fInset * 2);

  // ----- 内側レイアウト計算 -----
  const padX = Math.round(w * 0.025);
  const padY = Math.round(h * 0.08);
  const innerX = x + fInset + padX;
  const innerY = y + fInset + padY;
  const innerW = w - (fInset + padX) * 2;
  const innerH = h - (fInset + padY) * 2;

  // 行数 4(工事名 / 工種+施工者 / 撮影内容 / 年月日+No.)
  const rowH = innerH / 4;
  const labelW = Math.round(innerW * 0.18);  // ラベル列の幅
  const rightColX = innerX + Math.round(innerW * 0.58); // 「工種 / 施工者」の右列開始
  const rightLabelW = Math.round(innerW * 0.13);

  // 行分割線
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, Math.round(w * 0.0009));
  for (let i = 1; i < 4; i++) {
    const ly = innerY + rowH * i;
    line(ctx, innerX, ly, innerX + innerW, ly);
  }
  // 列分割線(2 行目: 工種 / 施工者の間)
  line(ctx, rightColX, innerY + rowH, rightColX, innerY + rowH * 2);
  // 列分割線(4 行目: 年月日 / No.の間)
  if (showSeq) {
    line(ctx, rightColX, innerY + rowH * 3, rightColX, innerY + rowH * 4);
  }

  // ----- フォント設定(白色チョーク風) -----
  const labelFontPx = Math.max(11, Math.round(rowH * 0.30));
  const valueFontPx = Math.max(14, Math.round(rowH * 0.46));
  const labelFont = `600 ${labelFontPx}px ${jpFontStack()}`;
  const valueFont = `bold ${valueFontPx}px ${jpFontStack()}`;
  const valueColor = "#ffffff";
  const labelColor = "rgba(255,255,255,0.78)";

  // 行 1: 工事名
  drawCell(ctx, {
    x: innerX, y: innerY, w: innerW, h: rowH,
    labelW, label: "工事名", value: board.koujiMei || "",
    labelFont, valueFont, labelColor, valueColor,
    fitValue: true,
  });

  // 行 2: 工種 / 施工者
  drawCell(ctx, {
    x: innerX, y: innerY + rowH, w: rightColX - innerX, h: rowH,
    labelW, label: "工種", value: board.koushu || "",
    labelFont, valueFont, labelColor, valueColor,
    fitValue: true,
  });
  drawCell(ctx, {
    x: rightColX, y: innerY + rowH, w: innerW - (rightColX - innerX), h: rowH,
    labelW: rightLabelW, label: "施工者", value: board.shikousha || "",
    labelFont, valueFont, labelColor, valueColor,
    fitValue: true,
  });

  // 行 3: 撮影内容
  drawCell(ctx, {
    x: innerX, y: innerY + rowH * 2, w: innerW, h: rowH,
    labelW, label: "撮影内容", value: board.naiyou || "",
    labelFont, valueFont, labelColor, valueColor,
    fitValue: true,
  });

  // 行 4: 撮影年月日 / No.
  if (showSeq) {
    drawCell(ctx, {
      x: innerX, y: innerY + rowH * 3, w: rightColX - innerX, h: rowH,
      labelW, label: "撮影年月日", value: formatDateJp(board.date),
      labelFont, valueFont, labelColor, valueColor,
      fitValue: false,
    });
    drawCell(ctx, {
      x: rightColX, y: innerY + rowH * 3, w: innerW - (rightColX - innerX), h: rowH,
      labelW: rightLabelW, label: "No.", value: board.seq ? "#" + pad3(board.seq) : "",
      labelFont, valueFont, labelColor, valueColor,
      fitValue: false,
    });
  } else {
    drawCell(ctx, {
      x: innerX, y: innerY + rowH * 3, w: innerW, h: rowH,
      labelW, label: "撮影年月日", value: formatDateJp(board.date),
      labelFont, valueFont, labelColor, valueColor,
      fitValue: false,
    });
  }

  ctx.restore();
}

function drawCell(ctx, c) {
  // ラベル
  ctx.fillStyle = c.labelColor;
  ctx.font = c.labelFont;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const labelX = c.x + Math.round(c.w * 0.015);
  const labelY = c.y + c.h * 0.5;
  ctx.fillText(c.label, labelX, labelY);

  // 値
  ctx.fillStyle = c.valueColor;
  ctx.font = c.valueFont;
  const valueX = c.x + c.labelW + Math.round(c.w * 0.02);
  const valueY = c.y + c.h * 0.5;
  const maxW = c.x + c.w - valueX - Math.round(c.w * 0.015);

  let value = c.value || "";
  if (c.fitValue) {
    value = fitTextToWidth(ctx, value, maxW, c.valueFont);
  }
  ctx.fillText(value, valueX, valueY);
}

/** テキストを横幅に収める(超える場合は末尾省略 …) */
function fitTextToWidth(ctx, text, maxW, font) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length, fit = "";
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = text.slice(0, mid) + "…";
    if (ctx.measureText(t).width <= maxW) { fit = t; lo = mid + 1; }
    else hi = mid - 1;
  }
  return fit || "…";
}

function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function jpFontStack() {
  // Canvas は HTML の font-family と同じ書式
  return `"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo","Noto Sans JP",sans-serif`;
}

function formatDateJp(d) {
  if (!d) return "";
  // d は "YYYY-MM-DD" のはず
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function pad3(n) { return String(n).padStart(3, "0"); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error("読み込み失敗"));
    r.readAsDataURL(blob);
  });
}

/**
 * デバッグ・確認用: 黒板だけを単独 Canvas で描く(設定画面のプレビュー等で使える)
 */
export function renderBoardPreview(canvas, board, opts = {}) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  // 写真っぽい灰色背景
  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "#888");
  gradient.addColorStop(1, "#555");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  const heightR = clamp(opts.heightRatio ?? 0.28, 0.16, 0.45);
  const pos = opts.pos || "bottom";
  const boardH = Math.round(h * heightR);
  const boardY = pos === "top" ? 0 : (h - boardH);
  drawBoard(ctx, 0, boardY, w, boardH, board, { showSeq: opts.showSeq !== false });
}
