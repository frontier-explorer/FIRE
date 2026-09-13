/**
 * ===============================================================
 * 年境界（ボーダーライン）比較機能
 * ===============================================================
 * 「市場の成長率が、FIRE成否のどのあたりがボーダーラインになるか」を
 * 確認するための集計ロジック。
 *
 * 指定した年数Nについて、
 *   ・ギリギリ失敗ケース … 失敗した試行の中で、N年目時点の資産額が最大の試行
 *   ・ギリギリ成功ケース … 成功した試行の中で、シミュレーション終了時点の
 *                         最終資産額が最小の試行
 * をそれぞれ1件抽出し、開始時点からN年目までの「銘柄別・為替ペア別の
 * 平均年率（累積CAGR、%）」を比較できるようにする。
 *
 * 利用するデータ:
 *   ・trial.lightHistory      … 抽出対象の判定（全試行に存在する軽量記録）
 *   ・trial.monthlyStockRates … 銘柄（ベース名）ごとの月次リターン（%）配列（全試行分）
 *   ・trial.monthlyFxRates    … 為替ペアごとの為替レート推移配列（index0が開始時点、全試行分）
 * いずれも FireEngine.runOneTrial が全試行について記録しているため、
 * 「失敗試行の詳細保存上限」による絞り込みの影響を受けない。
 * ===============================================================
 */
(function (global) {
  'use strict';

  /**
   * 指定した年数Nの時点で、ギリギリ失敗ケース／ギリギリ成功ケースをそれぞれ1件抽出する。
   * @param {Array} results シミュレーション結果（全試行）
   * @param {number} yearN 検証したい年数（1以上の整数）
   * @returns {{ failureCase: Object|null, successCase: Object|null }}
   */
  function findBorderlineCases(results, yearN) {
    // lightHistoryは0始まりの月インデックス。N年目末（Nヶ月×12ヶ月分経過後）の
    // 記録は index = yearN*12 - 1 に対応する
    const monthIndexAtYearN = yearN * 12 - 1;

    let failureCase = null;
    let failureCaseAsset = -Infinity;
    let successCase = null;
    let successCaseAsset = Infinity;

    results.forEach((trial) => {
      if (trial.success) {
        // 「ギリギリ成功」＝成功試行の中で、シミュレーション終了時点の最終資産が最小のもの
        const finalRecord = trial.lightHistory[trial.lightHistory.length - 1];
        if (!finalRecord) return;
        if (finalRecord.totalAsset < successCaseAsset) {
          successCaseAsset = finalRecord.totalAsset;
          successCase = trial;
        }
      } else {
        // 「ギリギリ失敗」＝失敗試行の中で、N年目時点の資産額が最大のもの。
        // N年目より前に破綻した試行はこの時点の資産額が0として記録されているため、
        // 自然に比較対象から外れる（＝N年目まで持ちこたえた試行のみが選ばれる）。
        const record = trial.lightHistory[monthIndexAtYearN];
        if (!record) return; // シミュレーション期間がN年に満たない場合は対象外
        if (record.totalAsset > failureCaseAsset) {
          failureCaseAsset = record.totalAsset;
          failureCase = trial;
        }
      }
    });

    return { failureCase, successCase };
  }

  /**
   * 1試行分の「銘柄別・平均年率（開始時点からN年目までの累積CAGR、%）」を計算する。
   * monthlyStockRates（各銘柄の月次リターン%の配列）を複利で積み上げて年率換算する。
   * @returns {Array<{ baseName: string, cagrPercent: number }>}
   */
  function calculateStockAverageAnnualRates(trial, yearN) {
    const monthCount = yearN * 12;
    return Object.keys(trial.monthlyStockRates).map((baseName) => {
      const monthlyRates = trial.monthlyStockRates[baseName];
      let cumulativeGrowth = 1.0;
      const usedMonths = Math.min(monthCount, monthlyRates.length);
      for (let m = 0; m < usedMonths; m++) {
        cumulativeGrowth *= (1.0 + monthlyRates[m] / 100.0);
      }
      const cagrPercent = (Math.pow(cumulativeGrowth, 1.0 / yearN) - 1.0) * 100;
      return { baseName, cagrPercent };
    });
  }

  /**
   * 1試行分の「為替ペア別・平均年率（開始時点からN年目までの累積CAGR、%）」を計算する。
   * monthlyFxRates（為替レートの推移。index0が開始時点の水準）から、開始時点と
   * N年目時点の水準の比率を年率換算する。
   * @returns {Array<{ pair: string, cagrPercent: number }>}
   */
  function calculateFxAverageAnnualRates(trial, yearN) {
    const targetMonthIndex = yearN * 12; // index0=開始時点なので、N年目末はindex=N*12
    return Object.keys(trial.monthlyFxRates).map((pair) => {
      const series = trial.monthlyFxRates[pair];
      const startRate = series[0];
      const endRate = series[Math.min(targetMonthIndex, series.length - 1)];
      const cagrPercent = (startRate > 0)
        ? (Math.pow(endRate / startRate, 1.0 / yearN) - 1.0) * 100
        : 0.0;
      return { pair, cagrPercent };
    });
  }

  /**
   * 1試行分の、指定した年数N時点における月次生活費（円、インフレ／デフレ適用後）を取得する。
   * ギリギリ失敗ケースとギリギリ成功ケースとで、その時点の生活水準（インフレの影響を
   * 受けた生活費）にどれだけ差があるかを比較表示するために使う。
   * lightHistory（全試行に記録済みの軽量データ）のmonthlyLifeCostをそのまま使うため、
   * 詳細データ（history）を保持していない試行についても取得できる。
   * @returns {number|null} 指定年数までの記録がない試行の場合はnull
   */
  function getLifeCostAtYear(trial, yearN) {
    const monthIndexAtYearN = yearN * 12 - 1;
    const record = trial.lightHistory[monthIndexAtYearN];
    return record ? record.monthlyLifeCost : null;
  }

  global.FireBorderline = {
    findBorderlineCases, calculateStockAverageAnnualRates, calculateFxAverageAnnualRates, getLifeCostAtYear
  };
})(typeof window !== 'undefined' ? window : globalThis);
