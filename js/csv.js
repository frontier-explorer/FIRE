/**
 * ===============================================================
 * CSV出力ユーティリティ - JavaScript版（Kotlin版 CsvExportUtil.kt に対応）
 * ===============================================================
 * 1行 = 1ヶ月分のデータ。
 * 列構成:
 *   試行番号, 破綻月Index, 年月, 総資産, 現金, 出費, 収入, 追加投資, ideco収入, 税金,
 *   isFailure, 国債バッファ関連4列,
 *   [銘柄名_評価額, 銘柄名_口数, 銘柄名_基準価額, 銘柄名_平均取得価額, 銘柄名_月次リターン率] × 銘柄数,
 *   [為替ペア_レート, 為替ペア_変動率] × 3ペア
 * ===============================================================
 */
(function (global) {
  'use strict';

  const FX_PAIRS = ['USD/JPY', 'EUR/JPY', 'EUR/USD'];

  /** CSVフィールドをエスケープする（カンマ・ダブルクォート・改行を含む場合は引用符で囲む） */
  function escapeCsvField(value) {
    const str = String(value);
    if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /** ヘッダ行を生成する */
  function buildHeaderRow(stocks) {
    const fixedColumns = [
      '試行番号', '破綻月Index', '年月', '総資産', '現金', '出費', '収入', '追加投資',
      'ideco収入', '税金', 'isFailure',
      '国債バッファ評価額', '国債バッファ口数', '国債バッファ当月利息', '国債バッファ購入額'
    ];
    const stockColumns = [];
    stocks.forEach((stock) => {
      const name = stock.meigara;
      stockColumns.push(
        name + '_評価額', name + '_口数', name + '_基準価額(1Taniあたり)',
        name + '_平均取得価額(1Taniあたり)', name + '_月次リターン率%'
      );
    });
    const fxColumns = [];
    FX_PAIRS.forEach((pair) => { fxColumns.push(pair + '_レート', pair + '_変動率%'); });

    return fixedColumns.concat(stockColumns, fxColumns).map(escapeCsvField).join(',');
  }

  /** データ行（1行=1ヶ月）を生成する */
  function buildDataRow(trialId, failureMonth, record, stocks, prevFxRates) {
    const fixedValues = [
      trialId, failureMonth, record.yearMonth,
      Math.trunc(record.totalAsset), Math.trunc(record.cash), Math.trunc(record.expense),
      Math.trunc(record.income), Math.trunc(record.tuika), Math.trunc(record.idecoIncomeThisMonth),
      Math.trunc(record.tax), record.isFailure ? 'TRUE' : 'FALSE',
      Math.trunc(record.jgbBufferValue), record.jgbBufferLotCount,
      Math.trunc(record.jgbCouponThisMonth), Math.trunc(record.jgbPurchaseThisMonth)
    ];

    const stockValues = [];
    stocks.forEach((stock, i) => {
      const detail = record.stockDetails[i];
      if (detail) {
        stockValues.push(
          Math.trunc(detail.value), detail.kuchisu, detail.currentValuePerUnit,
          detail.averagePrice, detail.rate.toFixed(4)
        );
      } else {
        stockValues.push('', '', '', '', '');
      }
    });

    const fxValues = [];
    FX_PAIRS.forEach((pair) => {
      const currentRate = record.fxRates[pair];
      const prevRate = prevFxRates[pair];
      const rateStr = currentRate !== undefined ? currentRate.toFixed(4) : '';
      let changeStr = '';
      if (currentRate !== undefined && prevRate !== undefined && prevRate > 0.0) {
        changeStr = ((currentRate / prevRate - 1.0) * 100.0).toFixed(4);
      }
      fxValues.push(rateStr, changeStr);
    });

    return fixedValues.concat(stockValues, fxValues).map(escapeCsvField).join(',');
  }

  /** 対象試行リストからCSV本文（ヘッダ+データ行）を構築する */
  function buildCsvContent(targetResults, stocks) {
    const lines = [buildHeaderRow(stocks)];
    targetResults.forEach((result) => {
      let prevFxRates = {};
      result.history.forEach((record) => {
        lines.push(buildDataRow(result.trialId, result.failureMonth, record, stocks, prevFxRates));
        prevFxRates = record.fxRates;
      });
    });
    return lines.join('\r\n');
  }

  /** CSV文字列をBOM付きUTF-8としてファイルダウンロードさせる（Excelでの文字化け防止） */
  function downloadCsv(fileName, csvContent) {
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function formatTimestamp(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) + '_' +
      pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds());
  }

  /** 失敗試行のみをCSVに書き出す（詳細データがある試行のみ対象） */
  function exportFailedTrials(results, stocks) {
    const failedWithDetail = results.filter((r) => !r.success && r.history.length > 0);
    if (failedWithDetail.length === 0) {
      return { success: false, message: '出力対象の失敗試行（詳細データあり）がありません。\n試行回数が多すぎると詳細データが保存されない場合があります。' };
    }
    const fileName = 'FIRE_失敗試行_' + formatTimestamp(new Date()) + '.csv';
    const csvContent = buildCsvContent(failedWithDetail, stocks);
    downloadCsv(fileName, csvContent);
    const rowCount = failedWithDetail.reduce((s, r) => s + r.history.length, 0);
    return { success: true, fileName, rowCount };
  }

  /** 指定した1試行の月次データを全てCSVに書き出す（通常は試行#1を使う） */
  function exportSingleTrial(result, stocks) {
    if (result.history.length === 0) {
      return { success: false, message: 'この試行（#' + result.trialId + '）には月次詳細データがありません。\n詳細データは試行#1、または失敗試行の一部にのみ保持されます。' };
    }
    const statusLabel = result.success ? '成功' : '失敗';
    const fileName = 'FIRE_試行' + result.trialId + '_' + statusLabel + '_' + formatTimestamp(new Date()) + '.csv';
    const csvContent = buildCsvContent([result], stocks);
    downloadCsv(fileName, csvContent);
    return { success: true, fileName, rowCount: result.history.length };
  }

  /**
   * 「分岐点分析用サマリーCSV」のヘッダ行を生成する（1試行=1行、銘柄・為替ペアは可変列）。
   * CRISIS滞在月数・悪性レジーム発生年数は詳細データ（history）を保持していない試行では
   * 計算できないため、該当セルは空欄になる（試行番号・最終結果等の他の列は通常通り出力される）。
   */
  function buildBreakpointHeaderRow(baseNames, fxPairs, yearN) {
    const fixedColumns = [
      '試行番号', '最終結果', '破綻月Index', '最終総資産額',
      yearN + '年目時点_月次生活費（インフレ適用後）',
      yearN + '年目時点_CRISIS滞在月数（詳細データがない試行は空欄）',
      yearN + '年目までの悪性レジーム(TIGHTENING/STAGFLATION)発生年数（詳細データがない試行は空欄）'
    ];
    const stockColumns = baseNames.map((name) => name + '_累積CAGR(' + yearN + '年目まで)%');
    const fxColumns = fxPairs.map((pair) => pair + '_累積CAGR(' + yearN + '年目まで)%');
    return fixedColumns.concat(stockColumns, fxColumns).map(escapeCsvField).join(',');
  }

  /** 「分岐点分析用サマリーCSV」の1試行分のデータ行を生成する */
  function buildBreakpointDataRow(result, yearN, baseNames, fxPairs) {
    const stockRates = global.FireBorderline.calculateStockAverageAnnualRates(result, yearN);
    const fxRates = global.FireBorderline.calculateFxAverageAnnualRates(result, yearN);
    const lifeCost = global.FireBorderline.getLifeCostAtYear(result, yearN);
    const crisisMonths = global.FireBorderline.countCrisisMonths(result, yearN);
    const badRegimeYears = global.FireBorderline.countBadRegimeYears(result, yearN);
    const finalRecord = result.lightHistory[result.lightHistory.length - 1];

    const fixedValues = [
      result.trialId,
      result.success ? '成功' : '失敗',
      result.success ? '' : result.failureMonth,
      Math.trunc(finalRecord ? finalRecord.totalAsset : 0),
      lifeCost !== null ? Math.trunc(lifeCost) : '',
      crisisMonths !== null ? crisisMonths : '',
      badRegimeYears !== null ? badRegimeYears : ''
    ];

    const stockValues = baseNames.map((name) => {
      const item = stockRates.find((r) => r.baseName === name);
      return item ? item.cagrPercent.toFixed(4) : '';
    });
    const fxValues = fxPairs.map((pair) => {
      const item = fxRates.find((r) => r.pair === pair);
      return item ? item.cagrPercent.toFixed(4) : '';
    });

    return fixedValues.concat(stockValues, fxValues).map(escapeCsvField).join(',');
  }

  /**
   * 「分岐点分析用サマリーCSV」を書き出す（全試行・成功失敗問わず、1試行=1行）。
   * 累積CAGR（銘柄別・為替ペア別）・月次生活費は全試行分の軽量記録から取得できるが、
   * CRISIS滞在月数・悪性レジーム発生年数は詳細データ保持試行のみ値が入り、それ以外は空欄になる。
   * @param {Array} results シミュレーション結果（全試行）
   * @param {number} yearN 分岐点分析の基準年数（1以上の整数）
   */
  function exportBreakpointAnalysis(results, yearN) {
    if (!results || results.length === 0) {
      return { success: false, message: '出力対象の試行がありません。' };
    }
    const baseNames = Object.keys(results[0].monthlyStockRates || {});
    const fxPairs = Object.keys(results[0].monthlyFxRates || {});
    const lines = [buildBreakpointHeaderRow(baseNames, fxPairs, yearN)];
    results.forEach((result) => {
      lines.push(buildBreakpointDataRow(result, yearN, baseNames, fxPairs));
    });
    const fileName = 'FIRE_分岐点分析_' + yearN + '年目_' + formatTimestamp(new Date()) + '.csv';
    downloadCsv(fileName, lines.join('\r\n'));
    return { success: true, fileName, rowCount: results.length };
  }

  global.FireCsv = { exportFailedTrials, exportSingleTrial, exportBreakpointAnalysis, buildCsvContent };
})(typeof window !== 'undefined' ? window : globalThis);
