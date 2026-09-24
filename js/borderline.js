/**
 * ===============================================================
 * 年境界（ボーダーライン）比較機能
 * ===============================================================
 * 「市場の成長率が、FIRE成否のどのあたりがボーダーラインになるか」を
 * 確認するための集計ロジック。
 *
 * 指定した年数Nについて、
 *   ・ギリギリ失敗ケース … 失敗した試行の中で、N年目時点の資産額が最小の試行
 *                         （最も深刻に資産を使い果たしていた試行）
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
    let failureCaseAsset = Infinity;
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
        // 「ギリギリ失敗」＝失敗試行の中で、N年目時点の資産額が最小のもの（最も深刻な失敗ケース）。
        // N年目より前に破綻した試行はこの時点の資産額が0として記録されているため、
        // そのような「N年目までに資産を使い果たしていた」試行が優先的に選ばれる。
        const record = trial.lightHistory[monthIndexAtYearN];
        if (!record) return; // シミュレーション期間がN年に満たない場合は対象外
        if (record.totalAsset < failureCaseAsset) {
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

  /**
   * 1試行分の、指定した年数N時点（その月）における「緊急労働収入」（円）を取得する。
   * lightHistory（全試行に記録済みの軽量データ）のemergencyLaborIncomeをそのまま使うため、
   * 詳細データ（history）を保持していない試行についても取得できる。
   * @returns {number|null} 指定年数までの記録がない試行の場合はnull
   */
  function getEmergencyLaborIncomeAtYear(trial, yearN) {
    const monthIndexAtYearN = yearN * 12 - 1;
    const record = trial.lightHistory[monthIndexAtYearN];
    return record ? record.emergencyLaborIncome : null;
  }

  /**
   * 1試行分の、開始時点からN年目までの「緊急労働収入」の累計額（円）を計算する。
   * 「ギリギリ失敗／ギリギリ成功」を分けたのが市場の成長率だけでなく、労働による
   * 収入補填の有無・多寡である可能性を確認するために使う。
   * @returns {number|null} 指定年数までの記録がない試行の場合はnull
   */
  function sumEmergencyLaborIncomeUpToYear(trial, yearN) {
    const monthCount = yearN * 12;
    const usedMonths = Math.min(monthCount, trial.lightHistory.length);
    if (usedMonths <= 0) return null;
    let total = 0.0;
    for (let m = 0; m < usedMonths; m++) {
      total += trial.lightHistory[m].emergencyLaborIncome || 0.0;
    }
    return total;
  }

  /**
   * 1試行分の、開始時点からN年目までの「バッファCRISIS滞在割合（%）」を計算する。
   * cashBufferMode/effectiveMode は詳細データ（history）にのみ記録されている（軽量データの
   * lightHistoryには含まれない）ため、詳細を保持していない試行（先頭以外の成功ケースや、
   * 失敗詳細保存上限を超えた失敗ケース）では計算できず null を返す。呼び出し側で
   * 「データ制限上限で、詳細情報なしケースになります。」等のメッセージを表示すること。
   * @returns {number|null}
   */
  function calculateCrisisBufferRatio(trial, yearN) {
    if (!trial.history || trial.history.length === 0) return null;
    const monthCount = yearN * 12;
    const usedMonths = Math.min(monthCount, trial.history.length);
    if (usedMonths <= 0) return null;
    let crisisMonths = 0;
    for (let m = 0; m < usedMonths; m++) {
      if (trial.history[m].effectiveMode === 'CRISIS') crisisMonths++;
    }
    return (crisisMonths / usedMonths) * 100;
  }

  /**
   * 1試行分の、開始時点からN年目までの「バッファCRISIS滞在月数」を計算する（分岐点分析用CSV向け）。
   * calculateCrisisBufferRatioと計算対象は同じだが、割合(%)ではなく月数そのものを返す。
   * 詳細データ（history）を保持していない試行では null を返す。
   * @returns {number|null}
   */
  function countCrisisMonths(trial, yearN) {
    if (!trial.history || trial.history.length === 0) return null;
    const monthCount = yearN * 12;
    const usedMonths = Math.min(monthCount, trial.history.length);
    if (usedMonths <= 0) return null;
    let crisisMonths = 0;
    for (let m = 0; m < usedMonths; m++) {
      if (trial.history[m].effectiveMode === 'CRISIS') crisisMonths++;
    }
    return crisisMonths;
  }

  /**
   * 1試行分の、開始時点からN年目までに「悪性レジーム（TIGHTENING または STAGFLATION）」に
   * 該当した年数（12ヶ月区切り、1ヶ月でも該当すればその1年をカウント）を数える。
   * regimeも詳細データ（history）にのみ記録されているため、calculateCrisisBufferRatioと
   * 同様、詳細を保持していない試行では null を返す。
   * @returns {number|null}
   */
  function countBadRegimeYears(trial, yearN) {
    if (!trial.history || trial.history.length === 0) return null;
    const monthCount = yearN * 12;
    const usedMonths = Math.min(monthCount, trial.history.length);
    if (usedMonths <= 0) return null;
    const badRegimeYearSet = new Set();
    for (let m = 0; m < usedMonths; m++) {
      const regime = trial.history[m].regime;
      if (regime === 'TIGHTENING' || regime === 'STAGFLATION') {
        badRegimeYearSet.add(Math.floor(m / 12));
      }
    }
    return badRegimeYearSet.size;
  }

  /**
   * 生活費カテゴリの記録（trial.lifeCostCategoryHistory）から、指定した月インデックス以前で
   * 直近に記録されたスナップショットを取得する（carry-forward：値は次の記録まで変化しないため）。
   * @returns {{monthIndex: number, categories: Array<{name: string, amount: number}>}|null}
   */
  function findLifeCostSnapshotAtMonth(trial, monthIndex) {
    const history = trial.lifeCostCategoryHistory;
    if (!history || history.length === 0) return null;
    if (history[0].monthIndex > monthIndex) return null; // まだ開始前（通常は発生しない）
    let snapshot = history[0];
    for (let i = 0; i < history.length; i++) {
      if (history[i].monthIndex <= monthIndex) snapshot = history[i]; else break;
    }
    return snapshot;
  }

  /**
   * 指定したカテゴリ名について、生活費カテゴリの記録の中で最初に登場した時点（＝そのカテゴリの
   * 起点。通常はシミュレーション開始時点だが、期間の途中から追加されたカテゴリの場合は
   * その追加された時点）のスナップショットをベースラインとして取得する。
   * @returns {{amount: number, monthIndex: number}|null}
   */
  function findLifeCostBaseline(trial, categoryName) {
    const history = trial.lifeCostCategoryHistory;
    if (!history) return null;
    for (let i = 0; i < history.length; i++) {
      const found = history[i].categories.find((c) => c.name === categoryName);
      if (found) return { amount: found.amount, monthIndex: history[i].monthIndex };
    }
    return null;
  }

  /**
   * 1試行分の「生活費カテゴリ別の内訳」を、指定した月インデックス時点のスナップショットで計算する。
   * 各カテゴリについて、その時点の月額・起点（初出時点）からの増幅割合（%）・年平均インフレ率
   * （実績ベース、起点からのCAGR）・生活費全体に占める割合（シェア、%）を返す。
   * 起点の金額が0円のカテゴリは倍率・年率が定義できないため null になる。
   * @returns {Array<{name: string, currentAmount: number, growthRatioPercent: number|null,
   *                   annualizedRatePercent: number|null, sharePercent: number|null}>}
   */
  function calculateLifeCostBreakdownAtMonth(trial, monthIndex) {
    const snapshot = findLifeCostSnapshotAtMonth(trial, monthIndex);
    if (!snapshot) return [];
    const total = snapshot.categories.reduce((s, c) => s + c.amount, 0.0);

    return snapshot.categories.map((cat) => {
      const baseline = findLifeCostBaseline(trial, cat.name);
      const monthsElapsed = baseline ? snapshot.monthIndex - baseline.monthIndex : 0;

      let growthRatioPercent = null;
      let annualizedRatePercent = null;
      if (baseline && baseline.amount > 0) {
        growthRatioPercent = (cat.amount / baseline.amount - 1.0) * 100;
        if (monthsElapsed > 0 && cat.amount > 0) {
          annualizedRatePercent = (Math.pow(cat.amount / baseline.amount, 12.0 / monthsElapsed) - 1.0) * 100;
        }
      }
      const sharePercent = total > 0 ? (cat.amount / total) * 100 : null;

      return {
        name: cat.name, currentAmount: cat.amount,
        growthRatioPercent, annualizedRatePercent, sharePercent
      };
    });
  }

  /** 1試行分の、指定した年数N時点（その年の末月）の生活費カテゴリ別内訳を計算する（分岐点分析用） */
  function calculateLifeCostBreakdownAtYear(trial, yearN) {
    return calculateLifeCostBreakdownAtMonth(trial, yearN * 12 - 1);
  }

  /**
   * 生活費カテゴリ名の一覧を、記録に登場する順で重複なく取得する（CSVヘッダ等での列定義に使用）。
   * 生活費カテゴリの構成は設定（appData.lifeCostPeriods）に由来し全試行で共通のため、
   * 1試行分の記録から取得すれば足りる。
   */
  function getLifeCostCategoryNames(trial) {
    const names = [];
    const seen = {};
    (trial.lifeCostCategoryHistory || []).forEach((snapshot) => {
      snapshot.categories.forEach((c) => {
        if (!seen[c.name]) { seen[c.name] = true; names.push(c.name); }
      });
    });
    return names;
  }

  global.FireBorderline = {
    findBorderlineCases, calculateStockAverageAnnualRates, calculateFxAverageAnnualRates, getLifeCostAtYear,
    calculateCrisisBufferRatio, countBadRegimeYears, countCrisisMonths,
    getEmergencyLaborIncomeAtYear, sumEmergencyLaborIncomeUpToYear,
    calculateLifeCostBreakdownAtMonth, calculateLifeCostBreakdownAtYear, getLifeCostCategoryNames
  };
})(typeof window !== 'undefined' ? window : globalThis);
