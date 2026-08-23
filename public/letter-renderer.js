// Shared letter artwork renderer — used by the admin panel (/adin) and the public wall (/wall).
// Draws a confession as a cream paper letter, then composes it onto a square night backdrop.
(function () {
  'use strict';

  const EXPORT_W = 640;
  const LINE_H = 34;
  const MAX_LINES = 150;

  function wrapLines(ctx, text, maxWidth) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          out.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      out.push(line);
    }
    return out;
  }

  async function ensureFonts() {
    try {
      await Promise.all([
        document.fonts.load('italic 600 30px Fraunces'),
        document.fonts.load('700 12px Fraunces'),
        document.fonts.load('400 21px "Playfair Display"'),
        document.fonts.load('13px Fraunces'),
        document.fonts.load('500 26px Caveat')
      ]);
      await document.fonts.ready;
    } catch {}
  }

  // Draw the paper letter. opts: { scale } (default 2)
  async function renderLetterCanvas(c, opts = {}) {
    const S = Math.min(Math.max(opts.scale || 2, 1), 2);
    await ensureFonts();

    const probe = document.createElement('canvas').getContext('2d');
    probe.font = '400 21px "Playfair Display", Georgia, serif';
    let lines = wrapLines(probe, c.message || ' ', 540).slice(0, MAX_LINES);
    if ((c.message || '').length && wrapLines(probe, c.message, 540).length > MAX_LINES) {
      lines[lines.length - 1] += ' …';
    }

    const nameCtx = document.createElement('canvas').getContext('2d');
    nameCtx.font = 'italic 600 30px Fraunces, Georgia, serif';
    const nameLines = wrapLines(nameCtx, c.to || 'Someone special', 500);

    const padX = 50;
    const sealCy = 46;
    const labelY = 108;
    let y = labelY + 26 + (nameLines.length - 1) * 36;
    const dividerY = y + 24;
    const baseline = dividerY + 52;
    const footY = baseline + (lines.length - 1) * LINE_H + 42;
    const H = Math.ceil(footY + 44);

    const canvas = document.createElement('canvas');
    canvas.width = EXPORT_W * S;
    canvas.height = H * S;
    const g = canvas.getContext('2d');
    g.scale(S, S);

    // paper
    const paper = g.createLinearGradient(0, 0, 0, H);
    paper.addColorStop(0, '#fdf6ea');
    paper.addColorStop(1, '#f3e5cd');
    g.fillStyle = paper;
    g.fillRect(0, 0, EXPORT_W, H);

    // dashed inner frame
    g.strokeStyle = 'rgba(55,42,38,0.24)';
    g.lineWidth = 1.5;
    g.setLineDash([6, 5]);
    g.strokeRect(12.75, 12.75, EXPORT_W - 25.5, H - 25.5);
    g.setLineDash([]);

    // wax seal
    const seal = g.createRadialGradient(EXPORT_W / 2 - 8, sealCy - 9, 4, EXPORT_W / 2, sealCy, 27);
    seal.addColorStop(0, '#d34a70');
    seal.addColorStop(0.58, '#9e1b40');
    seal.addColorStop(1, '#7c1330');
    g.fillStyle = seal;
    g.beginPath();
    g.ellipse(EXPORT_W / 2, sealCy, 27, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,233,221,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(EXPORT_W / 2, sealCy, 21, 20, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffe9dd';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '20px serif';
    g.fillText('\u2665', EXPORT_W / 2, sealCy + 1);

    // TO label
    g.font = '700 12px Fraunces, Georgia, serif';
    g.fillStyle = 'rgba(109,87,76,0.95)';
    g.fillText('T  O', EXPORT_W / 2, labelY);

    // recipient
    g.font = 'italic 600 30px Fraunces, Georgia, serif';
    g.fillStyle = '#9c2450';
    for (const nl of nameLines) {
      g.fillText(nl, EXPORT_W / 2, y);
      y += 36;
    }

    // divider
    const div = g.createLinearGradient(EXPORT_W / 2 - 65, 0, EXPORT_W / 2 + 65, 0);
    div.addColorStop(0, 'rgba(156,36,80,0)');
    div.addColorStop(0.5, 'rgba(156,36,80,0.55)');
    div.addColorStop(1, 'rgba(156,36,80,0)');
    g.fillStyle = div;
    g.fillRect(EXPORT_W / 2 - 65, dividerY, 130, 1.5);

    // message on ruled lines
    g.font = '400 21px "Playfair Display", Georgia, serif';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    for (let i = 0; i < lines.length; i++) {
      const by = baseline + i * LINE_H;
      g.strokeStyle = 'rgba(55,42,38,0.13)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(padX, by + 10);
      g.lineTo(EXPORT_W - padX, by + 10);
      g.stroke();
      g.fillStyle = '#372a26';
      g.fillText(lines[i], padX, by);
    }

    // footer
    g.strokeStyle = 'rgba(55,42,38,0.18)';
    g.beginPath();
    g.moveTo(padX, footY);
    g.lineTo(EXPORT_W - padX, footY);
    g.stroke();
    g.textBaseline = 'middle';
    g.font = '13px Fraunces, Georgia, serif';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(109,87,76,0.95)';
    g.fillText(c.date || '', padX, footY + 22);
    g.textAlign = 'right';
    g.fillStyle = '#d94f74';
    g.font = '16px serif';
    g.fillText('\u2665', EXPORT_W - padX, footY + 22);

    return canvas;
  }

  // Compose the letter onto a square night backdrop. opts: { maxSide } (default 4096), { brandText }
  function composeSquare(raw, opts = {}) {
    const maxSide = opts.maxSide || 4096;
    const pad = Math.round(Math.max(raw.width, raw.height) * 0.09);
    const side = Math.min(Math.max(raw.width, raw.height) + pad * 2, maxSide);
    const out = document.createElement('canvas');
    out.width = side;
    out.height = side;
    const ctx = out.getContext('2d');

    const bg = ctx.createLinearGradient(0, 0, side * 0.09, side);
    bg.addColorStop(0, '#241320');
    bg.addColorStop(0.65, '#150d13');
    bg.addColorStop(1, '#150d13');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, side, side);

    const glow = ctx.createRadialGradient(side * 0.75, 0, 10, side * 0.75, 0, side * 0.62);
    glow.addColorStop(0, 'rgba(217,79,116,0.16)');
    glow.addColorStop(1, 'rgba(217,79,116,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, side, side);

    const glow2 = ctx.createRadialGradient(side * 0.05, side, 10, side * 0.05, side, side * 0.55);
    glow2.addColorStop(0, 'rgba(201,151,63,0.08)');
    glow2.addColorStop(1, 'rgba(201,151,63,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, side, side);

    const hearts = [
      { x: 0.14, y: 0.16, s: 0.030, c: 'rgba(217,79,116,0.75)', r: -0.2 },
      { x: 0.86, y: 0.13, s: 0.024, c: 'rgba(201,151,63,0.7)', r: 0.25 },
      { x: 0.82, y: 0.86, s: 0.028, c: 'rgba(217,79,116,0.65)', r: 0.15 },
      { x: 0.15, y: 0.84, s: 0.022, c: 'rgba(201,151,63,0.6)', r: -0.3 }
    ];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    hearts.forEach(h => {
      ctx.save();
      ctx.translate(side * h.x, side * h.y);
      ctx.rotate(h.r);
      ctx.font = `${Math.round(side * h.s)}px serif`;
      ctx.fillStyle = h.c;
      ctx.fillText('\u2665', 0, 0);
      ctx.restore();
    });

    const maxW = side - pad * 2;
    const fit = Math.min(maxW / raw.width, maxW / raw.height);
    const drawW = raw.width * fit;
    const drawH = raw.height * fit;
    ctx.shadowColor = 'rgba(8,3,10,0.55)';
    ctx.shadowBlur = pad * 0.5;
    ctx.shadowOffsetY = pad * 0.18;
    ctx.drawImage(raw, (side - drawW) / 2, (side - drawH) / 2, drawW, drawH);
    ctx.shadowColor = 'transparent';

    ctx.font = `500 ${Math.round(side * 0.03)}px Caveat, cursive`;
    ctx.fillStyle = 'rgba(245,233,220,0.6)';
    ctx.fillText('C o n f e s s   W a l l', side / 2, pad * 0.5);

    ctx.font = `${Math.round(side * 0.026)}px serif`;
    ctx.fillStyle = 'rgba(201,151,63,0.85)';
    ctx.fillText('𝐈𝐓 𝐊𝐍𝐎𝐖𝐒', side / 2, side - pad * 0.42);

    return out;
  }

  window.LetterArt = { wrapLines, renderLetterCanvas, composeSquare };
})();