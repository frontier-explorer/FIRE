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

  /**
   * 銘柄ごとの「開始時点からの累積年率換算リターン（CAGR）」の推移を、
   * 縦軸の中央を0%とした折れ線グラフで描画する（口座別ではなく銘柄別）。
   * 上下どちらにも同じ幅で振れるよう、縦軸の最大・最小の絶対値をそろえる。
   * @param {HTMLCanvasElement} canvas 描画先のcanvas要素
   * @param {number[]} xValuesYears 横軸の値（経過年数）の配列。全系列で共通
   * @param {Array} seriesList [{ name, values: number[] }, ...]（values はxValuesYearsと同じ長さ、単位%）
   * @param {number} [axisScaleExcludeYears=1] 縦軸の範囲決定時に除外する開始直後の期間（年）。
   *   累積年率グラフでは開始直後の増幅を避けるため既定値1を使うが、単年騰落率グラフのように
   *   増幅が起きない系列では0を渡して全期間を軸の範囲決定に使う。
   */
  function drawZeroCenteredLineChart(canvas, xValuesYears, seriesList, axisScaleExcludeYears) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!xValuesYears || xValuesYears.length === 0 || !seriesList || seriesList.length === 0) {
      ctx.fillStyle = '#9fb0c0';
      ctx.font = '13px sans-serif';
      ctx.fillText('データがありません', 10, 20);
      return;
    }

    const paddingLeft = 60;
    const paddingRight = 16;
    const paddingTop = 16;
    const paddingBottom = 34;
    const plotWidth = width - paddingLeft - paddingRight;
    const plotHeight = height - paddingTop - paddingBottom;

    // ---- 縦軸の範囲を「0を中心に上下対称」となるように決定する ----
    // 開始直後（1年目まで）は月次の値動きを年率換算すると数値が大きく増幅されるため、
    // 軸のスケールを決める際にはこの期間を除外し、中長期の推移が見やすくなるようにする。
    // （除外期間の折れ線自体は描画するが、軸の範囲を超える部分はプロット領域の外にクリップする）
    const AXIS_SCALE_EXCLUDE_YEARS = (axisScaleExcludeYears === undefined) ? 1 : axisScaleExcludeYears;
    let maxAbsPercent = 0;
    seriesList.forEach((s) => {
      s.values.forEach((v, i) => {
        if (xValuesYears[i] <= AXIS_SCALE_EXCLUDE_YEARS) return;
        maxAbsPercent = Math.max(maxAbsPercent, Math.abs(v));
      });
    });
    // 全期間が除外対象より短い場合（試行期間が1年以下等）は、除外せず全データから求める
    if (maxAbsPercent === 0) {
      seriesList.forEach((s) => {
        s.values.forEach((v) => { maxAbsPercent = Math.max(maxAbsPercent, Math.abs(v)); });
      });
    }
    // 数値がすべて0に近い場合でもグラフが潰れないよう、最低幅を確保する
    const axisMax = Math.max(Math.ceil(maxAbsPercent / 5) * 5, 5);

    const minYear = xValuesYears[0];
    const maxYear = xValuesYears[xValuesYears.length - 1];
    const xForYear = (y) => paddingLeft + ((y - minYear) / ((maxYear - minYear) || 1)) * plotWidth;
    const yForPercent = (p) => paddingTop + plotHeight / 2 - (p / axisMax) * (plotHeight / 2);

    // ---- 背景グリッド線と縦軸ラベル（0%を中心に上下対称の目盛り） ----
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = '#9fb0c0';
    ctx.font = '11px sans-serif';
    const gridSteps = 8; // 0を含めて上下4段ずつ（補助線・数値を増やして見やすくする）
    for (let g = -gridSteps; g <= gridSteps; g++) {
      const v = (axisMax / gridSteps) * g;
      const y = yForPercent(v);
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(width - paddingRight, y);
      ctx.stroke();
      ctx.fillText(v.toFixed(0) + '%', 4, y + 4);
    }

    // ---- 0%基準線を強調表示する ----
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, yForPercent(0));
    ctx.lineTo(width - paddingRight, yForPercent(0));
    ctx.stroke();

    // ---- 各銘柄の年率推移を折れ線で描画する ----
    // 開始直後の急な増幅で軸の範囲を超える箇所は、プロット領域の外にはみ出さないようクリップする
    ctx.save();
    ctx.beginPath();
    ctx.rect(paddingLeft, paddingTop, plotWidth, plotHeight);
    ctx.clip();
    seriesList.forEach((s, seriesIndex) => {
      ctx.beginPath();
      xValuesYears.forEach((year, i) => {
        const x = xForYear(year);
        const y = yForPercent(s.values[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = seriesColor(seriesIndex, seriesList.length);
      ctx.lineWidth = 2;
      ctx.stroke();
    });
    ctx.restore();

    // ---- 横軸ラベル（年数） ----
    ctx.fillStyle = '#9fb0c0';
    ctx.font = '11px sans-serif';
    const labelCount = Math.min(11, xValuesYears.length);
    for (let k = 0; k < labelCount; k++) {
      const idx = Math.round((k / (labelCount - 1 || 1)) * (xValuesYears.length - 1));
      const x = xForYear(xValuesYears[idx]);
      // 目盛りに合わせて縦の補助線も追加する
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(x, paddingTop);
      ctx.lineTo(x, height - paddingBottom);
      ctx.stroke();
      ctx.fillStyle = '#9fb0c0';
      ctx.fillText(xValuesYears[idx].toFixed(1) + '年目', x - 14, height - paddingBottom + 16);
    }
  }

  global.FireChart = { drawFanChart, drawStackedAssetChart, drawZeroCenteredLineChart, seriesColor };
})(typeof window !== 'undefined' ? window : globalThis);
