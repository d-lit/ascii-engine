/**
 * Step 0 of phase 4.7 (DECISIONS 020): a 3-second WebM/VP9 with alpha, to
 * check whether this browser encodes transparency and whether the target
 * editor (CapCut) imports it. Temporary: replaced by the real transparent
 * export in step 2.
 */
export async function renderAlphaProbe(): Promise<Blob> {
  const mb = await import('./mux.ts');
  const width = 640;
  const height = 360;
  const fps = 30;
  const frames = fps * 3;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('alpha probe: no 2d context');

  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: new mb.WebMOutputFormat(), target });
  const source = new mb.CanvasSource(canvas, {
    codec: 'vp9',
    quality: new mb.Quality(4_000_000),
    alpha: 'keep',
  });
  output.addVideoTrack(source, { frameRate: fps });
  await output.start();

  for (let i = 0; i < frames; i++) {
    const t = i / fps;
    ctx.clearRect(0, 0, width, height);
    // Soft disc: tests partial alpha.
    const g = ctx.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, 150);
    g.addColorStop(0, 'rgba(255, 60, 120, 0.9)');
    g.addColorStop(1, 'rgba(255, 60, 120, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
    // Moving glyph rows: tests hard edges on transparency.
    ctx.font = 'bold 28px monospace';
    ctx.fillStyle = '#e8ffe0';
    for (let r = 0; r < 6; r++) {
      const x = ((t * 120 + r * 70) % (width + 300)) - 300;
      ctx.fillText('@#%*+=-:. ASCII', x, 60 + r * 50);
    }
    await source.add(t, 1 / fps);
  }
  await output.finalize();
  if (target.buffer === null) throw new Error('alpha probe: no data');
  return new Blob([target.buffer], { type: 'video/webm' });
}
