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

  global.FireCsv = { exportFailedTrials, exportSingleTrial, buildCsvContent };
})(typeof window !== 'undefined' ? window : globalThis);
