/**
 * ===============================================================
 * シミュレーション実行前の前処理
 * ===============================================================
 * UI上では「西暦年月文字列（"yyyy-MM"）」で入力する項目を、
 * シミュレーション実行直前に「シミュレーション開始（＝現在）からの
 * 経過月インデックス」に変換する。Kotlin版 SimulationViewModel.kt の
 * prepare*ForSimulation() 群に対応する。
 * ===============================================================
 */
(function (global) {
  'use strict';

  /**
   * 西暦年月文字列を「シミュレーション開始（現在月）からの経過月数」に変換する。
   * 過去の年月・空文字・不正な形式は defaultIndex を返す。
   */
  function convertYearMonthToIndex(yearMonth, defaultIndex) {
    if (!yearMonth) return defaultIndex;
    const now = new Date();
    const nowTotalMonths = now.getFullYear() * 12 + (now.getMonth() + 1);
    const targetTotalMonths = FireEngine.yearMonthToTotalMonths(yearMonth);
    if (targetTotalMonths === null) return defaultIndex;
    const idx = targetTotalMonths - nowTotalMonths;
    return idx < 0 ? 0 : idx;
  }

  /** 追加投資リストの前処理: fromMonth/toMonthを月インデックスに変換する */
  function prepareTuika(tuikaList) {
    return tuikaList.map((t) => {
      const fromMonthIndex = t.fromMonth ? convertYearMonthToIndex(t.fromMonth, 0) : 0;
      let fromMonthNum = 1;
      if (t.fromMonth) {
        const parts = t.fromMonth.split('-');
        const m = parseInt(parts[1], 10);
        fromMonthNum = Math.min(Math.max(isNaN(m) ? 1 : m, 1), 12);
      }
      let toMonthIndex;
      if (t.pattern === '１回') {
        toMonthIndex = fromMonthIndex;
      } else if (!t.toMonth) {
        toMonthIndex = 0;
      } else {
        toMonthIndex = convertYearMonthToIndex(t.toMonth, 0);
      }
      return Object.assign({}, t, { month: fromMonthIndex, fromMonthNum, toMonthTotalMonths: toMonthIndex });
    });
  }

  /** 大きな出費リストの前処理: fromMonthを月インデックスに変換する */
  function prepareBigExpense(bigExpenseList) {
    return bigExpenseList.map((e) => Object.assign({}, e, { month: convertYearMonthToIndex(e.fromMonth, 0) }));
  }

  /** 収入リストの前処理: fromMonth/toMonthを月インデックスに変換する（toMonth空欄=永続=null） */
  function prepareIncome(incomeList) {
    return incomeList.map((inc) => {
      const startIndex = convertYearMonthToIndex(inc.fromMonth, 0);
      const endIndex = inc.toMonth ? convertYearMonthToIndex(inc.toMonth, null) : null;
      return Object.assign({}, inc, { startTotalMonths: startIndex, endTotalMonths: endIndex });
    });
  }

  /** 税率リストの前処理: fromMonthを月インデックスに変換する */
  function prepareTax(taxList) {
    return taxList.map((tax) => Object.assign({}, tax, { month: convertYearMonthToIndex(tax.fromMonth, 0) }));
  }

  /**
   * 保有証券の前処理: 旧NISAの taxStartYearMonth を taxStartYear/taxStartMonth
   * （月インデックスの商・余り）に変換する。特定口座・新NISAはそのまま返す。
   */
  function prepareStocks(stockList) {
    return stockList.map((stock) => {
      const ym = stock.taxStartYearMonth;
      if (!ym) return stock;
      const monthIndex = convertYearMonthToIndex(ym, 0);
      const taxStartYear = Math.floor(monthIndex / 12);
      const taxStartMonth = monthIndex % 12;
      return Object.assign({}, stock, { taxStartYear, taxStartMonth });
    });
  }

  /**
   * appData全体をシミュレーション実行用に変換する（西暦年月文字列 → 月インデックス）。
   * 元のappDataは変更せず、変換後の新しいオブジェクトを返す。
   */
  function prepareAppDataForSimulation(appData) {
    return Object.assign({}, appData, {
      tuika: prepareTuika(appData.tuika),
      bigExpense: prepareBigExpense(appData.bigExpense),
      income: prepareIncome(appData.income),
      tax: prepareTax(appData.tax),
      stocks: prepareStocks(appData.stocks)
    });
  }

  global.FirePrepare = { prepareAppDataForSimulation, convertYearMonthToIndex };
})(typeof window !== 'undefined' ? window : globalThis);
