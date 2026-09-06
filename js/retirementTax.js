/**
 * ===============================================================
 * 退職所得課税計算ユーティリティ - JavaScript版
 * （Kotlin版 RetirementTaxCalculator.kt に対応）
 * ===============================================================
 *
 * 受け取り方法は一時金（一括受け取り）のみを対象とする。
 * 退職所得控除は「40万円 × 勤続年数（またはiDeCo加入年数）」で固定する簡略計算。
 * ===============================================================
 */
(function (global) {
  'use strict';

  const DEDUCTION_PER_YEAR = 400000;
  const INDEPENDENT_TAX_GAP_YEARS = 20;
  const RESIDENT_TAX_RATE = 0.10;
  const RECONSTRUCTION_TAX_RATE = 0.021;
  const MAX_PLAUSIBLE_SERVICE_YEARS = 60;

  // 所得税の速算表（各行: 課税対象金額の上限（円）、税率、控除額（円））
  const TAX_BRACKETS = [
    { upperBound: 1949000, rate: 0.05, deduction: 0 },
    { upperBound: 3299000, rate: 0.10, deduction: 97500 },
    { upperBound: 6949000, rate: 0.20, deduction: 427500 },
    { upperBound: 8999000, rate: 0.23, deduction: 636000 },
    { upperBound: 17999000, rate: 0.33, deduction: 1536000 },
    { upperBound: 39999000, rate: 0.40, deduction: 2796000 },
    { upperBound: Infinity, rate: 0.45, deduction: 4796000 }
  ];

  /** 課税対象額（円）から所得税額（円）を、速算表に基づいて計算する */
  function calculateProgressiveIncomeTax(taxableIncome) {
    if (taxableIncome <= 0) return 0;
    const bracket = TAX_BRACKETS.find((b) => taxableIncome <= b.upperBound);
    const tax = taxableIncome * bracket.rate - bracket.deduction;
    return Math.floor(Math.max(tax, 0.0));
  }

  /** 退職所得控除額（40万円×年数、簡略式）を計算する */
  function deductionForYears(years) {
    const clampedYears = Math.min(Math.max(years, 0), MAX_PLAUSIBLE_SERVICE_YEARS);
    return DEDUCTION_PER_YEAR * clampedYears;
  }

  /**
   * 退職所得の税額を、受取額と退職所得控除額から計算する共通処理。
   * 退職所得 = max(0, 受取額-控除額) × 1/2（1000円未満切り捨て）
   */
  function computeTaxFromDeduction(grossAmount, deductionAmount) {
    const taxableIncomeRaw = Math.floor(Math.max(grossAmount - deductionAmount, 0) / 2);
    const taxableIncome = Math.floor(taxableIncomeRaw / 1000) * 1000;

    const incomeTax = calculateProgressiveIncomeTax(taxableIncome);
    const reconstructionTax = Math.floor(incomeTax * RECONSTRUCTION_TAX_RATE);
    const residentTax = Math.floor(taxableIncome * RESIDENT_TAX_RATE);
    const totalTax = incomeTax + reconstructionTax + residentTax;
    const netAmount = grossAmount - totalTax;

    return { grossAmount, deductionAmount, taxableIncome, incomeTax, reconstructionTax, residentTax, totalTax, netAmount };
  }

  /** 会社の退職金単独の税額を計算する（勤続年数に基づく控除を適用） */
  function calculateSeveranceTax(severanceAmount, companyServiceYears) {
    const deduction = deductionForYears(companyServiceYears);
    return computeTaxFromDeduction(severanceAmount, deduction);
  }

  /**
   * iDeCo一時金の税額を計算する。
   * 退職金受け取りから20年以上経過、または退職金なしの場合はiDeCo単独で満額控除。
   * 20年未満の場合は合算方式（簡略式）で計算した税額から、退職金側で既に
   * 納付済みの税額を差し引いた差額をiDeCo一時金の税額とみなす。
   */
  function calculateIdecoLumpSumTax(idecoLumpSum, idecoContributionYears, severanceAmount, companyServiceYears, gapYears) {
    if (severanceAmount <= 0 || gapYears >= INDEPENDENT_TAX_GAP_YEARS) {
      const deduction = deductionForYears(idecoContributionYears);
      return computeTaxFromDeduction(idecoLumpSum, deduction);
    }

    const combinedDeduction = deductionForYears(Math.max(companyServiceYears, idecoContributionYears));
    const combinedGross = severanceAmount + idecoLumpSum;
    const combinedResult = computeTaxFromDeduction(combinedGross, combinedDeduction);

    const severanceStandaloneTax = calculateSeveranceTax(severanceAmount, companyServiceYears).totalTax;

    const idecoTax = Math.max(combinedResult.totalTax - severanceStandaloneTax, 0);
    const idecoNet = idecoLumpSum - idecoTax;

    return {
      grossAmount: idecoLumpSum, deductionAmount: combinedDeduction, taxableIncome: combinedResult.taxableIncome,
      incomeTax: combinedResult.incomeTax, reconstructionTax: combinedResult.reconstructionTax,
      residentTax: combinedResult.residentTax, totalTax: idecoTax, netAmount: idecoNet
    };
  }

  // =====================================================
  // 受給可能年齢の判定（通算加入者等期間による10年ルール）
  // =====================================================

  /** 通算加入者等期間（年）に応じた受給可能年齢を返す */
  function eligibleAgeForContributionYears(contributionYears) {
    if (contributionYears >= 10) return 60;
    if (contributionYears >= 8) return 61;
    if (contributionYears >= 6) return 62;
    if (contributionYears >= 4) return 63;
    if (contributionYears >= 2) return 64;
    return 65;
  }

  /** "yyyy-MM"・"yyyy-MM-dd" いずれの年月文字列も解釈できるようにパースする */
  function parseYearMonth(ym) {
    if (!ym) return null;
    const parts = ym.split('-');
    if (parts.length < 2) return null;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) return null;
    return [year, month];
  }

  function formatYearMonth(year, month) {
    return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0');
  }

  function isBeforeOrEqual(a, b) { return (a[0] * 12 + a[1]) <= (b[0] * 12 + b[1]); }
  function monthsBetween(from, to) { return (to[0] * 12 + to[1]) - (from[0] * 12 + from[1]); }

  /**
   * iDeCo拠出開始年月と生年月日から、受給可能になる最も早い年月（"yyyy-MM"）を計算する。
   * 60歳時点の通算加入者等期間に応じて受給可能年齢が60〜65歳の間で決まる（10年ルール）。
   */
  function calculateEligibleReceiveYearMonth(birthYearMonth, startYearMonth) {
    const birth = parseYearMonth(birthYearMonth);
    const start = parseYearMonth(startYearMonth);
    if (!birth || !start) return null;

    const age60YearMonth = [birth[0] + 60, birth[1]];

    let candidate;
    if (isBeforeOrEqual(start, age60YearMonth)) {
      const contributionMonths = monthsBetween(start, age60YearMonth);
      const contributionYears = Math.floor(contributionMonths / 12);
      const eligibleAge = eligibleAgeForContributionYears(contributionYears);
      candidate = formatYearMonth(birth[0] + eligibleAge, birth[1]);
    } else {
      candidate = formatYearMonth(start[0] + 5, start[1]);
    }

    const age75YearMonth = formatYearMonth(birth[0] + 75, birth[1]);
    return candidate > age75YearMonth ? age75YearMonth : candidate;
  }

  /** 指定したiDeCo受給予定年月が、受給可能年月以降として有効かどうかを判定する */
  function isReceiveYearMonthValid(birthYearMonth, startYearMonth, receiveYearMonth) {
    const eligible = calculateEligibleReceiveYearMonth(birthYearMonth, startYearMonth);
    if (!eligible) return false;
    const eligibleParsed = parseYearMonth(eligible);
    const receiveParsed = parseYearMonth(receiveYearMonth);
    if (!eligibleParsed || !receiveParsed) return false;
    return isBeforeOrEqual(eligibleParsed, receiveParsed);
  }

  global.FireRetirementTax = {
    calculateProgressiveIncomeTax, calculateSeveranceTax, calculateIdecoLumpSumTax,
    calculateEligibleReceiveYearMonth, isReceiveYearMonthValid
  };
})(typeof window !== 'undefined' ? window : globalThis);
