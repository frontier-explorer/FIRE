/**
 * ===============================================================
 * UI共通ヘルパー関数
 * ===============================================================
 * DOM要素の生成・数値フォーマット・トースト通知など、
 * 画面共通で使う小さなユーティリティ関数をまとめる。
 * ===============================================================
 */
(function (global) {
  'use strict';

  /** 要素を1つ生成する（属性・子要素をまとめて指定できる） */
  function createElement(tag, options, children) {
    const el = document.createElement(tag);
    options = options || {};
    Object.keys(options).forEach((key) => {
      if (key === 'class') el.className = options[key];
      else if (key === 'text') el.textContent = options[key];
      else if (key === 'html') el.innerHTML = options[key];
      else if (key.indexOf('on') === 0 && typeof options[key] === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), options[key]);
      } else {
        el.setAttribute(key, options[key]);
      }
    });
    (children || []).forEach((child) => {
      if (child) el.appendChild(child);
    });
    return el;
  }

  /** 円金額を3桁区切りでフォーマットする */
  function formatYen(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return Math.round(value).toLocaleString('ja-JP') + '円';
  }

  /** パーセント値をフォーマットする（小数第1位まで） */
  function formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) return '-';
    return value.toFixed(1) + '%';
  }

  /** 画面下部にトースト通知を一時的に表示する */
  function showToast(message, durationMs) {
    durationMs = durationMs || 2500;
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => { toast.hidden = true; }, durationMs);
  }

  /** input要素から数値を取得する（不正値は0にフォールバック） */
  function readNumberInput(input) {
    const v = parseFloat(input.value);
    return isNaN(v) ? 0 : v;
  }

  /** input要素から整数を取得する（不正値は0にフォールバック） */
  function readIntInput(input) {
    const v = parseInt(input.value, 10);
    return isNaN(v) ? 0 : v;
  }

  global.FireUiHelpers = { createElement, formatYen, formatPercent, showToast, readNumberInput, readIntInput };
})(typeof window !== 'undefined' ? window : globalThis);
