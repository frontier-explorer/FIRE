/**
 * ===============================================================
 * パーセンタイル資産推移ファンチャート（canvas描画）
 * ===============================================================
 * 外部ライブラリに依存せず、素の canvas API で
 * p10〜p90 の資産推移を帯グラフ（ファンチャート）として描画する。
 * ===============================================================
 */
(function (global) {
  'use strict';

  /** 数値を「億」「万」単位の短い日本語表記に変換する（軸ラベル用） */
  function formatShortYen(value) {
    const abs = Math.abs(value);
    if (abs >= 100000000) return (value / 100000000).toFixed(1) + '億円';
    if (abs >= 10000) return Math.round(value / 10000) + '万円';
    return Math.round(value) + '円';
  }

  /**
   * ファンチャートを描画する。
   * @param {HTMLCanvasElement} canvas 描画先のcanvas要素
   * @param {Array} timeline FireEngine.calculatePercentileTimeline() の戻り値
   */
  function drawFanChart(canvas, timeline) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!timeline || timeline.length === 0) {
      ctx.fillStyle = '#9fb0c0';
      ctx.font = '13px sans-serif';
      ctx.fillText('データがありません', 10, 20);
      return;
    }

    const paddingLeft = 70;
    const paddingRight = 16;
    const paddingTop = 16;
    const paddingBottom = 34;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    const maxValue = Math.max.apply(null, timeline.map((p) => p.p90));
    const minValue = 0;
    const xForIndex = (i) => paddingLeft + (i / ((timeline.length - 1) || 1)) * plotWidth;
    const yForValue = (v) => paddingTop + plotHeight - ((v - minValue) / (maxValue - minValue || 1)) * plotHeight;

    // ---- 背景グリッド線と縦軸ラベル ----
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#9fb0c0';
    ctx.font = '11px sans-serif';
    const gridSteps = 4;
    for (let g = 0; g <= gridSteps; g++) {
      const v = (maxValue / gridSteps) * g;
      const y = yForValue(v);
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      ctx.stroke();
      ctx.fillText(formatShortYen(v), 4, y + 4);
    }

    // ---- p10〜p90 の帯（薄い塗り） ----
    ctx.beginPath();
    timeline.forEach((p, i) => { const x = xForIndex(i); const y = yForValue(p.p90); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    for (let i = timeline.length - 1; i >= 0; i--) { const x = xForIndex(i); const y = yForValue(timeline[i].p10); ctx.lineTo(x, y); }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,138,61,0.12)';
    ctx.fill();

    // ---- p25〜p75 の帯（やや濃い塗り） ----
    ctx.beginPath();
    timeline.forEach((p, i) => { const x = xForIndex(i); const y = yForValue(p.p75); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    for (let i = timeline.length - 1; i >= 0; i--) { const x = xForIndex(i); const y = yForValue(timeline[i].p25); ctx.lineTo(x, y); }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,138,61,0.28)';
    ctx.fill();

    // ---- p50（中央値）の線 ----
    ctx.beginPath();
    timeline.forEach((p, i) => { const x = xForIndex(i); const y = yForValue(p.p50); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.strokeStyle = '#ff8a3d';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ---- 横軸ラベル（年数） ----
    ctx.fillStyle = '#9fb0c0';
    const labelCount = Math.min(6, timeline.length);
    for (let k = 0; k < labelCount; k++) {
      const idx = Math.round((k / (labelCount - 1 || 1)) * (timeline.length - 1));
      const point = timeline[idx];
      const years = (point.monthIndex / 12).toFixed(1);
      ctx.fillText(years + '年目', xForIndex(idx) - 14, height - paddingBottom + 16);
    }

    // ---- 凡例 ----
    ctx.fillStyle = '#9fb0c0';
    ctx.font = '11px sans-serif';
    ctx.fillText('帯: 10〜90パーセンタイル（濃い帯: 25〜75）／線: 中央値', paddingLeft, 12);
  }

  /** 系列インデックスから見分けやすい色を生成する（色相を均等に分散させる） */
  function seriesColor(index, total, alpha) {
    const hue = Math.round((360 * index) / Math.max(total, 1));
    return 'hsla(' + hue + ', 65%, 60%, ' + (alpha === undefined ? 1 : alpha) + ')';
  }

  /**
   * 銘柄ごとの資産推移を積み上げ面グラフ（stacked area chart）で描画する。
   * 1試行分の毎月データ（内訳あり）から、各銘柄の評価額を積み上げて表示する。
   * 加えて、percentSeries を指定すると、右側に第2縦軸（%軸）を設け、
   * 「年間生活費が全体資産の何%に相当するか」を折れ線グラフとして重ねて描画する。
   * @param {HTMLCanvasElement} canvas 描画先のcanvas要素
   * @param {Array} months 横軸ラベル用の月インデックス配列（0始まり、historyの各要素に対応）
   * @param {Array} seriesList [{ name, values: number[] }, ...]（下から積み上げる順）
   * @param {Array} [percentSeries] [{ monthIndex, percent }, ...]（右軸に描く折れ線。省略可）
   */
  function drawStackedAssetChart(canvas, months, seriesList, percentSeries) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!months || months.length === 0 || !seriesList || seriesList.length === 0) {
      ctx.fillStyle = '#9fb0c0';
      ctx.font = '13px sans-serif';
      ctx.fillText('データがありません', 10, 20);
      return;
    }

    const hasPercentAxis = !!(percentSeries && percentSeries.length > 0);
    const paddingLeft = 70;
    const paddingRight = hasPercentAxis ? 54 : 16;
    const paddingTop = 16;
    const paddingBottom = 34;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    // 各月の累積値（下から順に積み上げた合計）をあらかじめ計算する
    const cumulative = []; // cumulative[monthIdx][seriesIdx] = その系列までの累積値
    for (let m = 0; m < months.length; m++) {
      let running = 0;
      const row = [];
      seriesList.forEach((s) => { running += s.values[m] || 0; row.push(running); });
      cumulative.push(row);
    }
    const maxValue = Math.max.apply(null, cumulative.map((row) => row[row.length - 1]));

    const xForIndex = (i) => paddingLeft + (i / ((months.length - 1) || 1)) * plotWidth;
    const yForValue = (v) => paddingTop + plotHeight - (v / (maxValue || 1)) * plotHeight;

    // ---- 背景グリッド線と縦軸ラベル（左軸=円） ----
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#9fb0c0';
    ctx.font = '11px sans-serif';
    const gridSteps = 4;
    for (let g = 0; g <= gridSteps; g++) {
      const v = (maxValue / gridSteps) * g;
      const y = yForValue(v);
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      ctx.stroke();
      ctx.fillText(formatShortYen(v), 4, y + 4);
    }

    // ---- 各銘柄の帯を下から順に積み上げて描画する ----
    seriesList.forEach((s, seriesIndex) => {
      ctx.beginPath();
      for (let m = 0; m < months.length; m++) {
        const x = xForIndex(m);
        const y = yForValue(cumulative[m][seriesIndex]);
        if (m === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let m = months.length - 1; m >= 0; m--) {
        const x = xForIndex(m);
        const bottomValue = seriesIndex === 0 ? 0 : cumulative[m][seriesIndex - 1];
        ctx.lineTo(x, yForValue(bottomValue));
      }
      ctx.closePath();
      ctx.fillStyle = seriesColor(seriesIndex, seriesList.length, 0.85);
      ctx.fill();
    });

    // ---- 右軸（%）: 年間生活費が全体資産の何%に相当するかの折れ線 ----
    if (hasPercentAxis) {
      const maxPercentRaw = Math.max.apply(null, percentSeries.map((p) => p.percent).concat([1]));
      const percentAxisMax = Math.max(Math.ceil(maxPercentRaw / 10) * 10, 10);
      const yForPercent = (p) => paddingTop + plotHeight - (p / percentAxisMax) * plotHeight;

      ctx.fillStyle = '#4fd1c5';
      ctx.font = '11px sans-serif';
      for (let g = 0; g <= gridSteps; g++) {
        const v = (percentAxisMax / gridSteps) * g;
        const y = yForPercent(v);
        ctx.fillText(v.toFixed(0) + '%', width - paddingRight + 6, y + 4);
      }

      ctx.beginPath();
      percentSeries.forEach((p, i) => {
        const x = xForIndex(p.monthIndex);
        const y = yForPercent(p.percent);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = '#4fd1c5';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 各年1月時点にマーカー（丸）を打って、どの点が実測値かを分かりやすくする
      percentSeries.forEach((p) => {
        const x = xForIndex(p.monthIndex);
        const y = yForPercent(p.percent);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#4fd1c5';
        ctx.fill();
      });
    }

    // ---- 横軸ラベル（年数） ----
    ctx.fillStyle = '#9fb0c0';
    ctx.font = '11px sans-serif';
    const labelCount = Math.min(6, months.length);
    for (let k = 0; k < labelCount; k++) {
      const idx = Math.round((k / (labelCount - 1 || 1)) * (months.length - 1));
      const years = (months[idx] / 12).toFixed(1);
      ctx.fillText(years + '年目', xForIndex(idx) - 14, height - paddingBottom + 16);
    }
  }

  global.FireChart = { drawFanChart, drawStackedAssetChart, seriesColor };
})(typeof window !== 'undefined' ? window : globalThis);
