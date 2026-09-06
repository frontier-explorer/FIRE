/**
 * ===============================================================
 * 債券計算ユーティリティ - JavaScript版（Kotlin版 Bond.kt に対応）
 * ===============================================================
 *
 * 【本ファイルについて】
 * 1つの bond オブジェクトが「1銘柄の保有状況」を表す。
 * 利息収入は毎月のcashへの加算（利息振込月のみ）、満期返金は満期年月に
 * 額面×保有数をcashに加算する。為替損益課税・価格損益課税は税率画面で
 * ユーザーが設定した株式等の譲渡益課税と同じ税率（appData.tax）を使う。
 * ===============================================================
 */
(function (global) {
  'use strict';

  /** 通貨種別から為替ペアキー（例:"USD/JPY"）を返す。円建ては空文字 */
  function fxPairKey(currency) {
    if (currency === 'USD') return 'USD/JPY';
    if (currency === 'EUR') return 'EUR/JPY';
    return '';
  }

  /** 総保有数（最初の購入数 + 追加購入数の合計）を計算する */
  function totalQuantity(bond) {
    const purchases = bond.purchases || [];
    return bond.quantity + purchases.reduce((s, p) => s + p.quantity, 0);
  }

  /** 加重平均購入時FXレートを計算する。円建ての場合は常に1.0を返す */
  function averagePurchaseFxRate(bond) {
    if (bond.currency === 'JPY') return 1.0;
    const totalQty = totalQuantity(bond);
    if (totalQty === 0) return bond.purchaseFxRate;

    const purchases = bond.purchases || [];
    const initialWeight = bond.purchaseFxRate * bond.quantity;
    const additionalWeight = purchases.reduce((s, p) => s + p.purchaseFxRate * p.quantity, 0.0);
    return (initialWeight + additionalWeight) / totalQty;
  }

  /** 平均取得単価を計算する（外貨のまま返す。初回購入と追加購入の加重平均） */
  function averageUnitPrice(bond) {
    const totalQty = totalQuantity(bond);
    if (totalQty === 0) return bond.initialUnitPrice;
    const purchases = bond.purchases || [];
    const initialCost = bond.initialUnitPrice * bond.quantity;
    const additionalCost = purchases.reduce((s, p) => s + p.unitPrice * p.quantity, 0.0);
    return (initialCost + additionalCost) / totalQty;
  }

  /**
   * 1回の利息支払額を計算する（外貨のまま返す）。
   * 年間利息 = 額面 × 総保有数 × 利率/100、1回あたり = 年間利息 / 年間支払回数
   */
  function couponPerPayment(bond) {
    const timesPerYear = (bond.paymentMonths && bond.paymentMonths.length > 0) ? bond.paymentMonths.length : 1;
    return bond.faceValue * totalQuantity(bond) * bond.couponRate / 100.0 / timesPerYear;
  }

  /**
   * 満期時の税金計算を行う。
   * （1）価格損益課税: (額面-加重平均購入単価)×総保有数×満期時FXレート に課税
   * （2）為替損益課税（外貨建てのみ）: 購入単価×総保有数×(満期時FX-購入時平均FX) に課税
   * いずれもマイナス（損失）は課税ゼロとして扱う。
   */
  function calculateMaturityTax(bond, maturityFxRate, taxRate) {
    const avgPurchaseFx = averagePurchaseFxRate(bond);
    const avgPurchasePrice = averageUnitPrice(bond);
    const qty = totalQuantity(bond);

    const grossPaymentJpy = bond.faceValue * qty * maturityFxRate;

    const priceProfitFx = (bond.faceValue - avgPurchasePrice) * qty;
    const priceProfitJpy = priceProfitFx * maturityFxRate;

    const fxProfitJpy = bond.currency === 'JPY'
      ? 0.0
      : avgPurchasePrice * qty * (maturityFxRate - avgPurchaseFx);

    const taxablePriceProfit = Math.max(priceProfitJpy, 0.0);
    const taxableFxProfit = Math.max(fxProfitJpy, 0.0);
    const totalTaxable = taxablePriceProfit + taxableFxProfit;
    const taxAmount = totalTaxable * taxRate;

    return {
      grossPaymentJpy, priceProfitJpy, fxProfitJpy,
      totalTaxableProfit: totalTaxable, taxAmountJpy: taxAmount,
      netPaymentJpy: grossPaymentJpy - taxAmount
    };
  }

  global.FireBond = {
    fxPairKey, totalQuantity, averagePurchaseFxRate, averageUnitPrice, couponPerPayment, calculateMaturityTax
  };
})(typeof window !== 'undefined' ? window : globalThis);
